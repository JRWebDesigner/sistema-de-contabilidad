import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { prisma, serializableTransaction } from '@/lib/db'
import { requirePermission, rolePermissions } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { postJournalEntry } from '@/lib/accounting'
import { resolveSalesPricing } from '@/lib/sales-pricing'
import { adjustBranchStock } from '@/lib/branch-stock'
import { nextDocumentNumber } from '@/lib/document-numbering'
import { createSubscriptionInvoice, nextSubscriptionBillingDate } from '@/lib/service-billing'
import { branchContextError, branchWhere, requireSingleBranch, resolveBranchContext } from '@/lib/branches'

const orderSchema = z.object({
  customerId: z.string().min(1),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
    discountPercent: z.coerce.number().min(0).max(100).default(0),
  })).min(1),
})

const orderActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('deliver'),
    orderId: z.string().min(1),
    receivedByName: z.string().trim().min(1).max(120),
    paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'QR', 'CREDIT', 'OTHER']),
    paymentAmount: z.coerce.number().finite().min(0),
    cashAccountId: z.string().min(1).optional(),
    paymentReference: z.string().trim().max(100).optional(),
    requiresInvoice: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('cancel'),
    orderId: z.string().min(1),
  }),
])

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

function receivableNumber() {
  return `CXC-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`
}

