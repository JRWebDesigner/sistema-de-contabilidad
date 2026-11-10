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

const proformaItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
})

const proformaSchema = z.object({
  customerId: z.string().min(1).optional(),
  notes: z.string().trim().max(500).optional(),
  items: z.array(proformaItemSchema).min(1),
})

const acceptSchema = z.object({
  proformaId: z.string().min(1),
  action: z.enum(['accept', 'reject']),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'QR', 'CREDIT']).optional(),
  paymentAmount: z.coerce.number().finite().min(0).optional(),
  paymentReference: z.string().trim().max(100).optional(),
  cashAccountId: z.string().min(1).optional(),
})

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

function proformaNumber() {
  return `PF-${Date.now().toString(36).toUpperCase()}`
}

function receivableNumber() {
  return `CXC-${Date.now().toString(36).toUpperCase()}`
}

export async function GET(request: Request) {
  const access = await requirePermission(request, 'sales:read')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError

  const proformas = await prisma.proforma.findMany({
    where: branchWhere(branchContext),
    include: {
      customer: { select: { id: true, name: true, document: true } },
      items: { include: { product: { select: { id: true, name: true, sku: true, serviceBillingPeriod: true } } } },
      sales: { select: { id: true, number: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const now = new Date()
  return NextResponse.json(proformas.map((proforma) => ({
    ...proforma,
    status: proforma.status === 'SENT' && proforma.validUntil <= now ? 'EXPIRED' : proforma.status,
    taxRate: proforma.taxRate.toString(),
    subtotal: proforma.subtotal.toString(),
    discountTotal: proforma.discountTotal.toString(),
    taxAmount: proforma.taxAmount.toString(),
    total: proforma.total.toString(),
    items: proforma.items.map((item) => ({
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

  const payload = proformaSchema.safeParse(await request.json())
  if (!payload.success) {
    return NextResponse.json({ error: 'Revisa los productos y los datos de la proforma.' }, { status: 400 })
  }

  const canDiscount = access.session?.role
    ? rolePermissions(access.session.role).includes('sales:discount')
    : false
  if (!canDiscount && payload.data.items.some((item) => item.discountPercent > 0)) {
    return NextResponse.json({ error: 'Solo un administrador puede aplicar descuentos.' }, { status: 403 })
  }

  const uniqueProductIds = new Set(payload.data.items.map((item) => item.productId))
  if (uniqueProductIds.size !== payload.data.items.length) {
    return NextResponse.json({ error: 'No repitas el mismo producto en una proforma.' }, { status: 400 })
  }

  try {
    const products = await prisma.product.findMany({
      where: {
        id: { in: payload.data.items.map((item) => item.productId) },
        isActive: true,
        OR: [
          { type: 'PRODUCT' },
          { type: 'SERVICE' },
        ],
      },
    })

    if (products.length !== payload.data.items.length) {
      throw new Error('PRODUCT_NOT_FOUND')
    }

    const productById = new Map(products.map((product) => [product.id, product]))
    const salesPricing = await prisma.$transaction((transaction) =>
      resolveSalesPricing(transaction, payload.data.items.map((item) => item.productId), payload.data.customerId),
    )
    const effectivePrices = salesPricing.prices
    const lines = payload.data.items.map((item) => {
      const product = productById.get(item.productId)
      if (!product) throw new Error('PRODUCT_NOT_FOUND')

      const effectivePrice = effectivePrices.get(product.id)
      const unitPrice = effectivePrice?.unitPrice ?? Number(product.price)
      const promotionDiscountPercent = effectivePrice?.promotionDiscountPercent ?? 0
      const usesPromotion = promotionDiscountPercent > item.discountPercent
      const discountPercent = Math.max(item.discountPercent, promotionDiscountPercent)
      const discountAmount = roundMoney(unitPrice * item.quantity * discountPercent / 100)
      return {
        product,
        quantity: item.quantity,
        unitPrice,
        discountPercent,
        promotionName: usesPromotion ? effectivePrice?.promotionName ?? null : null,
        discountAmount,
        lineTotal: roundMoney(unitPrice * item.quantity - discountAmount),
      }
    })

    const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0))
    const discountTotal = roundMoney(lines.reduce((sum, line) => sum + line.discountAmount, 0))
    const taxAmount = 0
    const total = roundMoney(subtotal - discountTotal)
    const validUntil = new Date()
    validUntil.setDate(validUntil.getDate() + 15)

    const created = await prisma.$transaction(async (transaction) => {
      const proforma = await transaction.proforma.create({
        data: {
          number: proformaNumber(),
          branchId,
          customerId: payload.data.customerId,
          notes: payload.data.notes || undefined,
          priceListName: salesPricing.priceListName,
          taxRate: 0,
          subtotal,
          discountTotal,
          taxAmount,
          total,
          validUntil,
          items: {
            create: lines.map((line) => ({
              productId: line.product.id,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountPercent: line.discountPercent,
              promotionName: line.promotionName,
              lineTotal: line.lineTotal,
            })),
          },
        },
        include: {
          customer: { select: { id: true, name: true, document: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true, serviceBillingPeriod: true } } } },
        },
      })

      await logAudit({
        request,
        action: 'CREATE',
        moduleName: 'Proformas',
        entity: 'Proforma',
        entityId: proforma.id,
        details: `Se creó la proforma ${proforma.number} para ${proforma.customer?.name ?? 'cliente sin nombre'} por ${Number(proforma.total).toFixed(2)}${discountTotal > 0 ? `, con descuentos por ${discountTotal.toFixed(2)}` : ''}.`,
      }, transaction)
      return proforma
    })

    return NextResponse.json({
      ...created,
      taxRate: created.taxRate.toString(),
      subtotal: created.subtotal.toString(),
      discountTotal: created.discountTotal.toString(),
      taxAmount: created.taxAmount.toString(),
      total: created.total.toString(),
      items: created.items.map((item) => ({
        ...item,
        unitPrice: item.unitPrice.toString(),
        discountPercent: item.discountPercent.toString(),
        lineTotal: item.lineTotal.toString(),
      })),
    }, { status: 201 })
  } catch (error) {
    console.error('ERROR_CREATING_PROFORMA', error)

    const message = error instanceof Error && error.message === 'PRODUCT_NOT_FOUND'
      ? 'Uno de los productos ya no está disponible.'
      : 'No se pudo guardar la proforma.'

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

  const payload = acceptSchema.safeParse(await request.json())
  if (!payload.success) {
    return NextResponse.json({ error: 'Revisa la acción de la proforma.' }, { status: 400 })
  }

  const { action, proformaId, paymentMethod, paymentAmount: requestedPaymentAmount, paymentReference, cashAccountId } = payload.data

  try {
    const proforma = await prisma.proforma.findUnique({
      where: { id: proformaId },
      include: {
        customer: { select: { id: true, name: true, document: true } },
        items: { include: { product: true } },
      },
    })

    if (!proforma) {
      return NextResponse.json({ error: 'La proforma no existe.' }, { status: 404 })
    }
    if (proforma.branchId !== branchId) return NextResponse.json({ error: 'La proforma no pertenece a la sucursal seleccionada.' }, { status: 404 })

    if (proforma.status === 'SENT' && proforma.validUntil <= new Date()) {
      return NextResponse.json({ error: 'La proforma venció y ya no se puede procesar.' }, { status: 409 })
    }

    if (action === 'reject') {
      await prisma.$transaction(async (transaction) => {
        const rejected = await transaction.proforma.updateMany({
          where: { id: proformaId, branchId, status: 'SENT', validUntil: { gt: new Date() } },
          data: { status: 'REJECTED', rejectedAt: new Date() },
        })
        if (rejected.count !== 1) throw new Error('PROFORMA_ALREADY_PROCESSED')

        await logAudit({
          request,
          action: 'REJECT',
          moduleName: 'Proformas',
          entity: 'Proforma',
          entityId: proformaId,
          details: `Se rechazó la proforma ${proforma.number}.`,
        }, transaction)
      })
      return NextResponse.json({ status: 'REJECTED' })
    }

    if (proforma.status !== 'SENT') {
      return NextResponse.json({ error: 'La proforma ya fue procesada.' }, { status: 400 })
    }

    const selectedPaymentMethod = paymentMethod ?? 'CASH'
    const total = roundMoney(Number(proforma.total))
    const paymentAmount = roundMoney(requestedPaymentAmount ?? (selectedPaymentMethod === 'CREDIT' ? 0 : total))
    if (paymentAmount > total) {
      return NextResponse.json({ error: 'El abono no puede ser mayor al total de la proforma.' }, { status: 400 })
    }
    if (selectedPaymentMethod === 'CREDIT' && paymentAmount > 0) {
      return NextResponse.json({ error: 'Para pagar a crédito, el abono inicial debe ser Bs 0,00.' }, { status: 400 })
    }
    const balanceDue = roundMoney(total - paymentAmount)
    if (balanceDue > 0 && !proforma.customerId) {
      return NextResponse.json({ error: 'Selecciona un cliente para registrar el saldo pendiente en cuentas por cobrar.' }, { status: 400 })
    }
    if (paymentAmount > 0 && ['BANK_TRANSFER', 'QR'].includes(selectedPaymentMethod) && !paymentReference) {
      return NextResponse.json({ error: 'El número de comprobante es obligatorio para transferencias y pagos QR.' }, { status: 400 })
    }

    const recurringItems = proforma.items.filter((item) =>
      item.product.type === 'SERVICE' &&
      (item.product.serviceBillingPeriod === 'MONTHLY' || item.product.serviceBillingPeriod === 'ANNUAL'),
    )
    if (recurringItems.length > 0 && !proforma.customerId) {
      return NextResponse.json({ error: 'Los servicios mensuales o anuales requieren un cliente.' }, { status: 400 })
    }
    if (selectedPaymentMethod === 'CREDIT' && !proforma.customerId) {
      return NextResponse.json({ error: 'La proforma a crédito necesita un cliente.' }, { status: 400 })
    }

    const sales = await serializableTransaction(async (transaction) => {
      let resolvedCashAccountId: string | undefined
      let createdCashAccount: { id: string; name: string } | null = null
      let creditPaymentDays = 30
      const decisionTime = new Date()
      const claimed = await transaction.proforma.updateMany({
        where: { id: proformaId, branchId, status: 'SENT', validUntil: { gt: decisionTime } },
        data: { status: 'ACCEPTED', acceptedAt: decisionTime, paymentMethod: selectedPaymentMethod },
      })
      if (claimed.count !== 1) throw new Error('PROFORMA_ALREADY_PROCESSED')

      const normalItems = proforma.items.filter((item) => !recurringItems.some((recurring) => recurring.id === item.id))
      const normalTotal = roundMoney(normalItems.reduce((sum, item) => sum + Number(item.lineTotal), 0))
      const normalLines = normalItems.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        discountPercent: Number(item.discountPercent),
        promotionName: item.promotionName,
        unitCost: Number(item.product.cost),
        lineTotal: roundMoney(Number(item.lineTotal)),
      }))

      if (balanceDue > 0 && proforma.customerId) {
        const customer = await transaction.customer.findUnique({
          where: { id: proforma.customerId },
          select: { credit: true, creditLimit: true, paymentDays: true },
        })
        if (!customer) throw new Error('CUSTOMER_NOT_FOUND')
        if (selectedPaymentMethod === 'CREDIT') {
          if (!customer.credit || !customer.creditLimit) throw new Error('CREDIT_NOT_AUTHORIZED')
          const pending = await transaction.accountReceivable.aggregate({
            where: { customerId: proforma.customerId, status: { not: 'CANCELLED' } },
            _sum: { balance: true },
          })
          if (Number(pending._sum.balance ?? 0) + balanceDue > Number(customer.creditLimit)) {
            throw new Error('CREDIT_LIMIT_EXCEEDED')
          }
        }
        creditPaymentDays = customer.paymentDays ?? 30
      }

      if (paymentAmount > 0 && selectedPaymentMethod === 'CASH') {
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
            data: {
              name: `Efectivo en custodia - ${seller.alias}`,
              type: 'CASH',
              branchId,
              custodianId: seller.id,
            },
            select: { id: true, name: true },
          })
          resolvedCashAccountId = account.id
          createdCashAccount = account
        }
      } else if (paymentAmount > 0 && selectedPaymentMethod !== 'CREDIT') {
        const expectedType = selectedPaymentMethod === 'CARD' ? 'POS' : 'BANK'
        if (!cashAccountId) throw new Error('CASH_ACCOUNT_REQUIRED')
        const account = await transaction.cashAccount.findFirst({
          where: {
            id: cashAccountId,
            isActive: true,
            branchId,
            type: expectedType,
            custodianId: null,
          },
          select: { id: true },
        })
        if (!account) throw new Error('CASH_ACCOUNT_NOT_FOUND')
        resolvedCashAccountId = account.id
      }

      const branchStocks = await transaction.productStock.findMany({
        where: {
          branchId,
          productId: { in: normalItems.filter((item) => item.product.type === 'PRODUCT').map((item) => item.productId) },
        },
        select: { productId: true, quantity: true },
      })
      const branchStockByProduct = new Map(branchStocks.map((stock) => [stock.productId, stock.quantity]))
      if (normalItems.some((item) =>
        item.product.type === 'PRODUCT' && (branchStockByProduct.get(item.productId) ?? 0) < item.quantity,
      )) {
        throw new Error('INSUFFICIENT_BRANCH_STOCK')
      }

      const createdSales: Array<{ id: string; number: string }> = []
      let remainingPaymentCents = Math.round(paymentAmount * 100)
      const normalPaymentAmount = Math.min(remainingPaymentCents, Math.round(normalTotal * 100)) / 100
      remainingPaymentCents -= Math.round(normalPaymentAmount * 100)
      if (normalLines.length > 0) {
        const subtotal = roundMoney(normalLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0))
        const discountTotal = roundMoney(normalLines.reduce((sum, line) =>
          sum + roundMoney(line.unitPrice * line.quantity * line.discountPercent / 100), 0))
        const normalBalanceDue = roundMoney(normalTotal - normalPaymentAmount)
        const paymentNumber = normalPaymentAmount > 0
          ? await nextDocumentNumber(transaction, 'C', access.session.userId, branchId)
          : null
        const createdSale = await transaction.sale.create({
          data: {
            number: await nextDocumentNumber(transaction, 'V', access.session.userId, branchId),
            branch: { connect: { id: branchId } },
            proforma: { connect: { id: proforma.id } },
            customer: proforma.customerId ? { connect: { id: proforma.customerId } } : undefined,
            seller: { connect: { id: access.session.userId } },
            priceListName: proforma.priceListName,
            cashAccountId: normalPaymentAmount > 0 ? resolvedCashAccountId : undefined,
            paymentMethod: selectedPaymentMethod,
            paymentReference: paymentReference || undefined,
            notes: proforma.notes ? `${proforma.notes} · Aceptada desde proforma` : 'Aceptada desde proforma',
            taxRate: 0,
            subtotal,
            discountTotal,
            taxAmount: 0,
            total: normalTotal,
            items: {
              create: normalLines.map((line) => ({
                productId: line.product.id,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountPercent: line.discountPercent,
                promotionName: line.promotionName,
                unitCost: line.unitCost,
                lineTotal: line.lineTotal,
              })),
            },
          },
          include: { items: true },
        })
        createdSales.push(createdSale)

        for (const line of normalLines) {
          if (line.product.type !== 'PRODUCT') continue
          await adjustBranchStock(transaction, line.product.id, branchId, -line.quantity)
          await transaction.inventoryMovement.create({
            data: {
              type: 'SALE',
              quantity: -line.quantity,
              unitCost: line.unitCost,
              reference: createdSale.number,
              productId: line.product.id,
              saleId: createdSale.id,
              branchId,
            },
          })
        }

        if (normalPaymentAmount > 0 && resolvedCashAccountId) {
          await transaction.cashAccount.update({
            where: { id: resolvedCashAccountId },
            data: { balance: { increment: normalPaymentAmount } },
          })
          await transaction.cashMovement.create({
            data: {
              type: 'IN',
              amount: normalPaymentAmount,
              description: `Venta convertida desde proforma ${proforma.number}`,
              reference: paymentNumber ?? createdSale.number,
              accountId: resolvedCashAccountId,
              saleId: createdSale.id,
            },
          })
        }

        if (normalBalanceDue > 0 && proforma.customerId) {
          const dueDate = new Date()
          dueDate.setDate(dueDate.getDate() + creditPaymentDays)
          const receivable = await transaction.accountReceivable.create({
            data: {
              number: receivableNumber(),
              originalAmount: normalTotal,
              paidAmount: normalPaymentAmount,
              balance: normalBalanceDue,
              dueDate,
              customerId: proforma.customerId,
              saleId: createdSale.id,
              status: normalPaymentAmount > 0 ? 'PARTIAL' : 'PENDING',
            },
          })
          if (normalPaymentAmount > 0 && resolvedCashAccountId && paymentNumber) {
            const seller = await transaction.user.findUnique({
              where: { id: access.session.userId },
              select: { alias: true },
            })
            await transaction.receivablePayment.create({
              data: {
                amount: normalPaymentAmount,
                paymentMethod: selectedPaymentMethod,
                reference: paymentNumber,
                externalReference: paymentReference || undefined,
                description: `Abono inicial de proforma ${proforma.number}`,
                recordedByAlias: seller?.alias,
                receivableId: receivable.id,
                cashAccountId: resolvedCashAccountId,
              },
            })
          }
        }

        const costOfGoods = roundMoney(normalLines.reduce((sum, line) =>
          line.product.type === 'PRODUCT' ? sum + line.unitCost * line.quantity : sum, 0))
        await postJournalEntry(transaction, {
          date: createdSale.createdAt,
          description: `Venta ${createdSale.number} desde proforma ${proforma.number}`,
          sourceType: 'SALE',
          sourceId: createdSale.id,
          branchId,
          lines: [
            { accountCode: '1000', debit: normalPaymentAmount },
            { accountCode: '1200', debit: normalBalanceDue },
            { accountCode: '4000', credit: normalTotal },
            { accountCode: '5000', debit: costOfGoods },
            { accountCode: '1300', credit: costOfGoods },
          ],
        })
      }

      if (recurringItems.length > 0 && proforma.customerId) {
        const customer = await transaction.customer.findUnique({
          where: { id: proforma.customerId },
          select: { id: true, paymentDays: true },
        })
        if (!customer) throw new Error('CUSTOMER_NOT_FOUND')
        const startDate = new Date()
        for (const item of recurringItems) {
          const period = item.product.serviceBillingPeriod
          if (period !== 'MONTHLY' && period !== 'ANNUAL') throw new Error('INVALID_SERVICE_BILLING_PERIOD')
          const lineTotalCents = Math.round(Number(item.lineTotal) * 100)
          const baseUnitCents = Math.floor(lineTotalCents / item.quantity)
          const extraCents = lineTotalCents % item.quantity
          for (let index = 0; index < item.quantity; index += 1) {
            const unitPrice = (baseUnitCents + (index < extraCents ? 1 : 0)) / 100
            const subscription = await transaction.serviceSubscription.create({
              data: {
                number: `SRV-${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`,
                billingPeriod: period,
                unitPrice,
                startDate,
                nextBillingDate: nextSubscriptionBillingDate(startDate, period),
                customerId: customer.id,
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
                amount: Math.min(remainingPaymentCents, Math.round(unitPrice * 100)) / 100,
                method: selectedPaymentMethod,
                cashAccountId: resolvedCashAccountId,
                paymentReference,
                notes: proforma.notes ? `Proforma ${proforma.number}: ${proforma.notes}` : `Proforma ${proforma.number}`,
                proformaId: proforma.id,
              },
            )
            remainingPaymentCents -= Math.min(remainingPaymentCents, Math.round(unitPrice * 100))
            createdSales.push(sale)
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
          details: `Se creó automáticamente la cuenta ${createdCashAccount.name} al aceptar la proforma ${proforma.number}.`,
          newValue: { name: createdCashAccount.name, type: 'CASH', custodianId: access.session.userId },
        }, transaction)
      }

      await logAudit({
        request,
        action: 'ACCEPT',
        moduleName: 'Proformas',
        entity: 'Proforma',
        entityId: proformaId,
        newValue: {
          status: 'ACCEPTED',
          paymentMethod: selectedPaymentMethod,
          paymentAmount,
          balanceDue,
          sales: createdSales.map((sale) => sale.number),
        },
        details: `Se aceptó la proforma ${proforma.number} y se generaron ${createdSales.length} venta(s) o factura(s) de servicio.`,
      }, transaction)

      return createdSales
    })

    return NextResponse.json({ sales, status: 'ACCEPTED' })
  } catch (error) {
    const message = error instanceof Error && error.message === 'CASH_ACCOUNT_NOT_FOUND'
      ? 'La cuenta seleccionada no existe o está inactiva.'
      : error instanceof Error && error.message === 'CASH_ACCOUNT_REQUIRED'
        ? 'Selecciona la cuenta bancaria o POS donde se recibió el pago.'
      : error instanceof Error && error.message === 'CREDIT_NOT_AUTHORIZED'
        ? 'El cliente no tiene crédito habilitado o no tiene un límite definido.'
        : error instanceof Error && error.message === 'CREDIT_LIMIT_EXCEEDED'
          ? 'La proforma supera el límite de crédito disponible del cliente.'
      : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_CLOSED'
        ? 'El período contable de esta fecha está cerrado.'
      : error instanceof Error && error.message === 'PROFORMA_ALREADY_PROCESSED'
        ? 'La proforma ya fue procesada.'
      : error instanceof Error && error.message === 'INSUFFICIENT_BRANCH_STOCK'
        ? 'No hay suficiente stock para aceptar la proforma.'
        : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_CLOSED'
          ? 'El período contable de esta fecha está cerrado.'
          : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_NOT_STARTED'
            ? 'La fecha de operación es anterior al inicio del libro mayor.'
        : 'No se pudo aceptar la proforma.'

    return NextResponse.json({ error: message }, { status: 400 })
  }
}
