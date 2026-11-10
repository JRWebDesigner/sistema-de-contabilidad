import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma, serializableTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { postJournalEntry } from '@/lib/accounting'
import { nextDocumentNumber } from '@/lib/document-numbering'
import { branchContextError, branchWhere, requireSingleBranch, resolveBranchContext } from '@/lib/branches'

const paymentSchema = z.object({
  payableId: z.string().min(1),
  cashAccountId: z.string().min(1),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'QR']),
  amount: z.coerce.number().finite().positive(),
})
const reversalSchema = z.object({
  paymentId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
})

export async function GET(request: Request) {
  const access = await requirePermission(request, 'finance:read')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError
  const payables = await prisma.accountPayable.findMany({ where: branchContext.isAll ? undefined : { purchase: { is: branchWhere(branchContext) } }, include: { supplier: { select: { name: true, document: true } }, purchase: { select: { number: true } }, payments: { include: { cashAccount: { select: { id: true, name: true, type: true } } }, orderBy: { createdAt: 'asc' } } }, orderBy: { dueDate: 'asc' } })
  const now = new Date()
  return NextResponse.json(payables.map((payable) => ({
    ...payable,
    status: payable.status !== 'PAID' && payable.status !== 'CANCELLED'
      && Number(payable.balance) > 0 && payable.dueDate < now
      ? 'OVERDUE'
      : payable.status,
    originalAmount: payable.originalAmount.toString(),
    paidAmount: payable.paidAmount.toString(),
    balance: payable.balance.toString(),
    payments: payable.payments.map((payment) => ({ ...payment, amount: payment.amount.toString() })),
  })))
}

