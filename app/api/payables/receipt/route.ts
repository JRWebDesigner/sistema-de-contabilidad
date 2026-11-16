import { NextResponse } from 'next/server'
import { z } from 'zod'

import { logAudit } from '@/lib/audit'
import { branchContextError, resolveBranchContext } from '@/lib/branches'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'

const receiptSchema = z.object({ paymentId: z.string().min(1) })

export async function POST(request: Request) {
  const access = await requirePermission(request, 'finance:read')
  if (access.response) return access.response

  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError

  const payload = receiptSchema.safeParse(await request.json())
  if (!payload.success) {
    return NextResponse.json({ error: 'Selecciona un pago válido para imprimir.' }, { status: 400 })
  }

  try {
    const payment = await prisma.payablePayment.findUnique({
      where: { id: payload.data.paymentId },
      select: {
        id: true,
        amount: true,
        createdAt: true,
        reference: true,
        reversedAt: true,
        payable: {
          select: {
            originalAmount: true,
            supplier: { select: { name: true, document: true } },
            purchase: {
              select: {
                branchId: true,
                number: true,
                branch: { select: { name: true } },
                items: {
                  select: {
                    quantity: true,
                    product: { select: { name: true, type: true } },
                  },
                },
              },
            },
            payments: {
              select: { id: true, amount: true, createdAt: true, reversedAt: true },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    })

    if (
      !payment ||
      (!branchContext.isAll && payment.payable.purchase.branchId !== branchContext.branchId)
    ) {
      return NextResponse.json({ error: 'El pago no existe o no pertenece a la sucursal seleccionada.' }, { status: 404 })
    }
    if (payment.reversedAt) {
      return NextResponse.json({ error: 'No se puede emitir una nota para un pago revertido.' }, { status: 409 })
    }

    const paymentIndex = payment.payable.payments.findIndex((entry) => entry.id === payment.id)
    if (paymentIndex < 0) throw new Error('PAYABLE_PAYMENT_NOT_IN_HISTORY')
    const paidThroughThisPayment = payment.payable.payments
      .slice(0, paymentIndex + 1)
      .filter((entry) => !entry.reversedAt || entry.reversedAt > payment.createdAt)
      .reduce((total, entry) => total + Number(entry.amount), 0)
    const balanceRemaining = Math.round(
      (Number(payment.payable.originalAmount) - paidThroughThisPayment + Number.EPSILON) * 100,
    ) / 100
    if (balanceRemaining < 0) throw new Error('PAYABLE_PAYMENT_BALANCE_INVALID')

    await logAudit({
      request,
      action: 'EXPORT',
      moduleName: 'Cuentas por pagar',
      entity: 'PayablePaymentReceipt',
      entityId: payment.id,
      details: `Se imprimió la nota del pago ${payment.reference ?? payment.id}.`,
      newValue: {
        reference: payment.reference,
        amount: Number(payment.amount),
        purchaseNumber: payment.payable.purchase.number,
      },
    })

    return NextResponse.json({
      number: payment.reference ?? payment.id,
      paymentDate: payment.createdAt.toISOString(),
      supplierName: payment.payable.supplier.name,
      supplierDocument: payment.payable.supplier.document,
      branchName: payment.payable.purchase.branch?.name ?? '',
      purchaseNumber: payment.payable.purchase.number,
      amount: Number(payment.amount),
      balanceRemaining,
      items: payment.payable.purchase.items.map((item) => ({
        name: item.product.name,
        type: item.product.type,
        quantity: item.quantity,
      })),
    })
  } catch (error) {
    console.error('ERROR_ISSUING_PAYABLE_PAYMENT_NOTE', error)
    return NextResponse.json({ error: 'No se pudo generar la nota de cobro.' }, { status: 500 })
  }
}
