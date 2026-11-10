
import { randomUUID } from 'node:crypto'

import { postJournalEntry } from '@/lib/accounting'
import { prisma, serializableTransaction } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { nextDocumentNumber } from '@/lib/document-numbering'
import type { Prisma } from '@/lib/generated/prisma/client'

type BillingPeriod = 'MONTHLY' | 'ANNUAL'

function documentNumber(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`
}

function nextPeriod(date: Date, period: BillingPeriod) {
  const next = new Date(date)
  const day = date.getUTCDate()

  if (period === 'MONTHLY') {
    next.setUTCDate(1)
    next.setUTCMonth(next.getUTCMonth() + 1)
  } else {
    next.setUTCDate(1)
    next.setUTCFullYear(next.getUTCFullYear() + 1)
  }

  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
  next.setUTCDate(Math.min(day, lastDay))
  return next
}

export async function createSubscriptionInvoice(
  transaction: Prisma.TransactionClient,
  subscription: {
    id: string
    number: string
    unitPrice: Prisma.Decimal
    branchId: string
    customer: { id: string; paymentDays: number | null }
    serviceProduct: { id: string; name: string; cost: Prisma.Decimal }
  },
  periodStart: Date,
  actorId: string,
  payment: {
    amount: number
    method: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'QR' | 'OTHER' | 'CREDIT'
    cashAccountId?: string
    paymentReference?: string
    notes?: string
    requiresInvoice?: boolean
    date?: Date
    proformaId?: string
    customerOrderId?: string
  } = { amount: 0, method: 'CREDIT' },
) {
  const invoiceNumber = await nextDocumentNumber(transaction, 'V', actorId, subscription.branchId)
  const price = Number(subscription.unitPrice)
  const paymentAmount = Math.round((payment.amount + Number.EPSILON) * 100) / 100
  if (!Number.isFinite(paymentAmount) || paymentAmount < 0 || paymentAmount > price) {
    throw new Error('INVALID_INITIAL_PAYMENT')
  }
  if (payment.method === 'CREDIT' && paymentAmount > 0) throw new Error('INVALID_INITIAL_PAYMENT')
  const balanceDue = Math.round((price - paymentAmount + Number.EPSILON) * 100) / 100
  const createdAt = payment.date ?? new Date()
  const dueDate = new Date(createdAt)
  dueDate.setDate(dueDate.getDate() + Math.max(subscription.customer.paymentDays ?? 30, 0))
  const periodLabel = periodStart.toLocaleDateString('es-BO', { dateStyle: 'medium', timeZone: 'UTC' })
  const paymentNumber = paymentAmount > 0
    ? await nextDocumentNumber(transaction, 'C', actorId, subscription.branchId)
    : null

  let cashAccountId: string | undefined
  let createdCashAccount: { id: string; name: string } | null = null
  if (paymentAmount > 0 && payment.method === 'CASH') {
    const seller = await transaction.user.findUnique({
      where: { id: actorId },
      select: { id: true, alias: true },
    })
    if (!seller) throw new Error('SELLER_NOT_FOUND')
    let custodyAccount = await transaction.cashAccount.findFirst({
      where: { isActive: true, branchId: subscription.branchId, type: 'CASH', custodianId: seller.id },
    })
    if (!custodyAccount) {
      custodyAccount = await transaction.cashAccount.create({
        data: {
          name: `Efectivo en custodia - ${seller.alias}`,
          type: 'CASH',
          branchId: subscription.branchId,
          custodianId: seller.id,
        },
      })
      createdCashAccount = custodyAccount
    }
    cashAccountId = custodyAccount.id
  } else if (paymentAmount > 0 && payment.method !== 'CREDIT') {
    if (!payment.cashAccountId) throw new Error('CASH_ACCOUNT_REQUIRED')
    const account = await transaction.cashAccount.findFirst({
      where: {
        id: payment.cashAccountId,
        isActive: true,
        branchId: subscription.branchId,
        custodianId: null,
        ...(payment.method === 'BANK_TRANSFER' ? { type: 'BANK' } : {}),
        ...(payment.method === 'QR' ? { type: 'BANK' } : {}),
        ...(payment.method === 'CARD' ? { type: 'POS' } : {}),
      },
      select: { id: true },
    })
    if (!account) throw new Error('CASH_ACCOUNT_NOT_FOUND')
    cashAccountId = account.id
  }

  const sale = await transaction.sale.create({
    data: {
      number: invoiceNumber,
      paymentMethod: payment.method,
      paymentReference: payment.paymentReference || undefined,
      requiresInvoice: payment.requiresInvoice ?? false,
      currency: 'BOB',
      taxRate: 0,
      subtotal: price,
      discountTotal: 0,
      taxAmount: 0,
      total: price,
      cashAccountId,
      createdAt,
      notes: [
        `Servicio recurrente ${subscription.serviceProduct.name} · período desde ${periodLabel}`,
        payment.notes,
      ].filter(Boolean).join(' · ').slice(0, 500),
      customerId: subscription.customer.id,
      branchId: subscription.branchId,
      subscriptionId: subscription.id,
      subscriptionPeriodStart: periodStart,
      proformaId: payment.proformaId,
      customerOrderId: payment.customerOrderId,
      items: {
        create: {
          productId: subscription.serviceProduct.id,
          quantity: 1,
          unitPrice: price,
          discountPercent: 0,
          unitCost: 0,
          lineTotal: price,
        },
      },
    },
  })

  if (paymentAmount > 0 && cashAccountId) {
    await transaction.cashAccount.update({
      where: { id: cashAccountId },
      data: { balance: { increment: paymentAmount } },
    })
    await transaction.cashMovement.create({
      data: {
        type: 'IN',
        amount: paymentAmount,
        description: `Cobro de venta ${invoiceNumber}`,
        reference: paymentNumber ?? invoiceNumber,
        accountId: cashAccountId,
        saleId: sale.id,
        createdAt,
      },
    })
  }

  let receivableNumber: string | null = null
  if (balanceDue > 0) {
    receivableNumber = documentNumber('CXS')
    const receivable = await transaction.accountReceivable.create({
      data: {
        number: receivableNumber,
        originalAmount: price,
        paidAmount: paymentAmount,
        balance: balanceDue,
        dueDate,
        customerId: subscription.customer.id,
        saleId: sale.id,
        status: paymentAmount > 0 ? 'PARTIAL' : 'PENDING',
      },
    })

    if (paymentAmount > 0 && cashAccountId) {
      if (!paymentNumber) throw new Error('PAYMENT_REFERENCE_REQUIRED')
      const seller = await transaction.user.findUnique({
        where: { id: actorId },
        select: { alias: true },
      })
      await transaction.receivablePayment.create({
        data: {
          amount: paymentAmount,
          paymentMethod: payment.method,
          reference: paymentNumber,
          externalReference: payment.paymentReference || undefined,
          description: payment.notes || undefined,
          recordedByAlias: seller?.alias,
          receivableId: receivable.id,
          cashAccountId,
          createdAt,
        },
      })
    }
  }

  await postJournalEntry(transaction, {
    date: createdAt,
    description: `Servicio recurrente ${subscription.number} · factura ${invoiceNumber}`,
    sourceType: 'SALE',
    sourceId: sale.id,
    branchId: subscription.branchId,
    lines: [
      { accountCode: '1000', debit: paymentAmount },
      { accountCode: '1200', debit: balanceDue },
      { accountCode: '4000', credit: price },
    ],
  })

  if (createdCashAccount) {
    await logAudit({
      action: 'CREATE',
      moduleName: 'Caja y bancos',
      entity: 'CashAccount',
      entityId: createdCashAccount.id,
      details: `Se creo automaticamente la cuenta ${createdCashAccount.name} para registrar un servicio.`,
      newValue: { name: createdCashAccount.name, type: 'CASH', custodianId: actorId },
    }, transaction)
  }

  if (balanceDue < price) {
    await logAudit({
      action: 'CREATE',
      moduleName: 'Servicios',
      entity: 'Sale',
      entityId: sale.id,
      details: `Se registro la venta inicial ${invoiceNumber}: total ${price.toFixed(2)} Bs, pago ${paymentAmount.toFixed(2)} Bs, saldo ${balanceDue.toFixed(2)} Bs.`,
      newValue: {
        number: invoiceNumber,
        total: price,
        paymentAmount,
        balanceDue,
        paymentMethod: payment.method,
        requiresInvoice: payment.requiresInvoice ?? false,
      },
    }, transaction)
  }

  if (balanceDue === price) await logAudit({
    action: 'CREATE',
    moduleName: 'Servicios',
    entity: 'Sale',
    entityId: sale.id,
    details: `Se generó la cuenta por cobrar ${receivableNumber} por ${price.toFixed(2)} Bs para ${subscription.number}.`,
  }, transaction)

  return { sale, receivableNumber, paymentAmount, balanceDue }
}

export async function billDueSubscriptions() {
  return serializableTransaction(async (transaction) => {
    const now = new Date()
    const dueSubscriptions = await transaction.serviceSubscription.findMany({
      where: { status: 'ACTIVE', nextBillingDate: { lte: now } },
      include: {
        customer: { select: { id: true, paymentDays: true } },
        serviceProduct: { select: { id: true, name: true, cost: true } },
      },
      orderBy: { nextBillingDate: 'asc' },
      take: 100,
    })

    let billed = 0
    for (const subscription of dueSubscriptions) {
      if (subscription.billingPeriod !== 'MONTHLY' && subscription.billingPeriod !== 'ANNUAL') {
        throw new Error(`INVALID_SUBSCRIPTION_BILLING_PERIOD:${subscription.id}`)
      }
      const periodStart = subscription.nextBillingDate
      const upcomingDate = nextPeriod(periodStart, subscription.billingPeriod)
      const claim = await transaction.serviceSubscription.updateMany({
        where: {
          id: subscription.id,
          status: 'ACTIVE',
          nextBillingDate: periodStart,
        },
        data: { nextBillingDate: upcomingDate },
      })
      if (claim.count !== 1) continue

      await createSubscriptionInvoice(transaction, subscription, periodStart, 'SYS')
      billed += 1
    }

    return billed
  })
}

export function nextSubscriptionBillingDate(date: Date, period: BillingPeriod) {
  return nextPeriod(date, period)
}