export async function PATCH(request: Request) {
  const access = await requirePermission(request, 'finance:write')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const payload = reversalSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Indica el pago y un motivo de reversión válido.' }, { status: 400 })
  const branchId = branchContext.branchId!

  try {
    const result = await serializableTransaction(async (transaction) => {
      const payment = await transaction.payablePayment.findUnique({
        where: { id: payload.data.paymentId },
        include: {
          payable: { include: { purchase: { select: { branchId: true } } } },
          cashAccount: { select: { id: true, name: true } },
        },
      })
      if (!payment || payment.payable.purchase.branchId !== branchId || payment.payable.status === 'CANCELLED') {
        throw new Error('PAYABLE_PAYMENT_NOT_FOUND')
      }
      if (payment.reversedAt) throw new Error('PAYMENT_ALREADY_REVERSED')
      const amount = Number(payment.amount)
      const nextPaid = Math.round((Number(payment.payable.paidAmount) - amount + Number.EPSILON) * 100) / 100
      if (nextPaid < 0) throw new Error('PAYMENT_BALANCE_INVALID')
      const nextBalance = Math.round((Number(payment.payable.balance) + amount + Number.EPSILON) * 100) / 100
      const nextStatus = nextPaid === 0 ? 'PENDING' : 'PARTIAL'
      const reversedAt = new Date()

      const claimed = await transaction.payablePayment.updateMany({
        where: { id: payment.id, reversedAt: null },
        data: { reversedAt, reversalReason: payload.data.reason },
      })
      if (claimed.count !== 1) throw new Error('PAYMENT_ALREADY_REVERSED')

      await transaction.accountPayable.update({
        where: { id: payment.payable.id },
        data: { paidAmount: nextPaid, balance: nextBalance, status: nextStatus },
      })
      const restoredCash = await transaction.cashAccount.updateMany({
        where: { id: payment.cashAccount.id, branchId, isActive: true },
        data: { balance: { increment: amount } },
      })
      if (restoredCash.count !== 1) throw new Error('CASH_ACCOUNT_NOT_FOUND')
      const reference = `REV-CXP-${payment.reference ?? payment.id}`
      await transaction.cashMovement.create({
        data: {
          type: 'IN',
          amount,
          description: `Reversión de pago ${payment.payable.number}: ${payload.data.reason}`,
          reference,
          accountId: payment.cashAccount.id,
        },
      })
      await postJournalEntry(transaction, {
        date: reversedAt,
        description: `Reversión de pago ${payment.payable.number}`,
        sourceType: 'PAYABLE_PAYMENT_REVERSAL',
        sourceId: payment.id,
        branchId,
        isReversal: true,
        lines: [
          { accountCode: '1000', debit: amount },
          { accountCode: '2100', credit: amount },
        ],
      })
      await logAudit({
        request,
        action: 'UPDATE',
        moduleName: 'Cuentas por pagar',
        entity: 'PayablePayment',
        entityId: payment.id,
        details: `Se revirtió el pago ${payment.reference ?? payment.id} por ${amount.toFixed(2)} Bs. Motivo: ${payload.data.reason}.`,
        oldValue: { paidAmount: Number(payment.payable.paidAmount), balance: Number(payment.payable.balance) },
        newValue: { paidAmount: nextPaid, balance: nextBalance, reversedAt: reversedAt.toISOString(), reason: payload.data.reason },
      }, transaction)
      return { paymentId: payment.id, balance: nextBalance, status: nextStatus }
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('ERROR_REVERSING_PAYABLE_PAYMENT', error)
    const messages: Record<string, string> = {
      PAYABLE_PAYMENT_NOT_FOUND: 'El pago no existe, pertenece a otra sucursal o la cuenta está cancelada.',
      PAYMENT_ALREADY_REVERSED: 'Este pago ya fue revertido.',
      PAYMENT_BALANCE_INVALID: 'No se pudo recalcular el saldo de la cuenta por pagar.',
      CASH_ACCOUNT_NOT_FOUND: 'La cuenta de caja o banco ya no está disponible para revertir el pago.',
      ACCOUNTING_PERIOD_CLOSED: 'El período contable de hoy está cerrado.',
      ACCOUNTING_PERIOD_NOT_STARTED: 'La fecha de operación es anterior al inicio del libro mayor.',
    }
    return NextResponse.json({ error: error instanceof Error ? messages[error.message] ?? 'No se pudo revertir el pago.' : 'No se pudo revertir el pago.' }, { status: 400 })
  }
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'finance:write')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!
  const payload = paymentSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Revisa los datos del pago.' }, { status: 400 })
  try {
    const result = await serializableTransaction(async (transaction) => {
      const payable = await transaction.accountPayable.findUnique({
        where: { id: payload.data.payableId },
        include: { purchase: { select: { branchId: true } } },
      })
      if (!payable || payable.status === 'PAID' || payable.status === 'CANCELLED') throw new Error('PAYABLE_NOT_FOUND')
      if (payable.purchase.branchId !== branchId) throw new Error('PAYABLE_NOT_FOUND')
      if (payload.data.amount > Number(payable.balance)) throw new Error('PAYMENT_TOO_LARGE')
      const account = await transaction.cashAccount.findFirst({ where: { id: payload.data.cashAccountId, isActive: true, branchId } })
      if (!account) throw new Error('ACCOUNT_NOT_FOUND')
      if (Number(account.balance) < payload.data.amount) throw new Error('INSUFFICIENT_BALANCE')
      const balance = Math.round((Number(payable.balance) - payload.data.amount + Number.EPSILON) * 100) / 100
      const paid = Math.round((Number(payable.paidAmount) + payload.data.amount + Number.EPSILON) * 100) / 100
      const status = balance === 0 ? 'PAID' : 'PARTIAL'
      const reference = await nextDocumentNumber(transaction, 'P', access.session.userId, branchId)
      await transaction.accountPayable.update({ where: { id: payable.id }, data: { balance, paidAmount: paid, status } })
      await transaction.payablePayment.create({ data: { amount: payload.data.amount, paymentMethod: payload.data.paymentMethod, reference, payableId: payable.id, cashAccountId: account.id } })
      await transaction.cashAccount.update({ where: { id: account.id }, data: { balance: { decrement: payload.data.amount } } })
      await transaction.cashMovement.create({ data: { type: 'OUT', amount: payload.data.amount, description: `Pago a proveedor ${payable.number}`, reference, accountId: account.id } })
      await postJournalEntry(transaction, {
        date: new Date(),
        description: `Pago de cuenta ${payable.number}`,
        sourceType: 'PAYABLE_PAYMENT',
        sourceId: reference,
        branchId,
        lines: [
          { accountCode: '2100', debit: payload.data.amount },
          { accountCode: '1000', credit: payload.data.amount },
        ],
      })
      await logAudit({
        request,
        action: 'PAYMENT',
        moduleName: 'Cuentas por pagar',
        entity: 'AccountPayable',
        entityId: payable.id,
        details: `Se registró el pago ${reference} por ${payload.data.amount.toFixed(2)} Bs en ${payable.number}.`,
        oldValue: { balance: Number(payable.balance), paidAmount: Number(payable.paidAmount), status: payable.status },
        newValue: { balance, paidAmount: paid, status },
      }, transaction)
      return { reference, balance, status }
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const messages: Record<string, string> = { PAYABLE_NOT_FOUND: 'La cuenta por pagar no existe o ya está pagada.', PAYMENT_TOO_LARGE: 'El pago supera el saldo pendiente.', ACCOUNT_NOT_FOUND: 'La cuenta no existe o está inactiva.', INSUFFICIENT_BALANCE: 'El saldo de caja es insuficiente.', ACCOUNTING_PERIOD_CLOSED: 'El período contable de esta fecha está cerrado.', ACCOUNTING_PERIOD_NOT_STARTED: 'La fecha de operación es anterior al inicio del libro mayor.' }
    return NextResponse.json({ error: error instanceof Error ? messages[error.message] ?? 'No se pudo registrar el pago.' : 'No se pudo registrar el pago.' }, { status: 400 })
  }
}