export async function GET(request: Request) {
  const access = await requirePermission(request, 'sales:read')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError

  const orders = await prisma.customerOrder.findMany({
    where: branchWhere(branchContext),
    include: {
      customer: { select: { id: true, name: true, document: true } },
      seller: { select: { id: true, alias: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, type: true, serviceBillingPeriod: true } },
        },
      },
      sales: { select: { id: true, number: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return NextResponse.json(orders.map((order) => ({
    ...order,
    subtotal: order.subtotal.toString(),
    discountTotal: order.discountTotal.toString(),
    total: order.total.toString(),
    items: order.items.map((item) => ({
      ...item,
      unitPrice: item.unitPrice.toString(),
      discountPercent: item.discountPercent.toString(),
      lineTotal: item.lineTotal.toString(),
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
  const payload = orderSchema.safeParse(await request.json())

  if (!payload.success) {
    return NextResponse.json({ error: 'Selecciona un cliente y al menos un producto o servicio válido.' }, { status: 400 })
  }
  const canDiscount = access.session?.role
    ? rolePermissions(access.session.role).includes('sales:discount')
    : false
  if (!canDiscount && payload.data.items.some((item) => item.discountPercent > 0)) {
    return NextResponse.json({ error: 'Solo un administrador puede aplicar descuentos.' }, { status: 403 })
  }
  if (new Set(payload.data.items.map((item) => item.productId)).size !== payload.data.items.length) {
    return NextResponse.json({ error: 'No repitas el mismo producto o servicio en un pedido.' }, { status: 400 })
  }
  const orderDate = new Date(`${payload.data.orderDate}T12:00:00.000Z`)
  if (!Number.isFinite(orderDate.getTime()) || orderDate.toISOString().slice(0, 10) !== payload.data.orderDate) {
    return NextResponse.json({ error: 'Selecciona una fecha de pedido válida.' }, { status: 400 })
  }

  try {
    const order = await serializableTransaction(async (transaction) => {
      const customer = await transaction.customer.findFirst({
        where: { id: payload.data.customerId, isActive: true },
        select: { id: true },
      })
      if (!customer) throw new Error('CUSTOMER_NOT_FOUND')
      const products = await transaction.product.findMany({
        where: { id: { in: payload.data.items.map((item) => item.productId) }, isActive: true },
      })
      if (products.length !== payload.data.items.length) throw new Error('PRODUCT_NOT_FOUND')

      const productById = new Map(products.map((product) => [product.id, product]))
      const salesPricing = await resolveSalesPricing(
        transaction,
        payload.data.items.map((item) => item.productId),
        customer.id,
      )
      const lines = payload.data.items.map((item) => {
        const product = productById.get(item.productId)
        if (!product) throw new Error('PRODUCT_NOT_FOUND')
        if (product.type === 'SERVICE' && !product.serviceBillingPeriod) {
          throw new Error('SERVICE_BILLING_PERIOD_REQUIRED')
        }
        const effectivePrice = salesPricing.prices.get(product.id)
        const unitPrice = effectivePrice?.unitPrice ?? Number(product.price)
        const promotionDiscountPercent = effectivePrice?.promotionDiscountPercent ?? 0
        const discountPercent = Math.max(item.discountPercent, promotionDiscountPercent)
        return {
          product,
          quantity: item.quantity,
          unitPrice,
          discountPercent,
          promotionName: promotionDiscountPercent > item.discountPercent ? effectivePrice?.promotionName ?? null : null,
          lineTotal: roundMoney(unitPrice * item.quantity * (1 - discountPercent / 100)),
        }
      })
      const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0))
      const total = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0))
      const discountTotal = roundMoney(subtotal - total)

      const created = await transaction.customerOrder.create({
        data: {
          number: await nextDocumentNumber(transaction, 'PED', access.session.userId, branchId),
          status: 'PENDING',
          createdAt: orderDate,
          notes: payload.data.notes || undefined,
          subtotal,
          discountTotal,
          total,
          customerId: customer.id,
          branchId,
          sellerId: access.session.userId,
          items: {
            create: lines.map((line) => ({
              productId: line.product.id,
              quantity: line.quantity,
              productType: line.product.type,
              serviceBillingPeriod: line.product.serviceBillingPeriod,
              unitPrice: line.unitPrice,
              discountPercent: line.discountPercent,
              promotionName: line.promotionName,
              lineTotal: line.lineTotal,
            })),
          },
        },
        include: {
          customer: { select: { id: true, name: true, document: true } },
          seller: { select: { id: true, alias: true, name: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true, type: true, serviceBillingPeriod: true } } } },
        },
      })

      await logAudit({
        request,
        action: 'CREATE',
        moduleName: 'Pedidos',
        entity: 'CustomerOrder',
        entityId: created.id,
        details: `Se registró el pedido ${created.number} por ${total.toFixed(2)} Bs.`,
      }, transaction)
      return created
    })

    return NextResponse.json({
      ...order,
      subtotal: order.subtotal.toString(),
      discountTotal: order.discountTotal.toString(),
      total: order.total.toString(),
      items: order.items.map((item) => ({
        ...item,
        unitPrice: item.unitPrice.toString(),
        discountPercent: item.discountPercent.toString(),
        lineTotal: item.lineTotal.toString(),
      })),
    }, { status: 201 })
  } catch (error) {
    console.error('ERROR_CREATING_CUSTOMER_ORDER', error)
    const message = error instanceof Error && error.message === 'CUSTOMER_NOT_FOUND'
      ? 'El cliente no existe o está inactivo.'
      : error instanceof Error && error.message === 'PRODUCT_NOT_FOUND'
        ? 'Uno de los productos o servicios no existe o está inactivo.'
        : error instanceof Error && error.message === 'SERVICE_BILLING_PERIOD_REQUIRED'
          ? 'Configura el período de facturación del servicio antes de agregarlo al pedido.'
          : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_CLOSED'
            ? 'El período contable de esta fecha está cerrado.'
            : 'No se pudo registrar el pedido.'
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
  const payload = orderActionSchema.safeParse(await request.json())
  if (!payload.success) {
    return NextResponse.json({ error: 'Revisa la acción del pedido y los datos requeridos.' }, { status: 400 })
  }

  try {
    const result = await serializableTransaction(async (transaction) => {
      const order = await transaction.customerOrder.findFirst({
        where: { id: payload.data.orderId, branchId },
        include: {
          customer: { select: { id: true, name: true, paymentDays: true, credit: true, creditLimit: true } },
          items: { include: { product: true } },
        },
      })
      if (!order) throw new Error('ORDER_NOT_FOUND')
      if (order.status !== 'PENDING') throw new Error('ORDER_ALREADY_PROCESSED')

      if (payload.data.action === 'cancel') {
        const cancelled = await transaction.customerOrder.updateMany({
          where: { id: order.id, branchId, status: 'PENDING' },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        })
        if (cancelled.count !== 1) throw new Error('ORDER_ALREADY_PROCESSED')
        await logAudit({
          request,
          action: 'UPDATE',
          moduleName: 'Pedidos',
          entity: 'CustomerOrder',
          entityId: order.id,
          details: `Se canceló el pedido ${order.number}.`,
        }, transaction)
        return { orderId: order.id, status: 'CANCELLED' as const, sales: [] }
      }

      const {
        receivedByName,
        paymentMethod,
        paymentAmount,
        cashAccountId: requestedCashAccountId,
        paymentReference,
        requiresInvoice,
      } = payload.data
      if (paymentMethod === 'CREDIT' && paymentAmount > 0) throw new Error('INVALID_CREDIT_PAYMENT')
      if (paymentAmount > Number(order.total)) throw new Error('PAYMENT_EXCEEDS_TOTAL')
      if (paymentAmount > 0 && ['BANK_TRANSFER', 'QR'].includes(paymentMethod) && !paymentReference) {
        throw new Error('PAYMENT_REFERENCE_REQUIRED')
      }
      const balanceDue = roundMoney(Number(order.total) - paymentAmount)
      if (balanceDue > 0 && !order.customerId) throw new Error('CUSTOMER_REQUIRED')

      if (paymentMethod === 'CREDIT') {
        if (!order.customer.credit || !order.customer.creditLimit) throw new Error('CREDIT_NOT_AUTHORIZED')
        const pending = await transaction.accountReceivable.aggregate({
          where: { customerId: order.customerId, status: { not: 'CANCELLED' } },
          _sum: { balance: true },
        })
        if (Number(pending._sum.balance ?? 0) + Number(order.total) > Number(order.customer.creditLimit)) {
          throw new Error('CREDIT_LIMIT_EXCEEDED')
        }
      }

      const recurringItems = order.items.filter((item) =>
        item.productType === 'SERVICE' &&
        (item.serviceBillingPeriod === 'MONTHLY' || item.serviceBillingPeriod === 'ANNUAL'),
      )
      const normalItems = order.items.filter((item) => !recurringItems.some((recurring) => recurring.id === item.id))
      if (order.items.some((item) =>
        !item.product.isActive ||
        item.product.type !== item.productType ||
        item.product.serviceBillingPeriod !== item.serviceBillingPeriod,
      )) throw new Error('ORDER_ITEM_CHANGED')
      const normalTotal = roundMoney(normalItems.reduce((sum, item) => sum + Number(item.lineTotal), 0))
      const normalPayment = Math.min(paymentAmount, normalTotal)
      let remainingPayment = roundMoney(paymentAmount - normalPayment)
      let resolvedCashAccountId: string | undefined
      let createdCashAccount: { id: string; name: string } | null = null
      if (paymentAmount > 0 && paymentMethod === 'CASH') {
        const seller = await transaction.user.findUnique({
          where: { id: access.session.userId },
          select: { id: true, alias: true },
        })
        if (!seller) throw new Error('SELLER_NOT_FOUND')
        resolvedCashAccountId = (await transaction.cashAccount.findFirst({
          where: { isActive: true, branchId, type: 'CASH', custodianId: seller.id },
          select: { id: true },
        }))?.id
        if (!resolvedCashAccountId) {
          const account = await transaction.cashAccount.create({
            data: { name: `Efectivo en custodia - ${seller.alias}`, type: 'CASH', branchId, custodianId: seller.id },
            select: { id: true, name: true },
          })
          resolvedCashAccountId = account.id
          createdCashAccount = account
        }
      } else if (paymentAmount > 0) {
        if (!requestedCashAccountId) throw new Error('CASH_ACCOUNT_REQUIRED')
        const account = await transaction.cashAccount.findFirst({
          where: {
            id: requestedCashAccountId,
            isActive: true,
            branchId,
            custodianId: null,
            ...(paymentMethod === 'BANK_TRANSFER' || paymentMethod === 'QR' ? { type: 'BANK' } : {}),
            ...(paymentMethod === 'CARD' ? { type: 'POS' } : {}),
          },
          select: { id: true },
        })
        if (!account) throw new Error('CASH_ACCOUNT_NOT_FOUND')
        resolvedCashAccountId = account.id
      }

      const branchStocks = await transaction.productStock.findMany({
        where: {
          branchId,
          productId: { in: normalItems.filter((item) => item.productType === 'PRODUCT').map((item) => item.productId) },
        },
        select: { productId: true, quantity: true },
      })
      const branchStockByProduct = new Map(branchStocks.map((stock) => [stock.productId, stock.quantity]))
      if (normalItems.some((item) =>
        item.productType === 'PRODUCT' && (branchStockByProduct.get(item.productId) ?? 0) < item.quantity,
      )) throw new Error('INSUFFICIENT_BRANCH_STOCK')

      const transitioned = await transaction.customerOrder.updateMany({
        where: { id: order.id, branchId, status: 'PENDING' },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          receivedByName,
        },
      })
      if (transitioned.count !== 1) throw new Error('ORDER_ALREADY_PROCESSED')

      const createdSales: Array<{ id: string; number: string }> = []
      if (normalItems.length > 0) {
        const subtotal = roundMoney(normalItems.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0))
        const discountTotal = roundMoney(normalItems.reduce((sum, item) =>
          sum + roundMoney(Number(item.unitPrice) * item.quantity * Number(item.discountPercent) / 100), 0))
        const saleNumber = await nextDocumentNumber(transaction, 'V', access.session.userId, branchId)
        const paymentNumber = normalPayment > 0
          ? await nextDocumentNumber(transaction, 'C', access.session.userId, branchId)
          : null
        const sale = await transaction.sale.create({
          data: {
            number: saleNumber,
            customerOrderId: order.id,
            customerId: order.customerId,
            branchId,
            sellerId: access.session.userId,
            cashAccountId: normalPayment > 0 ? resolvedCashAccountId : undefined,
            paymentMethod,
            paymentReference: paymentReference || undefined,
            requiresInvoice,
            notes: [order.notes, `Entregado desde pedido ${order.number}`].filter(Boolean).join(' · ').slice(0, 500),
            taxRate: 0,
            subtotal,
            discountTotal,
            taxAmount: 0,
            total: normalTotal,
            items: {
              create: normalItems.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                discountPercent: item.discountPercent,
                promotionName: item.promotionName,
                unitCost: item.productType === 'PRODUCT' ? item.product.cost : 0,
                lineTotal: item.lineTotal,
              })),
            },
          },
          include: { items: true },
        })
        createdSales.push({ id: sale.id, number: sale.number })

        for (const item of normalItems) {
          if (item.productType !== 'PRODUCT') continue
          await adjustBranchStock(transaction, item.productId, branchId, -item.quantity)
          await transaction.inventoryMovement.create({
            data: {
              type: 'SALE',
              quantity: -item.quantity,
              unitCost: item.product.cost,
              reference: sale.number,
              productId: item.productId,
              saleId: sale.id,
              branchId,
            },
          })
        }

        if (normalPayment > 0 && resolvedCashAccountId) {
          await transaction.cashAccount.update({
            where: { id: resolvedCashAccountId },
            data: { balance: { increment: normalPayment } },
          })
          await transaction.cashMovement.create({
            data: {
              type: 'IN',
              amount: normalPayment,
              description: `Cobro de venta ${sale.number}`,
              reference: paymentNumber ?? sale.number,
              accountId: resolvedCashAccountId,
              saleId: sale.id,
            },
          })
        }

        const dueAmount = roundMoney(normalTotal - normalPayment)
        if (dueAmount > 0) {
          const dueDate = new Date()
          dueDate.setDate(dueDate.getDate() + (order.customer.paymentDays ?? 30))
          const receivable = await transaction.accountReceivable.create({
            data: {
              number: receivableNumber(),
              originalAmount: normalTotal,
              paidAmount: normalPayment,
              balance: dueAmount,
              dueDate,
              customerId: order.customerId,
              saleId: sale.id,
              status: normalPayment > 0 ? 'PARTIAL' : 'PENDING',
            },
          })
          if (normalPayment > 0 && resolvedCashAccountId && paymentNumber) {
            const seller = await transaction.user.findUnique({
              where: { id: access.session.userId },
              select: { alias: true },
            })
            await transaction.receivablePayment.create({
              data: {
                amount: normalPayment,
                paymentMethod,
                reference: paymentNumber,
                externalReference: paymentReference || undefined,
                recordedByAlias: seller?.alias,
                receivableId: receivable.id,
                cashAccountId: resolvedCashAccountId,
              },
            })
          }
        }

        const costOfGoods = roundMoney(normalItems.reduce((sum, item) =>
          sum + (item.productType === 'PRODUCT' ? Number(item.product.cost) * item.quantity : 0), 0))
        await postJournalEntry(transaction, {
          date: sale.createdAt,
          description: `Venta ${sale.number} desde pedido ${order.number}`,
          sourceType: 'SALE',
          sourceId: sale.id,
          branchId,
          lines: [
            { accountCode: '1000', debit: normalPayment },
            { accountCode: '1200', debit: dueAmount },
            { accountCode: '4000', credit: normalTotal },
            { accountCode: '5000', debit: costOfGoods },
            { accountCode: '1300', credit: costOfGoods },
          ],
        })
      }

      if (recurringItems.length > 0) {
        for (const item of recurringItems) {
          const period = item.serviceBillingPeriod
          if (period !== 'MONTHLY' && period !== 'ANNUAL') throw new Error('INVALID_SERVICE_BILLING_PERIOD')
          const totalCents = Math.round(Number(item.lineTotal) * 100)
          const unitCents = Math.floor(totalCents / item.quantity)
          const remainderCents = totalCents % item.quantity
          for (let index = 0; index < item.quantity; index += 1) {
            const unitPrice = (unitCents + (index < remainderCents ? 1 : 0)) / 100
            const initialPayment = Math.min(remainingPayment, unitPrice)
            remainingPayment = roundMoney(remainingPayment - initialPayment)
            const startDate = new Date()
            const subscription = await transaction.serviceSubscription.create({
              data: {
                number: `SRV-${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`,
                billingPeriod: period,
                unitPrice,
                startDate,
                nextBillingDate: nextSubscriptionBillingDate(startDate, period),
                customerId: order.customerId,
                serviceProductId: item.productId,
                branchId,
              },
              include: {
                customer: { select: { id: true, paymentDays: true } },
                serviceProduct: { select: { id: true, name: true, cost: true } },
              },
            })
            const { sale } = await createSubscriptionInvoice(
              transaction,
              subscription,
              startDate,
              access.session.userId,
              {
                amount: initialPayment,
                method: paymentMethod,
                cashAccountId: resolvedCashAccountId,
                paymentReference,
                requiresInvoice,
                notes: `Entregado desde pedido ${order.number}${order.notes ? ` · ${order.notes}` : ''}`,
                customerOrderId: order.id,
              },
            )
            createdSales.push({ id: sale.id, number: sale.number })
          }
        }
      }

      if (createdCashAccount) {
        await logAudit({
          request,
          action: 'CREATE',
          moduleName: 'Caja y bancos',
          entity: 'CashAccount',
          entityId: createdCashAccount.id,
          details: `Se creó automáticamente la cuenta ${createdCashAccount.name} para registrar la entrega del pedido ${order.number}.`,
          newValue: { name: createdCashAccount.name, type: 'CASH', custodianId: access.session.userId },
        }, transaction)
      }
      await logAudit({
        request,
        action: 'UPDATE',
        moduleName: 'Pedidos',
        entity: 'CustomerOrder',
        entityId: order.id,
        details: `Se entregó el pedido ${order.number} a ${receivedByName} y se generaron ${createdSales.length} venta(s) o factura(s).`,
      }, transaction)
      return { orderId: order.id, status: 'DELIVERED' as const, sales: createdSales }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('ERROR_PROCESSING_CUSTOMER_ORDER', error)
    const message = error instanceof Error && error.message === 'ORDER_NOT_FOUND'
      ? 'El pedido no existe en la sucursal seleccionada.'
      : error instanceof Error && error.message === 'ORDER_ALREADY_PROCESSED'
        ? 'El pedido ya fue entregado o cancelado.'
        : error instanceof Error && error.message === 'CUSTOMER_REQUIRED'
          ? 'El pedido a crédito necesita un cliente.'
          : error instanceof Error && error.message === 'CREDIT_NOT_AUTHORIZED'
            ? 'El cliente no tiene crédito habilitado o no tiene un límite definido.'
            : error instanceof Error && error.message === 'CREDIT_LIMIT_EXCEEDED'
              ? 'El pedido supera el límite de crédito disponible del cliente.'
              : error instanceof Error && error.message === 'PAYMENT_EXCEEDS_TOTAL'
                ? 'El pago no puede ser mayor al total del pedido.'
                : error instanceof Error && error.message === 'INVALID_CREDIT_PAYMENT'
                  ? 'El medio Crédito no puede registrar un abono; usa otro medio de pago.'
                  : error instanceof Error && error.message === 'PAYMENT_REFERENCE_REQUIRED'
                    ? 'El número de comprobante es obligatorio para transferencias y pagos QR.'
                    : error instanceof Error && error.message === 'CASH_ACCOUNT_REQUIRED'
                      ? 'Selecciona la cuenta donde se recibió el pago.'
                      : error instanceof Error && error.message === 'CASH_ACCOUNT_NOT_FOUND'
                        ? 'La cuenta seleccionada no existe, está inactiva o no corresponde al medio de pago.'
                        : error instanceof Error && error.message === 'INSUFFICIENT_BRANCH_STOCK'
                          ? 'No hay suficiente stock para entregar el pedido.'
                                    : error instanceof Error && error.message === 'ORDER_ITEM_CHANGED'
                                      ? 'Un producto o servicio del pedido fue desactivado o cambió de tipo/período. Revisa el pedido antes de entregarlo.'
                                    : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_CLOSED'
                            ? 'El período contable de esta fecha está cerrado.'
                            : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_NOT_STARTED'
                              ? 'La fecha de operación es anterior al inicio del libro mayor.'
                              : 'No se pudo procesar la entrega del pedido.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
