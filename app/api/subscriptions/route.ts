import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma, serializableTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { branchContextError, requireSingleBranch, resolveBranchContext } from '@/lib/branches'
import { createSubscriptionInvoice, nextSubscriptionBillingDate } from '@/lib/service-billing'

const createSchema = z.object({
  customerId: z.string().min(1),
  serviceProductId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER']),
  cashAccountId: z.string().min(1).optional(),
  paymentReference: z.string().trim().max(100).optional(),
  paymentAmount: z.coerce.number().finite().min(0),
  notes: z.string().trim().max(500).optional(),
  requiresInvoice: z.boolean().default(false),
})

const cancelSchema = z.object({ id: z.string().min(1) })

function subscriptionNumber() {
  return `SER-${Date.now().toString(36).toUpperCase()}`
}

export async function GET(request: Request) {
  const access = await requirePermission(request, 'sales:read')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError

  const subscriptions = await prisma.serviceSubscription.findMany({
    where: branchContext.isAll ? undefined : { branchId: branchContext.branchId! },
    include: {
      customer: { select: { id: true, name: true, document: true } },
      serviceProduct: { select: { id: true, name: true, sku: true } },
      branch: { select: { id: true, name: true } },
      invoices: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          number: true,
          total: true,
          receivable: { select: { number: true, balance: true, dueDate: true, status: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return NextResponse.json(subscriptions.map((subscription) => ({
    ...subscription,
    unitPrice: subscription.unitPrice.toString(),
    invoices: subscription.invoices.map((invoice) => ({
      ...invoice,
      total: invoice.total.toString(),
      receivable: invoice.receivable ? {
        ...invoice.receivable,
        balance: invoice.receivable.balance.toString(),
      } : null,
    })),
  })))
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'sales:write')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!
  const payload = createSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Selecciona un cliente y un servicio.' }, { status: 400 })
  const startedAt = new Date(`${payload.data.startDate}T12:00:00.000Z`)
  if (Number.isNaN(startedAt.getTime()) || startedAt.toISOString().slice(0, 10) !== payload.data.startDate) {
    return NextResponse.json({ error: 'Selecciona una fecha valida.' }, { status: 400 })
  }
  const paymentAmount = Math.round((payload.data.paymentAmount + Number.EPSILON) * 100) / 100
  if (paymentAmount > 0 && payload.data.paymentMethod === 'BANK_TRANSFER' && !payload.data.paymentReference) {
    return NextResponse.json({ error: 'El numero de comprobante es obligatorio para transferencias.' }, { status: 400 })
  }

  try {
    const result = await serializableTransaction(async (transaction) => {
      const [customer, serviceProduct] = await Promise.all([
        transaction.customer.findFirst({
          where: { id: payload.data.customerId, isActive: true },
          select: { id: true, name: true, paymentDays: true },
        }),
        transaction.product.findFirst({
          where: {
            id: payload.data.serviceProductId,
            isActive: true,
            type: 'SERVICE',
            serviceBillingPeriod: { in: ['MONTHLY', 'ANNUAL'] },
          },
          select: { id: true, name: true, price: true, cost: true, serviceBillingPeriod: true },
        }),
      ])
      if (!customer) throw new Error('CUSTOMER_NOT_FOUND')
      if (
        !serviceProduct ||
        (serviceProduct.serviceBillingPeriod !== 'MONTHLY' && serviceProduct.serviceBillingPeriod !== 'ANNUAL')
      ) {
        throw new Error('RECURRING_SERVICE_NOT_FOUND')
      }

      const nextBillingDate = nextSubscriptionBillingDate(startedAt, serviceProduct.serviceBillingPeriod)
      const subscription = await transaction.serviceSubscription.create({
        data: {
          number: subscriptionNumber(),
          billingPeriod: serviceProduct.serviceBillingPeriod,
          unitPrice: serviceProduct.price,
          startDate: startedAt,
          nextBillingDate,
          customerId: customer.id,
          serviceProductId: serviceProduct.id,
          branchId,
        },
        include: {
          customer: { select: { id: true, paymentDays: true } },
          serviceProduct: { select: { id: true, name: true, cost: true } },
        },
      })
      const { sale, receivableNumber, paymentAmount: recordedPaymentAmount, balanceDue } = await createSubscriptionInvoice(
        transaction,
        subscription,
        startedAt,
        access.session.userId,
        {
          amount: paymentAmount,
          method: payload.data.paymentMethod,
          cashAccountId: payload.data.cashAccountId,
          paymentReference: payload.data.paymentReference,
          notes: payload.data.notes,
          requiresInvoice: payload.data.requiresInvoice,
          date: startedAt,
        },
      )

      await logAudit({
        request,
        action: 'CREATE',
        moduleName: 'Servicios',
        entity: 'ServiceSubscription',
        entityId: subscription.id,
        details: `Se creó ${subscription.number} para ${customer.name}: ${serviceProduct.name}, ${serviceProduct.serviceBillingPeriod.toLowerCase()}.`,
        newValue: {
          number: subscription.number,
          customerId: customer.id,
          serviceProductId: serviceProduct.id,
          billingPeriod: serviceProduct.serviceBillingPeriod,
          unitPrice: Number(subscription.unitPrice),
          startDate: startedAt.toISOString(),
          paymentMethod: payload.data.paymentMethod,
          paymentAmount: recordedPaymentAmount,
          requiresInvoice: payload.data.requiresInvoice,
        },
      }, transaction)

      return {
        id: subscription.id,
        number: subscription.number,
        invoiceNumber: sale.number,
        receivableNumber,
        total: sale.total.toString(),
        paymentAmount: recordedPaymentAmount,
        balanceDue,
        nextBillingDate,
      }
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('ERROR_CREATING_SERVICE_SUBSCRIPTION', error)
    if (error instanceof Error && error.message === 'INVALID_INITIAL_PAYMENT') {
      return NextResponse.json({ error: 'El pago inicial no puede superar el precio del servicio.' }, { status: 400 })
    }
    if (error instanceof Error && error.message === 'CASH_ACCOUNT_REQUIRED') {
      return NextResponse.json({ error: 'Selecciona una cuenta para registrar el pago.' }, { status: 400 })
    }
    if (error instanceof Error && error.message === 'CASH_ACCOUNT_NOT_FOUND') {
      return NextResponse.json({ error: 'La cuenta seleccionada no existe, no corresponde al medio de pago o no esta activa.' }, { status: 400 })
    }
    if (error instanceof Error && error.message === 'SELLER_NOT_FOUND') {
      return NextResponse.json({ error: 'No se pudo identificar al usuario que recibe el efectivo.' }, { status: 400 })
    }
    const message = error instanceof Error && error.message === 'CUSTOMER_NOT_FOUND'
      ? 'El cliente no existe o está inactivo.'
      : error instanceof Error && error.message === 'RECURRING_SERVICE_NOT_FOUND'
        ? 'El servicio no existe, está inactivo o no tiene una frecuencia mensual/anual.'
        : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_CLOSED'
          ? 'El período contable de esta fecha está cerrado.'
          : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_NOT_STARTED'
            ? 'La fecha de operación es anterior al inicio del libro mayor.'
            : 'No se pudo iniciar el servicio y crear su primera cuenta por cobrar.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  const access = await requirePermission(request, 'sales:write')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!
  const payload = cancelSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Selecciona un servicio válido.' }, { status: 400 })

  try {
    const subscription = await serializableTransaction(async (transaction) => {
      const current = await transaction.serviceSubscription.findFirst({
        where: { id: payload.data.id, branchId },
        select: { id: true, number: true, status: true },
      })
      if (!current || current.status !== 'ACTIVE') throw new Error('SUBSCRIPTION_NOT_ACTIVE')

      const updated = await transaction.serviceSubscription.update({
        where: { id: current.id },
        data: { status: 'CANCELLED' },
      })
      await logAudit({
        request,
        action: 'UPDATE',
        moduleName: 'Servicios',
        entity: 'ServiceSubscription',
        entityId: current.id,
        details: `Se detuvo el servicio ${current.number}.`,
        oldValue: { status: current.status },
        newValue: { status: updated.status },
      }, transaction)
      return { id: updated.id, number: updated.number, status: updated.status }
    })

    return NextResponse.json(subscription)
  } catch (error) {
    console.error('ERROR_CANCELLING_SERVICE_SUBSCRIPTION', error)
    const message = error instanceof Error && error.message === 'SUBSCRIPTION_NOT_ACTIVE'
      ? 'El servicio no existe, no pertenece a esta sucursal o ya fue detenido.'
      : 'No se pudo detener el servicio.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
