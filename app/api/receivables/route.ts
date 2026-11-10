import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma, serializableTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { postJournalEntry } from '@/lib/accounting'
import { nextDocumentNumber } from '@/lib/document-numbering'
import { branchContextError, branchWhere, requireSingleBranch, resolveBranchContext } from '@/lib/branches'

const paymentSchema = z.object({
  receivableId: z.string().min(1),
  cashAccountId: z.string().min(1).optional(),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER']),
  amount: z.coerce.number().finite().positive(),
  description: z.string().trim().max(500).optional(),
  externalReference: z.string().trim().max(100).optional(),
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
  const receivables = await prisma.accountReceivable.findMany({
    where: branchContext.isAll ? undefined : { sale: { is: branchWhere(branchContext) } },
    include: {
      customer: { select: { id: true, name: true, document: true } },
      sale: { select: { number: true, createdAt: true, paymentMethod: true } },
      payments: { include: { cashAccount: { select: { id: true, name: true, type: true } } }, orderBy: { createdAt: 'asc' } },
    },
    orderBy: { dueDate: 'asc' },
  })
  const now = new Date()

  return NextResponse.json(receivables.map((receivable) => ({
    ...receivable,
    sale: { ...receivable.sale, createdAt: receivable.sale.createdAt.toISOString() },
    status: receivable.status !== 'PAID' && receivable.status !== 'CANCELLED'
      && Number(receivable.balance) > 0 && receivable.dueDate < now
      ? 'OVERDUE'
      : receivable.status,
    originalAmount: receivable.originalAmount.toString(),
    paidAmount: receivable.paidAmount.toString(),
    balance: receivable.balance.toString(),
    payments: receivable.payments.map((payment) => ({ ...payment, amount: payment.amount.toString() })),
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
      const payment = await transaction.receivablePayment.findUnique({
        where: { id: payload.data.paymentId },
        include: {
          receivable: { include: { sale: { select: { branchId: true } } } },
          cashAccount: { select: { id: true, name: true } },
        },
      })
      if (!payment || payment.receivable.sale.branchId !== branchId || payment.receivable.status === 'CANCELLED') {
        throw new Error('RECEIVABLE_PAYMENT_NOT_FOUND')
      }
      if (payment.reversedAt) throw new Error('PAYMENT_ALREADY_REVERSED')
      const amount = Number(payment.amount)
      const nextPaid = Math.round((Number(payment.receivable.paidAmount) - amount + Number.EPSILON) * 100) / 100
      if (nextPaid < 0) throw new Error('PAYMENT_BALANCE_INVALID')
      const nextBalance = Math.round((Number(payment.receivable.balance) + amount + Number.EPSILON) * 100) / 100
      const nextStatus = nextPaid === 0 ? 'PENDING' : 'PARTIAL'
      const reversedAt = new Date()

      const claimed = await transaction.receivablePayment.updateMany({
        where: { id: payment.id, reversedAt: null },
        data: { reversedAt, reversalReason: payload.data.reason },
      })
      if (claimed.count !== 1) throw new Error('PAYMENT_ALREADY_REVERSED')

      await transaction.accountReceivable.update({
        where: { id: payment.receivable.id },
        data: { paidAmount: nextPaid, balance: nextBalance, status: nextStatus },
      })
      const cashAccount = await transaction.cashAccount.updateMany({
        where: { id: payment.cashAccount.id, isActive: true, branchId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      })
      if (cashAccount.count !== 1) throw new Error('INSUFFICIENT_CASH_BALANCE')
      const reference = `REV-CXC-${payment.reference ?? payment.id}`
      await transaction.cashMovement.create({
        data: {
          type: 'OUT',
          amount,
          description: `Reversión de cobro ${payment.receivable.number}: ${payload.data.reason}`,
          reference,
          accountId: payment.cashAccount.id,
        },
      })
      await postJournalEntry(transaction, {
        date: reversedAt,
        description: `Reversión de cobro ${payment.receivable.number}`,
        sourceType: 'RECEIVABLE_PAYMENT_REVERSAL',
        sourceId: payment.id,
        branchId,
        isReversal: true,
        lines: [
          { accountCode: '1200', debit: amount },
          { accountCode: '1000', credit: amount },
        ],
      })
      await logAudit({
        request,
        action: 'UPDATE',
        moduleName: 'Cuentas por cobrar',
        entity: 'ReceivablePayment',
        entityId: payment.id,
        details: `Se revirtió el cobro ${payment.reference ?? payment.id} por ${amount.toFixed(2)} Bs. Motivo: ${payload.data.reason}.`,
        oldValue: { paidAmount: Number(payment.receivable.paidAmount), balance: Number(payment.receivable.balance) },
        newValue: { paidAmount: nextPaid, balance: nextBalance, reversedAt: reversedAt.toISOString(), reason: payload.data.reason },
      }, transaction)
      return { paymentId: payment.id, balance: nextBalance, status: nextStatus }
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('ERROR_REVERSING_RECEIVABLE_PAYMENT', error)
    const messages: Record<string, string> = {
      RECEIVABLE_PAYMENT_NOT_FOUND: 'El cobro no existe, pertenece a otra sucursal o la cuenta está cancelada.',
      PAYMENT_ALREADY_REVERSED: 'Este cobro ya fue revertido.',
      PAYMENT_BALANCE_INVALID: 'No se pudo recalcular el saldo de la cuenta por cobrar.',
      INSUFFICIENT_CASH_BALANCE: 'La cuenta de caja o banco no tiene saldo suficiente para revertir el cobro.',
      ACCOUNTING_PERIOD_CLOSED: 'El período contable de hoy está cerrado.',
      ACCOUNTING_PERIOD_NOT_STARTED: 'La fecha de operación es anterior al inicio del libro mayor.',
    }
    return NextResponse.json({ error: error instanceof Error ? messages[error.message] ?? 'No se pudo revertir el cobro.' : 'No se pudo revertir el cobro.' }, { status: 400 })
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
  if (payload.data.amount <= 0) return NextResponse.json({ error: 'El importe del pago debe ser mayor a cero.' }, { status: 400 })
  if (payload.data.paymentMethod === 'BANK_TRANSFER' && !payload.data.externalReference) {
    return NextResponse.json({ error: 'El numero de comprobante es obligatorio para transferencias.' }, { status: 400 })
  }

  try {
    const result = await serializableTransaction(async (transaction) => {
      const receivable = await transaction.accountReceivable.findUnique({
        where: { id: payload.data.receivableId },
        include: { sale: { select: { branchId: true } } },
      })
      if (!receivable || receivable.status === 'PAID' || receivable.status === 'CANCELLED') throw new Error('RECEIVABLE_NOT_FOUND')
      if (receivable.sale.branchId !== branchId) throw new Error('RECEIVABLE_NOT_FOUND')
      if (payload.data.amount > Number(receivable.balance)) throw new Error('PAYMENT_TOO_LARGE')

      const nextBalance = Math.round((Number(receivable.balance) - payload.data.amount + Number.EPSILON) * 100) / 100
      const nextPaid = Math.round((Number(receivable.paidAmount) + payload.data.amount + Number.EPSILON) * 100) / 100
      const nextStatus = nextBalance === 0 ? 'PAID' : 'PARTIAL'
      const reference = await nextDocumentNumber(transaction, 'C', access.session.userId, branchId)
      const operator = await transaction.user.findUnique({
        where: { id: access.session.userId },
        select: { alias: true },
      })
      if (!operator) throw new Error('PAYMENT_OPERATOR_NOT_FOUND')
      let account = payload.data.paymentMethod === 'CASH'
        ? await transaction.cashAccount.findFirst({
          where: { isActive: true, branchId, type: 'CASH', custodianId: access.session.userId },
        })
        : payload.data.cashAccountId
          ? await transaction.cashAccount.findFirst({
            where: {
              id: payload.data.cashAccountId,
              isActive: true,
              branchId,
              custodianId: null,
              ...(payload.data.paymentMethod === 'BANK_TRANSFER' ? { type: 'BANK' } : {}),
              ...(payload.data.paymentMethod === 'CARD' ? { type: 'POS' } : {}),
            },
          })
          : null
      let createdCashAccount = false
      if (!account && payload.data.paymentMethod === 'CASH') {
        account = await transaction.cashAccount.create({
          data: {
            name: `Efectivo en custodia - ${operator.alias}`,
            type: 'CASH',
            branchId,
            custodianId: access.session.userId,
          },
        })
        createdCashAccount = true
      }
      if (!account) throw new Error(payload.data.cashAccountId ? 'ACCOUNT_NOT_FOUND' : 'CASH_ACCOUNT_REQUIRED')

      await transaction.accountReceivable.update({
        where: { id: receivable.id },
        data: { balance: nextBalance, paidAmount: nextPaid, status: nextStatus },
      })
      const payment = await transaction.receivablePayment.create({
        data: {
          amount: payload.data.amount,
          paymentMethod: payload.data.paymentMethod,
          reference,
          externalReference: payload.data.externalReference || null,
          description: payload.data.description || null,
          recordedByAlias: operator.alias,
          receivableId: receivable.id,
          cashAccountId: account.id,
        },
      })
      await transaction.cashAccount.update({ where: { id: account.id }, data: { balance: { increment: payload.data.amount } } })
      await transaction.cashMovement.create({
        data: {
          type: 'IN',
          amount: payload.data.amount,
          description: `Cobro de cuenta ${receivable.number}`,
          reference,
          accountId: account.id,
        },
      })
      if (createdCashAccount) {
        await logAudit({
          request,
          action: 'CREATE',
          moduleName: 'Caja y bancos',
          entity: 'CashAccount',
          entityId: account.id,
          details: `Se creÃ³ automÃ¡ticamente la cuenta de efectivo en custodia de ${operator.alias}.`,
          newValue: { name: account.name, type: 'CASH', custodianId: access.session.userId },
        }, transaction)
      }
      await postJournalEntry(transaction, {
        date: new Date(),
        description: `Cobro de cuenta ${receivable.number}`,
        sourceType: 'RECEIVABLE_PAYMENT',
        sourceId: reference,
        branchId,
        lines: [
          { accountCode: '1000', debit: payload.data.amount },
          { accountCode: '1200', credit: payload.data.amount },
        ],
      })

      await logAudit({
        request,
        action: 'PAYMENT',
        moduleName: 'Cuentas por cobrar',
        entity: 'AccountReceivable',
        entityId: receivable.id,
        details: `Se registró el cobro ${reference} por ${payload.data.amount.toFixed(2)} Bs en ${receivable.number}.`,
        oldValue: { balance: Number(receivable.balance), paidAmount: Number(receivable.paidAmount), status: receivable.status },
        newValue: {
          balance: nextBalance,
          paidAmount: nextPaid,
          status: nextStatus,
          description: payload.data.description || null,
          externalReference: payload.data.externalReference || null,
        },
      }, transaction)

      return { paymentId: payment.id, reference, balance: nextBalance, status: nextStatus }
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const message = error instanceof Error && error.message === 'PAYMENT_TOO_LARGE'
      ? 'El pago supera el saldo pendiente.'
      : error instanceof Error && error.message === 'ACCOUNT_NOT_FOUND'
        ? 'La cuenta de cobro no existe o está inactiva.'
        : error instanceof Error && error.message === 'RECEIVABLE_NOT_FOUND'
          ? 'La cuenta por cobrar no existe o ya está pagada.'
          : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_CLOSED'
            ? 'El período contable de esta fecha está cerrado.'
            : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_NOT_STARTED'
              ? 'La fecha de operación es anterior al inicio del libro mayor.'
          : 'No se pudo registrar el pago.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
