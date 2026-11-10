import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma, serializableTransaction } from '@/lib/db'
import { requireAdmin, requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { postJournalEntry } from '@/lib/accounting'
import { adjustBranchStock } from '@/lib/branch-stock'
import { branchContextError, branchWhere, requireSingleBranch, resolveBranchContext } from '@/lib/branches'

const movementSchema = z.object({
  productId: z.string().min(1),
  type: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RETURN_IN', 'RETURN_OUT']),
  quantity: z.coerce.number().int().positive(),
  notes: z.string().trim().max(500).optional(),
  saleId: z.preprocess((value) => value === '' ? undefined : value, z.string().trim().min(1).optional()),
  cashAccountId: z.preprocess((value) => value === '' ? undefined : value, z.string().trim().min(1).optional()),
})

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export async function GET(request: Request) {
  const access = await requirePermission(request, 'inventory:read')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError
  const scope = branchWhere(branchContext)
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  const resource = new URL(request.url).searchParams.get('resource')

  if (resource === 'return-accounts') {
    const accounts = await prisma.cashAccount.findMany({
      where: { isActive: true, ...scope },
      select: { id: true, name: true, type: true, balance: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(accounts.map((account) => ({ ...account, balance: account.balance.toString() })))
  }

  if (resource === 'returns') {
    const sales = await prisma.sale.findMany({
      where: { status: 'COMPLETED', ...scope },
      include: {
        customer: { select: { name: true, document: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        movements: { where: { type: 'RETURN_IN' }, select: { productId: true, quantity: true } },
        cashAccount: { select: { id: true, name: true, type: true } },
        receivable: { select: { balance: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return NextResponse.json(sales.map((sale) => ({
      id: sale.id,
      number: sale.number,
      createdAt: sale.createdAt,
      paymentMethod: sale.paymentMethod,
      taxRate: sale.taxRate.toString(),
      total: sale.total.toString(),
      customer: sale.customer,
      cashAccount: sale.cashAccount,
      receivable: sale.receivable ? { balance: sale.receivable.balance.toString() } : null,
      items: sale.items.map((item) => ({
        productId: item.productId,
        product: item.product,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        returnedQuantity: sale.movements
          .filter((movement) => movement.productId === item.productId)
          .reduce((sum, movement) => sum + movement.quantity, 0),
      })),
    })))
  }

  if (resource === 'history') {
    const movements = await prisma.inventoryMovement.findMany({
      where: { type: { in: ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RETURN_IN', 'RETURN_OUT', 'TRANSFER_IN', 'TRANSFER_OUT'] }, ...scope },
      include: {
        product: { select: { name: true, sku: true } },
        sale: { select: { number: true } },
        transfer: {
          select: {
            number: true,
            fromBranch: { select: { name: true } },
            toBranch: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return NextResponse.json(movements.map((movement) => ({
      id: movement.id,
      type: movement.type,
      quantity: movement.quantity,
      notes: movement.notes,
      reference: movement.reference,
      createdAt: movement.createdAt,
      product: movement.product,
      sale: movement.sale,
      transfer: movement.transfer,
    })))
  }

  const products = await prisma.product.findMany({
    where: {
      type: 'PRODUCT',
      ...(query ? {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { sku: { contains: query, mode: 'insensitive' } },
        ],
      } : {}),
    },
    include: {
    category: true,
    branchStocks: { where: scope, select: { quantity: true } },
    inventoryMovements: { where: scope, orderBy: { createdAt: 'desc' }, take: 5 },
    },
    orderBy: [{ currentStock: 'asc' }, { name: 'asc' }],
  })

  return NextResponse.json(products.map((product) => ({
    ...product,
    currentStock: branchContext.branchId ? product.branchStocks[0]?.quantity ?? 0 : product.currentStock,
    cost: product.cost.toString(),
    price: product.price.toString(),
    branchStocks: undefined,
    inventoryMovements: product.inventoryMovements.map((movement) => ({
      ...movement,
      unitCost: movement.unitCost?.toString() ?? null,
    })),
  })))
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'inventory:write')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!
  const payload = movementSchema.safeParse(await request.json())

  if (!payload.success) {
    return NextResponse.json({ error: 'Revisa el producto, tipo y cantidad del movimiento.' }, { status: 400 })
  }

  if (payload.data.type === 'RETURN_IN') {
    const financeAccess = await requirePermission(request, 'finance:write')
    if (financeAccess.response) return financeAccess.response
  }

  const isIncrease = payload.data.type === 'ADJUSTMENT_IN' || payload.data.type === 'RETURN_IN'
  const quantity = isIncrease ? payload.data.quantity : -payload.data.quantity

  try {
    if (payload.data.type === 'RETURN_IN' && !payload.data.saleId) {
      return NextResponse.json({ error: 'Selecciona la venta relacionada con la devolución.' }, { status: 400 })
    }

    const movement = await serializableTransaction(async (transaction) => {
      const product = await transaction.product.findUnique({ where: { id: payload.data.productId } })
      if (!product || !product.isActive || product.type !== 'PRODUCT') throw new Error('PRODUCT_NOT_FOUND')

      let sale: { id: string; number: string } | null = null
      let refundAmount = 0
      let returnCost = Number(product.cost) * payload.data.quantity
      let isCreditReturn = false
      let receivableApplied = 0
      let cashRefund = 0
      if (payload.data.type === 'RETURN_IN' && payload.data.saleId) {
        const saleDetails = await transaction.sale.findUnique({
          where: { id: payload.data.saleId, branchId },
          include: { items: true, movements: { where: { type: 'RETURN_IN' } }, cashAccount: true, receivable: true },
        })
        const saleItem = saleDetails?.items.find((item) => item.productId === product.id)
        if (!saleDetails || saleDetails.status !== 'COMPLETED' || !saleItem) throw new Error('SALE_ITEM_NOT_FOUND')
        const returnedQuantity = saleDetails.movements
          .filter((item) => item.productId === product.id)
          .reduce((sum, item) => sum + item.quantity, 0)
        if (payload.data.quantity > saleItem.quantity - returnedQuantity) throw new Error('RETURN_QUANTITY_EXCEEDED')
        refundAmount = roundMoney(Number(saleItem.unitPrice) * payload.data.quantity)
        returnCost = roundMoney(Number(saleItem.unitCost) * payload.data.quantity)

        if (saleDetails.paymentMethod !== 'CREDIT') {
          const accountId = payload.data.cashAccountId
          if (!accountId) throw new Error('CASH_ACCOUNT_REQUIRED')
          const account = await transaction.cashAccount.findFirst({ where: { id: accountId, isActive: true, branchId } })
          if (!account) throw new Error('CASH_ACCOUNT_NOT_FOUND')
          if (Number(account.balance) < refundAmount) throw new Error('INSUFFICIENT_BALANCE')
          cashRefund = refundAmount
          await transaction.cashAccount.update({ where: { id: account.id }, data: { balance: { decrement: refundAmount } } })
          await transaction.cashMovement.create({
            data: {
              type: 'OUT',
              amount: refundAmount,
              description: `Devolución de venta ${saleDetails.number}`,
              reference: `DEV-${saleDetails.number}`,
              accountId: account.id,
              saleId: saleDetails.id,
            },
          })
        } else if (!saleDetails.receivable) {
          throw new Error('RECEIVABLE_NOT_FOUND')
        } else if (saleDetails.receivable) {
          isCreditReturn = true
          receivableApplied = roundMoney(Math.min(Number(saleDetails.receivable.balance), refundAmount))
          cashRefund = roundMoney(refundAmount - receivableApplied)
          const nextBalance = roundMoney(Number(saleDetails.receivable.balance) - receivableApplied)
          const originalAmount = roundMoney(Math.max(Number(saleDetails.receivable.originalAmount) - refundAmount, 0))
          const paidAmount = roundMoney(Math.max(Number(saleDetails.receivable.paidAmount) - cashRefund, 0))
          await transaction.accountReceivable.update({
            where: { id: saleDetails.receivable.id },
            data: { originalAmount, paidAmount, balance: nextBalance, status: nextBalance === 0 ? 'PAID' : 'PARTIAL' },
          })
          if (cashRefund > 0) {
            const accountId = payload.data.cashAccountId
            if (!accountId) throw new Error('CASH_ACCOUNT_REQUIRED')
            const account = await transaction.cashAccount.findFirst({ where: { id: accountId, isActive: true, branchId } })
            if (!account) throw new Error('CASH_ACCOUNT_NOT_FOUND')
            if (Number(account.balance) < cashRefund) throw new Error('INSUFFICIENT_BALANCE')
            const reference = `DEV-${saleDetails.number}-${Date.now().toString(36).toUpperCase()}`
            await transaction.cashAccount.update({ where: { id: account.id }, data: { balance: { decrement: cashRefund } } })
            await transaction.cashMovement.create({
              data: {
                type: 'OUT',
                amount: cashRefund,
                description: `Reembolso por devolución de venta ${saleDetails.number}`,
                reference,
                accountId: account.id,
                saleId: saleDetails.id,
              },
            })
            await transaction.receivablePayment.create({
              data: {
                amount: -cashRefund,
                paymentMethod: 'CASH',
                reference,
                receivableId: saleDetails.receivable.id,
                cashAccountId: account.id,
              },
            })
          }
        }
        sale = { id: saleDetails.id, number: saleDetails.number }
      }

      await adjustBranchStock(transaction, product.id, branchId, quantity)

      const created = await transaction.inventoryMovement.create({
        data: {
          type: payload.data.type,
          quantity,
          unitCost: product.cost,
          reference: sale ? `DEV-${sale.number}` : 'AJUSTE-INVENTARIO',
          notes: sale
            ? `${payload.data.notes ? `${payload.data.notes} · ` : ''}Devolución por ${refundAmount.toFixed(2)} Bs.`
            : payload.data.notes,
          productId: product.id,
          saleId: sale?.id,
          branchId,
        },
        include: { product: { select: { name: true, sku: true, currentStock: true } } },
      })
      const movementValue = roundMoney(Number(product.cost) * payload.data.quantity)
      const salesReturnLines: { accountCode: string; debit?: number; credit?: number }[] = []
      if (sale) {
        salesReturnLines.push({ accountCode: '4100', debit: refundAmount })
        if (isCreditReturn) {
          if (receivableApplied > 0) salesReturnLines.push({ accountCode: '1200', credit: receivableApplied })
          if (cashRefund > 0) salesReturnLines.push({ accountCode: '1000', credit: cashRefund })
        } else {
          salesReturnLines.push({ accountCode: '1000', credit: refundAmount })
        }
        salesReturnLines.push(
          { accountCode: '1300', debit: returnCost },
          { accountCode: '5000', credit: returnCost },
        )
      } else if (payload.data.type === 'ADJUSTMENT_IN') {
        salesReturnLines.push(
          { accountCode: '1300', debit: movementValue },
          { accountCode: '4900', credit: movementValue },
        )
      } else {
        salesReturnLines.push(
          { accountCode: '5100', debit: movementValue },
          { accountCode: '1300', credit: movementValue },
        )
      }
      await postJournalEntry(transaction, {
        date: created.createdAt,
        description: sale ? `Devolución de venta ${sale.number}` : `Ajuste de inventario ${created.id}`,
        sourceType: sale ? 'INVENTORY_RETURN' : 'INVENTORY_ADJUSTMENT',
        sourceId: created.id,
        branchId,
        lines: salesReturnLines,
      })
      await logAudit({
        request,
        action: 'CREATE',
        moduleName: 'Inventario',
        entity: 'InventoryMovement',
        entityId: created.id,
        details: sale
          ? `Se registró devolución ${created.reference ?? ''} por ${Math.abs(created.quantity)} unidad(es) y ${refundAmount.toFixed(2)} Bs.`
          : `Se registró ${payload.data.type} de ${Math.abs(created.quantity)} unidad(es) para ${created.product.name}. ${payload.data.notes ?? ''}`,
        newValue: { type: created.type, quantity: created.quantity, productId: created.productId, saleId: created.saleId },
      }, transaction)
      return created
    })

    return NextResponse.json({ ...movement, unitCost: movement.unitCost?.toString() ?? null }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error && error.message === 'INSUFFICIENT_STOCK'
      ? 'El ajuste dejaría el stock en negativo.'
      : error instanceof Error && error.message === 'INSUFFICIENT_BRANCH_STOCK'
        ? 'La sucursal no tiene stock suficiente para registrar esta salida.'
      : error instanceof Error && error.message === 'PRODUCT_NOT_FOUND'
        ? 'El producto no existe o está inactivo.'
        : error instanceof Error && error.message === 'SALE_ITEM_NOT_FOUND'
          ? 'La venta no existe o no contiene este producto.'
          : error instanceof Error && error.message === 'RETURN_QUANTITY_EXCEEDED'
            ? 'La cantidad supera lo vendido o ya devuelto de esta venta.'
            : error instanceof Error && error.message === 'CASH_ACCOUNT_REQUIRED'
              ? 'La venta no tiene una cuenta de cobro asociada.'
              : error instanceof Error && error.message === 'CASH_ACCOUNT_NOT_FOUND'
                ? 'La cuenta de devolución no existe o está inactiva.'
                : error instanceof Error && error.message === 'INSUFFICIENT_BALANCE'
                  ? 'La cuenta no tiene saldo suficiente para devolver ese importe.'
                  : error instanceof Error && error.message === 'RECEIVABLE_REFUND_EXCEEDED'
                    ? 'El importe supera el saldo pendiente de la cuenta por cobrar.'
                    : error instanceof Error && error.message === 'RECEIVABLE_NOT_FOUND'
                      ? 'La venta a crédito no tiene una cuenta por cobrar asociada.'
                        : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_CLOSED'
                          ? 'El período contable de esta fecha está cerrado.'
                          : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_NOT_STARTED'
                            ? 'La fecha de operación es anterior al inicio del libro mayor.'
        : 'No se pudo registrar el movimiento.'

    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  const access = await requireAdmin(request)
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!

  const url = new URL(request.url)
  const id = url.searchParams.get('id') ?? (await request.clone().json().catch(() => ({}))).id

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Falta el identificador del movimiento.' }, { status: 400 })
  }

  try {
    const movement = await prisma.inventoryMovement.findUnique({ where: { id }, include: { product: { select: { name: true } } } })
    if (!movement) return NextResponse.json({ error: 'El movimiento no existe.' }, { status: 404 })
    if (movement.branchId !== branchId) return NextResponse.json({ error: 'El movimiento no pertenece a la sucursal seleccionada.' }, { status: 404 })
    if (movement.saleId || movement.purchaseId || movement.transferId || movement.type === 'SALE' || movement.type === 'PURCHASE') {
      return NextResponse.json({ error: 'No se puede eliminar un movimiento asociado a una venta o compra; registra una operación de reversión.' }, { status: 400 })
    }
    if (movement.type === 'INITIAL') return NextResponse.json({ error: 'No se puede eliminar el movimiento de stock inicial.' }, { status: 400 })
    const journalEntry = await prisma.journalEntry.findFirst({ where: { sourceId: movement.id, sourceType: 'INVENTORY_ADJUSTMENT' }, select: { id: true } })
    if (journalEntry) return NextResponse.json({ error: 'Este ajuste ya está contabilizado y no se puede eliminar. Registra una operación inversa.' }, { status: 400 })

    await prisma.$transaction(async (transaction) => {
      await adjustBranchStock(transaction, movement.productId, branchId, -movement.quantity)
      await transaction.inventoryMovement.delete({ where: { id } })
      await logAudit({
        request,
        action: 'DELETE',
        moduleName: 'Inventario',
        entity: 'InventoryMovement',
        entityId: id,
        details: `Se eliminó el ajuste ${movement.type} de ${movement.quantity} unidad(es) para ${movement.product.name}.`,
        oldValue: { type: movement.type, quantity: movement.quantity, productId: movement.productId },
      }, transaction)
    })

    return NextResponse.json({ ok: true, id })
  } catch {
    return NextResponse.json({ error: 'No se pudo eliminar el movimiento de inventario.' }, { status: 400 })
  }
}
