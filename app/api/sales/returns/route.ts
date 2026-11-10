import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma, serializableTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { postJournalEntry } from '@/lib/accounting'
import { adjustBranchStock } from '@/lib/branch-stock'
import { requireSingleBranch, resolveBranchContext } from '@/lib/branches'

const returnSchema = z.object({
  saleId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
  items: z.array(z.object({
    saleItemId: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
  })).min(1),
})

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

function returnNumber() {
  return `DEV-${Date.now().toString(36).toUpperCase()}`
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'sales:write')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!

  const payload = returnSchema.safeParse(await request.json())
  if (!payload.success) {
    return NextResponse.json({ error: 'Indica el motivo y al menos un producto con cantidad válida.' }, { status: 400 })
  }

  const uniqueItemIds = new Set(payload.data.items.map((item) => item.saleItemId))
  if (uniqueItemIds.size !== payload.data.items.length) {
    return NextResponse.json({ error: 'No repitas un producto en la misma devolución.' }, { status: 400 })
  }

  try {
    const result = await serializableTransaction(async (transaction) => {
      const sale = await transaction.sale.findUnique({
        where: { id: payload.data.saleId, branchId },
        include: {
          items: { include: { product: { select: { type: true } } } },
          returns: { include: { items: { select: { saleItemId: true, quantity: true, lineTotal: true } } } },
          receivable: true,
        },
      })
      if (!sale || sale.status !== 'COMPLETED') throw new Error('SALE_NOT_RETURNABLE')

      const previousReturns = new Map<string, { quantity: number; total: number }>()
      for (const saleReturn of sale.returns) {
        for (const item of saleReturn.items) {
          const previous = previousReturns.get(item.saleItemId) ?? { quantity: 0, total: 0 }
          previous.quantity += item.quantity
          previous.total += Number(item.lineTotal)
          previousReturns.set(item.saleItemId, previous)
        }
      }

      const itemById = new Map(sale.items.map((item) => [item.id, item]))
      const lines = payload.data.items.map((requested) => {
        const saleItem = itemById.get(requested.saleItemId)
        if (!saleItem) throw new Error('SALE_ITEM_NOT_FOUND')
        if (saleItem.product.type !== 'PRODUCT') throw new Error('SERVICE_NOT_RETURNABLE')

        const previous = previousReturns.get(saleItem.id) ?? { quantity: 0, total: 0 }
        const nextQuantity = previous.quantity + requested.quantity
        if (nextQuantity > saleItem.quantity) throw new Error('RETURN_QUANTITY_EXCEEDS_SOLD')

        const nextReturnedTotal = nextQuantity === saleItem.quantity
          ? Number(saleItem.lineTotal)
          : roundMoney(Number(saleItem.lineTotal) * nextQuantity / saleItem.quantity)
        const lineTotal = roundMoney(nextReturnedTotal - previous.total)

        return {
          saleItem,
          quantity: requested.quantity,
          lineTotal,
        }
      })
      const total = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0))
      const returnedCost = roundMoney(lines.reduce((sum, line) => sum + Number(line.saleItem.unitCost) * line.quantity, 0))
      const number = returnNumber()

      let cashAccountId: string | undefined
      let nextReceivableBalance: number | undefined
      if (sale.paymentMethod === 'CREDIT') {
        if (!sale.receivable || sale.receivable.status === 'CANCELLED') throw new Error('RECEIVABLE_NOT_FOUND')
        const balance = Number(sale.receivable.balance)
        if (total > balance) throw new Error('RETURN_EXCEEDS_CREDIT_BALANCE')
        nextReceivableBalance = roundMoney(balance - total)
      } else if (total > 0) {
        if (!sale.cashAccountId) throw new Error('CASH_ACCOUNT_NOT_FOUND')
        const account = await transaction.cashAccount.findFirst({
          where: { id: sale.cashAccountId, isActive: true, branchId },
        })
        if (!account) throw new Error('CASH_ACCOUNT_NOT_FOUND')
        if (Number(account.balance) < total) throw new Error('INSUFFICIENT_REFUND_BALANCE')
        cashAccountId = account.id
      }

      const createdReturn = await transaction.saleReturn.create({
        data: {
          number,
          reason: payload.data.reason,
          total,
          saleId: sale.id,
          cashAccountId,
          items: {
            create: lines.map((line) => ({
              quantity: line.quantity,
              lineTotal: line.lineTotal,
              saleItemId: line.saleItem.id,
              productId: line.saleItem.productId,
            })),
          },
        },
      })

      for (const line of lines) {
        if (line.saleItem.product.type !== 'PRODUCT') continue
        await adjustBranchStock(transaction, line.saleItem.productId, branchId, line.quantity)
        await transaction.inventoryMovement.create({
          data: {
            type: 'RETURN_IN',
            quantity: line.quantity,
            unitCost: line.saleItem.unitCost,
            reference: number,
            notes: payload.data.reason,
            productId: line.saleItem.productId,
            saleId: sale.id,
            branchId,
          },
        })
      }

      if (sale.paymentMethod === 'CREDIT' && sale.receivable && nextReceivableBalance !== undefined) {
        const updatedReceivable = await transaction.accountReceivable.update({
          where: { id: sale.receivable.id },
          data: {
            originalAmount: { decrement: total },
            balance: nextReceivableBalance,
            status: nextReceivableBalance === 0 ? 'PAID' : total > 0 ? 'PARTIAL' : sale.receivable.status,
          },
        })
        nextReceivableBalance = Number(updatedReceivable.balance)
      } else if (cashAccountId && total > 0) {
        await transaction.cashAccount.update({
          where: { id: cashAccountId },
          data: { balance: { decrement: total } },
        })
        await transaction.cashMovement.create({
          data: {
            type: 'OUT',
            amount: total,
            description: `Devolución ${number} de venta ${sale.number}`,
            reference: number,
            accountId: cashAccountId,
            saleId: sale.id,
          },
        })
      }

      if (total > 0 || returnedCost > 0) {
        await postJournalEntry(transaction, {
          date: createdReturn.createdAt,
          description: `Devolución ${number} de venta ${sale.number}`,
          sourceType: 'SALE_RETURN',
          sourceId: createdReturn.id,
          branchId,
          lines: [
            { accountCode: '4100', debit: total },
            { accountCode: sale.paymentMethod === 'CREDIT' ? '1200' : '1000', credit: total },
            { accountCode: '1300', debit: returnedCost },
            { accountCode: '5000', credit: returnedCost },
          ],
        })
      }

      await logAudit({
        request,
        action: 'CREATE',
        moduleName: 'Ventas',
        entity: 'SaleReturn',
        entityId: createdReturn.id,
        details: `Se registró la devolución ${number} de la venta ${sale.number} por ${total.toFixed(2)} Bs. Motivo: ${payload.data.reason}.`,
        newValue: {
          saleId: sale.id,
          saleNumber: sale.number,
          total,
          items: lines.map((line) => ({ saleItemId: line.saleItem.id, quantity: line.quantity, total: line.lineTotal })),
          remainingReceivable: nextReceivableBalance,
        },
      }, transaction)

      return {
        id: createdReturn.id,
        number,
        saleNumber: sale.number,
        total,
        remainingReceivable: nextReceivableBalance,
      }
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('ERROR_CREATING_SALE_RETURN', error)
    const messages: Record<string, string> = {
      SALE_NOT_RETURNABLE: 'Solo se pueden devolver productos de ventas completadas.',
      SERVICE_NOT_RETURNABLE: 'Los servicios no se pueden devolver desde este módulo.',
      SALE_ITEM_NOT_FOUND: 'Uno de los productos no pertenece a esta venta.',
      RETURN_QUANTITY_EXCEEDS_SOLD: 'La cantidad devuelta supera las unidades vendidas menos devoluciones anteriores.',
      INSUFFICIENT_BRANCH_STOCK: 'No hay existencias suficientes en la sucursal para completar la devolución.',
      RECEIVABLE_NOT_FOUND: 'La venta a crédito no tiene una cuenta por cobrar vigente.',
      RETURN_EXCEEDS_CREDIT_BALANCE: 'La devolución supera el saldo pendiente; primero registra el cobro correspondiente o ajusta las cantidades.',
      CASH_ACCOUNT_NOT_FOUND: 'La cuenta original de la venta no existe o está inactiva.',
      INSUFFICIENT_REFUND_BALANCE: 'La cuenta original no tiene saldo suficiente para reembolsar la devolución.',
      ACCOUNTING_PERIOD_CLOSED: 'El período contable de esta fecha está cerrado.',
      ACCOUNTING_PERIOD_NOT_STARTED: 'La fecha de operación es anterior al inicio del libro mayor.',
    }
    return NextResponse.json({
      error: error instanceof Error ? messages[error.message] ?? 'No se pudo registrar la devolución.' : 'No se pudo registrar la devolución.',
    }, { status: 400 })
  }
}
