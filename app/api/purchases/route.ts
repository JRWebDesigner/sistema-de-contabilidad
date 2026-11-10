import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma, serializableTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { postJournalEntry } from '@/lib/accounting'
import { adjustBranchStock } from '@/lib/branch-stock'
import { nextDocumentNumber } from '@/lib/document-numbering'
import { branchContextError, branchWhere, requireSingleBranch, resolveBranchContext } from '@/lib/branches'

const purchaseSchema = z.object({
  supplierId: z.string().min(1),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'QR', 'CREDIT']),
  cashAccountId: z.string().min(1).optional(),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.coerce.number().int().positive(), unitCost: z.coerce.number().finite().positive() })).min(1),
})

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const numberFor = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}`

export async function GET(request: Request) {
  const access = await requirePermission(request, 'finance:read')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError
  const purchases = await prisma.purchase.findMany({ where: branchWhere(branchContext), include: { supplier: { select: { name: true, document: true } }, items: { include: { product: { select: { name: true, sku: true } } } } }, orderBy: { createdAt: 'desc' }, take: 100 })
  return NextResponse.json(purchases.map((purchase) => ({ ...purchase, subtotal: purchase.subtotal.toString(), taxAmount: purchase.taxAmount.toString(), total: purchase.total.toString(), items: purchase.items.map((item) => ({ ...item, unitCost: item.unitCost.toString(), lineTotal: item.lineTotal.toString() })) })))
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'finance:write')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!
  const payload = purchaseSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Revisa proveedor, productos y costos.' }, { status: 400 })
  if (new Set(payload.data.items.map((item) => item.productId)).size !== payload.data.items.length) return NextResponse.json({ error: 'No repitas productos en una compra.' }, { status: 400 })

  try {
    const purchase = await serializableTransaction(async (transaction) => {
      if (payload.data.paymentMethod !== 'CREDIT' && !payload.data.cashAccountId) throw new Error('ACCOUNT_REQUIRED')
      const supplier = await transaction.supplier.findFirst({ where: { id: payload.data.supplierId, isActive: true } })
      if (!supplier) throw new Error('SUPPLIER_NOT_FOUND')
      if (payload.data.paymentMethod !== 'CREDIT') {
        const account = await transaction.cashAccount.findFirst({
          where: { id: payload.data.cashAccountId, isActive: true, branchId, custodianId: null },
        })
        if (!account) throw new Error('ACCOUNT_NOT_FOUND')
      }
      const products = await transaction.product.findMany({ where: { id: { in: payload.data.items.map((item) => item.productId) }, isActive: true, type: 'PRODUCT' } })
      if (products.length !== payload.data.items.length) throw new Error('PRODUCT_NOT_FOUND')
      const productById = new Map(products.map((product) => [product.id, product]))
      const lines = payload.data.items.map((item) => {
        const product = productById.get(item.productId)!
        const nextStock = product.currentStock + item.quantity
        const averageCost = roundMoney((Number(product.cost) * product.currentStock + item.unitCost * item.quantity) / nextStock)
        return { ...item, product, averageCost, lineTotal: roundMoney(item.quantity * item.unitCost) }
      })
      const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0))
      const taxAmount = 0
      const total = subtotal
      const number = numberFor('COM')
      const paymentReference = payload.data.paymentMethod === 'CREDIT'
        ? null
        : await nextDocumentNumber(transaction, 'P', access.session.userId, branchId)
      const created = await transaction.purchase.create({ data: { number, branchId, supplierId: supplier.id, paymentMethod: payload.data.paymentMethod, cashAccountId: payload.data.cashAccountId, subtotal, taxAmount, total, items: { create: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity, unitCost: line.unitCost, previousUnitCost: line.product.cost, lineTotal: line.lineTotal })) } }, include: { items: true } })

      for (const line of lines) {
        await adjustBranchStock(transaction, line.product.id, branchId, line.quantity)
        await transaction.product.update({ where: { id: line.product.id }, data: { cost: line.averageCost } })
        await transaction.inventoryMovement.create({ data: { type: 'PURCHASE', quantity: line.quantity, unitCost: line.unitCost, reference: number, productId: line.product.id, purchaseId: created.id, branchId } })
      }
      if (payload.data.paymentMethod === 'CREDIT') {
        const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30)
        await transaction.accountPayable.create({ data: { number: numberFor('CXP'), originalAmount: total, balance: total, dueDate, supplierId: supplier.id, purchaseId: created.id } })
      } else if (payload.data.cashAccountId) {
        await transaction.cashAccount.update({ where: { id: payload.data.cashAccountId }, data: { balance: { decrement: total } } })
          await transaction.cashMovement.create({ data: { type: 'OUT', amount: total, description: `Pago de compra ${number}`, reference: paymentReference, accountId: payload.data.cashAccountId, purchaseId: created.id } })
      }
      await postJournalEntry(transaction, {
        date: created.createdAt,
        description: `Compra ${number}`,
        sourceType: 'PURCHASE',
        sourceId: created.id,
        branchId,
        lines: [
          { accountCode: '1300', debit: total },
          { accountCode: payload.data.paymentMethod === 'CREDIT' ? '2100' : '1000', credit: total },
        ],
      })
        await logAudit({ request, action: 'CREATE', moduleName: 'Compras', entity: 'Purchase', entityId: created.id, details: `Se registró la compra ${created.number} por ${Number(created.total).toFixed(2)} Bs.` }, transaction)
      return created
    })
    return NextResponse.json({ ...purchase, subtotal: purchase.subtotal.toString(), taxAmount: purchase.taxAmount.toString(), total: purchase.total.toString() }, { status: 201 })
  } catch (error) {
    const messages: Record<string, string> = { ACCOUNT_REQUIRED: 'Selecciona una cuenta para pagar la compra.', ACCOUNT_NOT_FOUND: 'La cuenta no existe o está inactiva.', SUPPLIER_NOT_FOUND: 'El proveedor no existe o está inactivo.', PRODUCT_NOT_FOUND: 'Uno de los productos no existe o está inactivo.', ACCOUNTING_PERIOD_CLOSED: 'El período contable de esta fecha está cerrado.', ACCOUNTING_PERIOD_NOT_STARTED: 'La fecha de operación es anterior al inicio del libro mayor.' }
    return NextResponse.json({ error: error instanceof Error ? messages[error.message] ?? 'No se pudo registrar la compra.' : 'No se pudo registrar la compra.' }, { status: 400 })
  }
}

const cancelPurchaseSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})

export async function PATCH(request: Request) {
  const access = await requirePermission(request, 'finance:write')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta el identificador de la compra.' }, { status: 400 })
  const payload = cancelPurchaseSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Indica un motivo de anulación de al menos 3 caracteres.' }, { status: 400 })

  try {
    const result = await serializableTransaction(async (transaction) => {
      const purchase = await transaction.purchase.findUnique({
        where: { id },
        include: {
          items: true,
          payable: { include: { payments: true } },
        },
      })
      if (!purchase || purchase.status !== 'RECEIVED') throw new Error('PURCHASE_NOT_CANCELLABLE')
      if (purchase.branchId !== branchId) throw new Error('PURCHASE_NOT_CANCELLABLE')

      if (purchase.paymentMethod === 'CREDIT') {
        if (!purchase.payable) throw new Error('PAYABLE_NOT_FOUND')
        if (Number(purchase.payable.paidAmount) > 0 || purchase.payable.payments.length > 0) throw new Error('CREDIT_ALREADY_PAID')
      } else if (!purchase.cashAccountId) {
        throw new Error('CASH_ACCOUNT_NOT_FOUND')
      }

      const claimed = await transaction.purchase.updateMany({
        where: { id, branchId, status: 'RECEIVED' },
        data: { status: 'CANCELLED' },
      })
      if (claimed.count !== 1) throw new Error('PURCHASE_NOT_CANCELLABLE')

      for (const item of purchase.items) {
        const laterMovement = await transaction.inventoryMovement.findFirst({
          where: { productId: item.productId, createdAt: { gt: purchase.createdAt }, purchaseId: { not: purchase.id } },
          select: { id: true },
        })
        if (laterMovement) throw new Error('PURCHASE_HAS_LATER_STOCK_ACTIVITY')

        try {
          await adjustBranchStock(transaction, item.productId, branchId, -item.quantity)
        } catch (error) {
          if (error instanceof Error && error.message === 'INSUFFICIENT_BRANCH_STOCK') {
            throw new Error('STOCK_ALREADY_CONSUMED')
          }
          throw error
        }

        await transaction.inventoryMovement.create({
          data: {
            type: 'RETURN_OUT',
            quantity: -item.quantity,
            unitCost: item.unitCost,
            reference: `ANUL-${purchase.number}`,
            notes: `Anulación de compra: ${payload.data.reason}`,
            productId: item.productId,
            purchaseId: purchase.id,
            branchId,
          },
        })

        const restoredCost = item.previousUnitCost
        if (restoredCost !== null && restoredCost !== undefined) {
          await transaction.product.update({ where: { id: item.productId }, data: { cost: restoredCost } })
        }
      }

      if (purchase.paymentMethod === 'CREDIT' && purchase.payable) {
        await transaction.accountPayable.update({
          where: { id: purchase.payable.id },
          data: { status: 'CANCELLED', balance: 0 },
        })
      } else if (purchase.cashAccountId) {
        const account = await transaction.cashAccount.findFirst({
          where: { id: purchase.cashAccountId, isActive: true, branchId, custodianId: null },
        })
        if (!account) throw new Error('CASH_ACCOUNT_NOT_FOUND')
        await transaction.cashAccount.update({
          where: { id: purchase.cashAccountId },
          data: { balance: { increment: purchase.total } },
        })
        await transaction.cashMovement.create({
          data: {
            type: 'IN',
            amount: purchase.total,
            description: `Reembolso por anulación de compra ${purchase.number}`,
            reference: `ANUL-${purchase.number}`,
            accountId: purchase.cashAccountId,
            purchaseId: purchase.id,
          },
        })
      }

      const purchaseValue = roundMoney(purchase.items.reduce((sum, item) => sum + Number(item.unitCost) * item.quantity, 0))
      await postJournalEntry(transaction, {
        date: new Date(),
        description: `Anulación de compra ${purchase.number}`,
        sourceType: 'PURCHASE_CANCEL',
        sourceId: purchase.id,
        isReversal: true,
        branchId,
        lines: [
          { accountCode: purchase.paymentMethod === 'CREDIT' ? '2100' : '1000', debit: purchaseValue },
          { accountCode: '1300', credit: purchaseValue },
        ],
      })

      await logAudit({
        request,
        action: 'UPDATE',
        moduleName: 'Compras',
        entity: 'Purchase',
        entityId: purchase.id,
        details: `Se anuló la compra ${purchase.number}. Motivo: ${payload.data.reason}.`,
        oldValue: { status: purchase.status, total: Number(purchase.total) },
        newValue: { status: 'CANCELLED' },
      }, transaction)

      return { id: purchase.id, number: purchase.number, status: 'CANCELLED' }
    })

    return NextResponse.json(result)
  } catch (error) {
    const messages: Record<string, string> = {
      PURCHASE_NOT_CANCELLABLE: 'La compra no existe o ya fue procesada.',
      PAYABLE_NOT_FOUND: 'La compra a crédito no tiene una cuenta por pagar asociada.',
      CREDIT_ALREADY_PAID: 'No se puede anular una compra a crédito con pagos aplicados. Registra una devolución del proveedor por separado.',
      PURCHASE_HAS_LATER_STOCK_ACTIVITY: 'No se puede anular la compra: hay movimientos posteriores de este producto. Registra una devolución o ajuste inverso.',
      ACCOUNTING_PERIOD_CLOSED: 'El período contable de esta fecha está cerrado.',
      ACCOUNTING_PERIOD_NOT_STARTED: 'La fecha de operación es anterior al inicio del libro mayor.',
      CASH_ACCOUNT_NOT_FOUND: 'La compra no tiene una cuenta de caja asociada para registrar el reembolso.',
      STOCK_ALREADY_CONSUMED: 'No se puede anular la compra porque parte del inventario recibido ya fue consumido.',
    }
    return NextResponse.json({ error: error instanceof Error ? messages[error.message] ?? 'No se pudo anular la compra.' : 'No se pudo anular la compra.' }, { status: 400 })
  }
}
