import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma, serializableTransaction } from '@/lib/db'
import { requirePermission, rolePermissions } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { postJournalEntry } from '@/lib/accounting'
import { resolveSalesPricing } from '@/lib/sales-pricing'
import { adjustBranchStock } from '@/lib/branch-stock'
import { nextDocumentNumber } from '@/lib/document-numbering'
import { branchContextError, branchWhere, requireSingleBranch, resolveBranchContext } from '@/lib/branches'

const saleSchema = z.object({
  customerId: z.string().min(1).optional(),
  cashAccountId: z.string().min(1).optional(),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'QR', 'CREDIT', 'OTHER']),
  paymentReference: z.string().trim().max(100).optional(),
  paymentAmount: z.coerce.number().finite().min(0).optional(),
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  requiresInvoice: z.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
    discountPercent: z.coerce.number().min(0).max(100).default(0),
  })).min(1),
})

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

function receivableNumber() {
  return `CXC-${Date.now().toString(36).toUpperCase()}`
}

export async function GET(request: Request) {
  const access = await requirePermission(request, 'sales:read')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError
  const sales = await prisma.sale.findMany({
    where: branchWhere(branchContext),
    include: {
      customer: { select: { name: true, document: true } },
      items: { include: { product: { select: { name: true, sku: true, type: true } } } },
      movements: { where: { type: 'RETURN_IN' }, select: { productId: true, quantity: true, notes: true, reference: true, createdAt: true } },
      returns: { include: { items: { select: { saleItemId: true, quantity: true, lineTotal: true } } } },
      receivable: { select: { balance: true, paidAmount: true, status: true, originalAmount: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json(sales.map((sale) => ({
    ...sale,
    taxRate: sale.taxRate.toString(),
    subtotal: sale.subtotal.toString(),
    discountTotal: sale.discountTotal.toString(),
    taxAmount: sale.taxAmount.toString(),
    total: sale.total.toString(),
    receivable: sale.receivable ? {
      ...sale.receivable,
      balance: sale.receivable.balance.toString(),
      paidAmount: sale.receivable.paidAmount.toString(),
      originalAmount: sale.receivable.originalAmount.toString(),
    } : null,
    items: sale.items.map((item) => ({
      ...item,
      unitPrice: item.unitPrice.toString(),
      discountPercent: item.discountPercent.toString(),
      unitCost: item.unitCost.toString(),
      lineTotal: item.lineTotal.toString(),
      returnedQuantity: sale.returns.reduce((sum, saleReturn) =>
        sum + saleReturn.items
          .filter((returnedItem) => returnedItem.saleItemId === item.id)
          .reduce((itemSum, returnedItem) => itemSum + returnedItem.quantity, 0), 0),
    })),
    returns: sale.returns.map((saleReturn) => ({
      ...saleReturn,
      total: saleReturn.total.toString(),
      items: saleReturn.items.map((item) => ({ ...item, lineTotal: item.lineTotal.toString() })),
    })),
    movements: sale.movements,
  })))
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'sales:write')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!
  const payload = saleSchema.safeParse(await request.json())

  if (!payload.success) {
    return NextResponse.json({ error: 'Selecciona al menos un producto y revisa los datos de la venta.' }, { status: 400 })
  }

  const canDiscount = access.session?.role
    ? rolePermissions(access.session.role).includes('sales:discount')
    : false
  if (!canDiscount && payload.data.items.some((item) => item.discountPercent > 0)) {
    return NextResponse.json({ error: 'Solo un administrador puede aplicar descuentos.' }, { status: 403 })
  }

  if (payload.data.paymentAmount !== 0 && ['BANK_TRANSFER', 'QR'].includes(payload.data.paymentMethod) && !payload.data.paymentReference) {
    return NextResponse.json({ error: 'El número de comprobante es obligatorio para transferencias y pagos QR.' }, { status: 400 })
  }

  const saleDateValue = payload.data.saleDate ?? new Date().toISOString().slice(0, 10)
  const saleDate = new Date(`${saleDateValue}T12:00:00.000Z`)
  if (!Number.isFinite(saleDate.getTime()) || saleDate.toISOString().slice(0, 10) !== saleDateValue) {
    return NextResponse.json({ error: 'Selecciona una fecha de venta valida.' }, { status: 400 })
  }

  const uniqueProductIds = new Set(payload.data.items.map((item) => item.productId))
  if (uniqueProductIds.size !== payload.data.items.length) {
    return NextResponse.json({ error: 'No repitas el mismo producto en una venta.' }, { status: 400 })
  }

  try {
    const result = await serializableTransaction(async (transaction) => {
      let cashAccountId: string | undefined
      let createdCashAccount: { id: string; name: string } | null = null
      const customerPaymentTerms = payload.data.customerId
        ? await transaction.customer.findUnique({
          where: { id: payload.data.customerId },
          select: { id: true, paymentDays: true },
        })
        : null

      const products = await transaction.product.findMany({
        where: { id: { in: payload.data.items.map((item) => item.productId) }, isActive: true },
      })
      const branchStocks = await transaction.productStock.findMany({
        where: {
          branchId,
          productId: { in: products.filter((product) => product.type === 'PRODUCT').map((product) => product.id) },
        },
        select: { productId: true, quantity: true },
      })
      const branchStockByProduct = new Map(branchStocks.map((stock) => [stock.productId, stock.quantity]))

      if (products.length !== payload.data.items.length) {
        throw new Error('PRODUCT_NOT_FOUND')
      }

      const productById = new Map(products.map((product) => [product.id, product]))
      const salesPricing = await resolveSalesPricing(
        transaction,
        payload.data.items.map((item) => item.productId),
        payload.data.customerId,
      )
      const effectivePrices = salesPricing.prices
      const lines = payload.data.items.map((item) => {
        const product = productById.get(item.productId)
        if (!product) throw new Error('PRODUCT_NOT_FOUND')
        if (product.type === 'SERVICE' && product.serviceBillingPeriod !== 'ONE_TIME') {
          throw new Error('RECURRING_SERVICE_REQUIRES_SUBSCRIPTION')
        }
        if (product.type === 'PRODUCT' && (branchStockByProduct.get(item.productId) ?? 0) < item.quantity) {
          throw new Error('INSUFFICIENT_BRANCH_STOCK')
        }

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
          unitCost: Number(product.cost),
          discountAmount,
          lineTotal: roundMoney(unitPrice * item.quantity - discountAmount),
        }
      })

      const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0))
      const discountTotal = roundMoney(lines.reduce((sum, line) => sum + line.discountAmount, 0))
      const taxAmount = 0
      const total = roundMoney(subtotal - discountTotal)
      const paymentAmount = payload.data.paymentAmount ?? (payload.data.paymentMethod === 'CREDIT' ? 0 : total)
      if (paymentAmount > total) throw new Error('PAYMENT_EXCEEDS_TOTAL')
      if (payload.data.paymentMethod === 'CREDIT' && paymentAmount > 0) throw new Error('INVALID_CREDIT_PAYMENT')
      const balanceDue = roundMoney(total - paymentAmount)
      if (balanceDue > 0 && !payload.data.customerId) throw new Error('CUSTOMER_REQUIRED')

      if (paymentAmount > 0 && payload.data.paymentMethod === 'CASH') {
        const seller = await transaction.user.findUnique({
          where: { id: access.session.userId },
          select: { id: true, alias: true },
        })
        if (!seller) throw new Error('SELLER_NOT_FOUND')
        let custodyAccount = await transaction.cashAccount.findFirst({
          where: { isActive: true, branchId, type: 'CASH', custodianId: seller.id },
        })
        if (!custodyAccount) {
          custodyAccount = await transaction.cashAccount.create({
            data: {
              name: `Efectivo en custodia - ${seller.alias}`,
              type: 'CASH',
              branchId,
              custodianId: seller.id,
            },
          })
          createdCashAccount = custodyAccount
        }
        cashAccountId = custodyAccount.id
      } else if (paymentAmount > 0 && payload.data.paymentMethod !== 'CREDIT') {
        if (!payload.data.cashAccountId) throw new Error('CASH_ACCOUNT_REQUIRED')
        const account = await transaction.cashAccount.findFirst({
          where: {
            id: payload.data.cashAccountId,
            isActive: true,
            branchId,
            custodianId: null,
            ...(payload.data.paymentMethod === 'BANK_TRANSFER' ? { type: 'BANK' } : {}),
            ...(payload.data.paymentMethod === 'CARD' ? { type: 'POS' } : {}),
          },
          select: { id: true },
        })
        if (!account) throw new Error('CASH_ACCOUNT_NOT_FOUND')
        cashAccountId = account.id
      }

      const number = await nextDocumentNumber(transaction, 'V', access.session.userId, branchId)
      const paymentNumber = paymentAmount > 0
        ? await nextDocumentNumber(transaction, 'C', access.session.userId, branchId)
        : null
      let initialPaymentId: string | null = null

      const createdSale = await transaction.sale.create({
        data: {
          number,
          branch: { connect: { id: branchId } },
          customer: payload.data.customerId ? { connect: { id: payload.data.customerId } } : undefined,
          cashAccount: cashAccountId ? { connect: { id: cashAccountId } } : undefined,
          seller: access.session ? { connect: { id: access.session.userId } } : undefined,
          paymentMethod: payload.data.paymentMethod,
          paymentReference: payload.data.paymentReference || undefined,
          requiresInvoice: payload.data.requiresInvoice,
          notes: payload.data.notes || undefined,
          priceListName: salesPricing.priceListName,
          taxRate: 0,
          subtotal,
          discountTotal,
          taxAmount,
          total,
          createdAt: saleDate,
          items: {
            create: lines.map((line) => ({
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

      for (const line of lines) {
        if (line.product.type === 'SERVICE') continue
        await adjustBranchStock(transaction, line.product.id, branchId, -line.quantity)

        await transaction.inventoryMovement.create({
          data: {
            type: 'SALE',
            quantity: -line.quantity,
            unitCost: line.unitCost,
            reference: number,
            productId: line.product.id,
            saleId: createdSale.id,
            branchId,
            createdAt: saleDate,
          },
        })
      }

      if (paymentAmount > 0 && cashAccountId) {
        await transaction.cashAccount.update({
          where: { id: cashAccountId },
          data: { balance: { increment: paymentAmount } },
        })
        await transaction.cashMovement.create({
          data: {
            type: 'IN',
            amount: paymentAmount,
            description: `Cobro de venta ${number}`,
            reference: paymentNumber ?? number,
            accountId: cashAccountId,
            saleId: createdSale.id,
            createdAt: saleDate,
          },
        })
      }

      if (balanceDue > 0 && payload.data.customerId) {
        const dueDate = new Date(saleDate)
        dueDate.setDate(dueDate.getDate() + (customerPaymentTerms?.paymentDays ?? 30))
        const receivable = await transaction.accountReceivable.create({
          data: {
            number: receivableNumber(),
            originalAmount: total,
            paidAmount: paymentAmount,
            balance: balanceDue,
            dueDate,
            customerId: payload.data.customerId,
            saleId: createdSale.id,
            status: paymentAmount > 0 ? 'PARTIAL' : 'PENDING',
          },
        })
        if (paymentAmount > 0 && cashAccountId) {
          if (!paymentNumber) throw new Error('PAYMENT_REFERENCE_REQUIRED')
          const seller = await transaction.user.findUnique({
            where: { id: access.session.userId },
            select: { alias: true },
          })
          const initialPayment = await transaction.receivablePayment.create({
            data: {
              amount: paymentAmount,
              paymentMethod: payload.data.paymentMethod,
              reference: paymentNumber,
              externalReference: payload.data.paymentReference || undefined,
              description: payload.data.notes || undefined,
              recordedByAlias: seller?.alias,
              receivableId: receivable.id,
              cashAccountId,
              createdAt: saleDate,
            },
            select: { id: true },
          })
          initialPaymentId = initialPayment.id
        }
      }

      const costOfGoods = roundMoney(lines.reduce((sum, line) =>
        sum + (line.product.type === 'PRODUCT' ? line.unitCost * line.quantity : 0), 0))
      await postJournalEntry(transaction, {
        date: saleDate,
        description: `Venta ${number}`,
        sourceType: 'SALE',
        sourceId: createdSale.id,
        branchId,
        lines: [
          { accountCode: '1000', debit: paymentAmount },
          { accountCode: '1200', debit: balanceDue },
          { accountCode: '4000', credit: total },
          { accountCode: '5000', debit: costOfGoods },
          { accountCode: '1300', credit: costOfGoods },
        ],
      })

      if (createdCashAccount) {
        await logAudit({
          request,
          action: 'CREATE',
          moduleName: 'Caja y bancos',
          entity: 'CashAccount',
          entityId: createdCashAccount.id,
          details: `Se creó automáticamente la cuenta ${createdCashAccount.name} para registrar una venta.`,
          newValue: { name: createdCashAccount.name, type: 'CASH', balance: 0 },
        }, transaction)
      }

      await logAudit({
        request,
        action: 'CREATE',
        moduleName: 'Ventas',
        entity: 'Sale',
        entityId: createdSale.id,
        details: `Se registró la venta ${createdSale.number} por ${Number(createdSale.total).toFixed(2)}${discountTotal > 0 ? `, con descuentos por ${discountTotal.toFixed(2)}` : ''}.`,
      }, transaction)

      return { sale: createdSale, paymentAmount, balanceDue, paymentId: initialPaymentId }
    })

    const { sale, paymentAmount, balanceDue, paymentId } = result
    return NextResponse.json({
      ...sale,
      subtotal: sale.subtotal.toString(),
      discountTotal: sale.discountTotal.toString(),
      taxAmount: sale.taxAmount.toString(),
      total: sale.total.toString(),
      paidAmount: paymentAmount.toString(),
      balanceDue: balanceDue.toString(),
      paymentId,
      items: sale.items.map((item) => ({
        ...item,
        unitPrice: item.unitPrice.toString(),
        discountPercent: item.discountPercent.toString(),
        unitCost: item.unitCost.toString(),
        lineTotal: item.lineTotal.toString(),
      })),
    }, { status: 201 })
  } catch (error) {
    console.error('ERROR_CREATING_SALE', error)
    const message = error instanceof Error && error.message === 'CUSTOMER_REQUIRED'
      ? 'Las ventas a crédito necesitan un cliente.'
      : error instanceof Error && error.message === 'CREDIT_NOT_AUTHORIZED'
        ? 'El cliente no tiene crédito habilitado o no tiene un límite definido.'
        : error instanceof Error && error.message === 'CREDIT_LIMIT_EXCEEDED'
          ? 'La venta supera el límite de crédito disponible del cliente.'
      : error instanceof Error && error.message === 'PAYMENT_EXCEEDS_TOTAL'
        ? 'El abono no puede ser mayor al total de la venta.'
        : error instanceof Error && error.message === 'INVALID_CREDIT_PAYMENT'
          ? 'El medio Credito no se puede usar como un abono.'
          : error instanceof Error && error.message === 'PAYMENT_REFERENCE_REQUIRED'
            ? 'El numero de comprobante es obligatorio para transferencias.'
            : error instanceof Error && error.message === 'SELLER_NOT_FOUND'
              ? 'No se pudo identificar a la persona responsable de la venta.'
      : error instanceof Error && error.message === 'RECURRING_SERVICE_REQUIRES_SUBSCRIPTION'
        ? 'Los servicios mensuales o anuales deben contratarse desde Suscripciones.'
      : error instanceof Error && error.message === 'CASH_ACCOUNT_REQUIRED'
      ? 'Selecciona una cuenta para registrar el cobro.'
      : error instanceof Error && error.message === 'CASH_ACCOUNT_NOT_FOUND'
        ? 'La cuenta seleccionada no existe o está inactiva.'
        : error instanceof Error && error.message === 'INSUFFICIENT_STOCK'
      ? 'Stock insuficiente para uno de los productos.'
      : error instanceof Error && error.message === 'INSUFFICIENT_BRANCH_STOCK'
        ? 'La sucursal no tiene existencias suficientes de uno de los productos.'
      : error instanceof Error && error.message === 'PRODUCT_NOT_FOUND'
        ? 'Uno de los productos no existe o está inactivo.'
        : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_CLOSED'
          ? 'El período contable de esta fecha está cerrado.'
          : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_NOT_STARTED'
            ? 'La fecha de operación es anterior al inicio del libro mayor.'
        : 'No se pudo registrar la venta.'

    return NextResponse.json({ error: message }, { status: 400 })
  }
}

const cancelSaleSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})

export async function PATCH(request: Request) {
  const access = await requirePermission(request, 'sales:write')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta el identificador de la venta.' }, { status: 400 })
  const payload = cancelSaleSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Indica un motivo de anulación de al menos 3 caracteres.' }, { status: 400 })

  try {
    const result = await serializableTransaction(async (transaction) => {
      const sale = await transaction.sale.findUnique({
        where: { id },
        include: {
          items: { include: { product: { select: { type: true } } } },
          movements: { where: { type: 'RETURN_IN' }, select: { productId: true, quantity: true } },
          returns: { include: { items: { select: { saleItemId: true, lineTotal: true } } } },
          receivable: { include: { payments: true } },
        },
      })
      if (!sale || sale.status !== 'COMPLETED') throw new Error('SALE_NOT_CANCELLABLE')
      if (sale.branchId !== branchId) throw new Error('SALE_NOT_CANCELLABLE')

      if (sale.paymentMethod === 'CREDIT') {
        if (!sale.receivable) throw new Error('RECEIVABLE_NOT_FOUND')
        if (Number(sale.receivable.paidAmount) > 0 || sale.receivable.payments.length > 0) throw new Error('CREDIT_ALREADY_PAID')
      } else if (!sale.cashAccountId) {
        throw new Error('CASH_ACCOUNT_NOT_FOUND')
      }

      const claimed = await transaction.sale.updateMany({
        where: { id, status: 'COMPLETED' },
        data: { status: 'CANCELLED' },
      })
      if (claimed.count !== 1) throw new Error('SALE_NOT_CANCELLABLE')

      let refundAmount = 0
      for (const item of sale.items) {
        if (item.product.type === 'SERVICE') {
          refundAmount += Number(item.lineTotal)
          continue
        }
        const returned = sale.movements
          .filter((movement) => movement.productId === item.productId)
          .reduce((sum, movement) => sum + movement.quantity, 0)
        const remainingQuantity = item.quantity - returned
        if (remainingQuantity <= 0) continue

        const previouslyRefunded = sale.returns.reduce((sum, saleReturn) =>
          sum + saleReturn.items
            .filter((returnedItem) => returnedItem.saleItemId === item.id)
            .reduce((itemSum, returnedItem) => itemSum + Number(returnedItem.lineTotal), 0), 0)
        const remainingGross = Number(item.unitPrice) * remainingQuantity
        const remainingDiscount = roundMoney(remainingGross * Number(item.discountPercent) / 100)
        const remainingValue = sale.returns.length > 0
          ? Number(item.lineTotal) - previouslyRefunded
          : roundMoney(remainingGross - remainingDiscount)
        refundAmount += Math.max(remainingValue, 0)
        await adjustBranchStock(transaction, item.productId, branchId, remainingQuantity)
        await transaction.inventoryMovement.create({
          data: {
            type: 'RETURN_IN',
            quantity: remainingQuantity,
            unitCost: item.unitCost,
            reference: `ANUL-${sale.number}`,
            notes: `Anulación de venta: ${payload.data.reason}`,
            productId: item.productId,
            saleId: sale.id,
            branchId,
          },
        })
      }

      refundAmount = roundMoney(refundAmount)
      if (sale.paymentMethod === 'CREDIT' && sale.receivable) {
        await transaction.accountReceivable.update({
          where: { id: sale.receivable.id },
          data: { status: 'CANCELLED', balance: 0 },
        })
      } else if (refundAmount > 0 && sale.cashAccountId) {
        const account = await transaction.cashAccount.findFirst({ where: { id: sale.cashAccountId, isActive: true, branchId } })
        if (!account) throw new Error('CASH_ACCOUNT_NOT_FOUND')
        if (Number(account.balance) < refundAmount) throw new Error('INSUFFICIENT_REFUND_BALANCE')
        await transaction.cashAccount.update({
          where: { id: sale.cashAccountId },
          data: { balance: { decrement: refundAmount } },
        })
        await transaction.cashMovement.create({
          data: {
            type: 'OUT',
            amount: refundAmount,
            description: `Reembolso por anulación de venta ${sale.number}`,
            reference: `ANUL-${sale.number}`,
            accountId: sale.cashAccountId,
            saleId: sale.id,
          },
        })
      }

      const returnedCost = sale.items.reduce((sum, item) => {
        if (item.product.type === 'SERVICE') return sum
        const returned = sale.movements
          .filter((movement) => movement.productId === item.productId)
          .reduce((quantity, movement) => quantity + movement.quantity, 0)
        return sum + Number(item.unitCost) * Math.max(item.quantity - returned, 0)
      }, 0)
      await postJournalEntry(transaction, {
        date: new Date(),
        description: `Anulación de venta ${sale.number}`,
        sourceType: 'SALE_CANCEL',
        sourceId: sale.id,
        isReversal: true,
        branchId,
        lines: [
          { accountCode: '4100', debit: refundAmount },
          { accountCode: sale.paymentMethod === 'CREDIT' ? '1200' : '1000', credit: refundAmount },
          { accountCode: '1300', debit: returnedCost },
          { accountCode: '5000', credit: returnedCost },
        ],
      })

      await logAudit({
        request,
        action: 'UPDATE',
        moduleName: 'Ventas',
        entity: 'Sale',
        entityId: sale.id,
        details: `Se anuló la venta ${sale.number}. Motivo: ${payload.data.reason}. Reembolso: ${refundAmount.toFixed(2)} Bs.`,
        oldValue: { status: sale.status, total: Number(sale.total) },
        newValue: { status: 'CANCELLED', refundAmount },
      }, transaction)

      return { id: sale.id, number: sale.number, status: 'CANCELLED', refundAmount }
    })

    return NextResponse.json(result)
  } catch (error) {
    const messages: Record<string, string> = {
      SALE_NOT_CANCELLABLE: 'La venta no existe o ya fue procesada.',
      RECEIVABLE_NOT_FOUND: 'La venta a crédito no tiene una cuenta por cobrar asociada.',
      CREDIT_ALREADY_PAID: 'No se puede anular una venta a crédito con pagos aplicados. Registra una devolución y un reembolso por separado.',
      CASH_ACCOUNT_NOT_FOUND: 'La venta no tiene una cuenta de caja asociada para registrar el reembolso.',
      INSUFFICIENT_REFUND_BALANCE: 'La cuenta original no tiene saldo suficiente para reembolsar la venta.',
      INSUFFICIENT_BRANCH_STOCK: 'No se pudo devolver el producto porque la sucursal ya no tiene disponible ese stock.',
      ACCOUNTING_PERIOD_CLOSED: 'El período contable de esta fecha está cerrado.',
    }
    return NextResponse.json({ error: error instanceof Error ? messages[error.message] ?? 'No se pudo anular la venta.' : 'No se pudo anular la venta.' }, { status: 400 })
  }
}
