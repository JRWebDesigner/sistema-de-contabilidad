import { NextResponse } from 'next/server'
import { z } from 'zod'

import { logAudit } from '@/lib/audit'
import { branchContextError, resolveBranchContext } from '@/lib/branches'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'

const receiptSchema = z.object({ paymentId: z.string().min(1) })

const paymentLabels: Record<string, string> = {
  CASH: 'Efectivo',
  BANK_TRANSFER: 'Transferencia bancaria',
  OTHER: 'Otro',
  CARD: 'Tarjeta',
  QR: 'QR',
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'finance:read')
  if (access.response) return access.response

  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError

  const payload = receiptSchema.safeParse(await request.json())
  if (!payload.success) {
    return NextResponse.json({ error: 'Selecciona un cobro válido para imprimir.' }, { status: 400 })
  }

  try {
    const payment = await prisma.receivablePayment.findUnique({
      where: { id: payload.data.paymentId },
      include: {
        cashAccount: { select: { name: true } },
        receivable: {
          include: {
            customer: { select: { name: true, document: true } },
            sale: {
              include: {
                branch: { select: { id: true, name: true, address: true, phone: true } },
              },
            },
            payments: {
              select: { id: true, amount: true, createdAt: true, reversedAt: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    })

    if (
      !payment ||
      (!branchContext.isAll && payment.receivable.sale.branchId !== branchContext.branchId)
    ) {
      return NextResponse.json({ error: 'El cobro no existe o no pertenece a la sucursal seleccionada.' }, { status: 404 })
    }

    await logAudit({
      request,
      action: 'EXPORT',
      moduleName: 'Cuentas por cobrar',
      entity: 'ReceivablePaymentReceipt',
      entityId: payment.id,
      details: `Se imprimió la nota del cobro ${payment.reference ?? payment.id}.`,
      newValue: {
        reference: payment.reference,
        amount: Number(payment.amount),
        externalReference: payment.externalReference,
      },
    })

    return NextResponse.json({
      number: payment.reference ?? payment.id,
      paymentDate: payment.createdAt.toISOString(),
      customerName: payment.receivable.customer.name,
      customerDocument: payment.receivable.customer.document,
      branchName: payment.receivable.sale.branch?.name ?? '',
      saleNumber: payment.receivable.sale.number,
      invoiceNumber: 'S/D',
      concept: payment.description,
      amount: Number(payment.amount),
      paymentMethod: paymentLabels[payment.paymentMethod] ?? payment.paymentMethod,
      cashAccountName: payment.cashAccount.name,
      externalReference: payment.externalReference || 'S/D',
      recordedByAlias: payment.recordedByAlias || 'S/D',
    })
  } catch (error) {
    console.error('ERROR_ISSUING_RECEIVABLE_PAYMENT_NOTE', error)
    return NextResponse.json({ error: 'No se pudo generar la nota de cobro.' }, { status: 500 })
  }
}
