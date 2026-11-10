import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'
import { branchContextError, branchWhere, resolveBranchContext } from '@/lib/branches'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
})

type LedgerEntry = {
  id: string
  groupId: string
  date: Date
  number: string
  description: string
  details?: string[]
  debit: number
  credit: number
  outstandingBalance?: number
  dueDate?: Date
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function paymentMethodLabel(method: string) {
  const labels: Record<string, string> = {
    CASH: 'Efectivo',
    BANK_TRANSFER: 'Transferencia bancaria',
    OTHER: 'Otro',
    CARD: 'Tarjeta',
    QR: 'QR',
    CREDIT: 'Crédito',
  }
  return labels[method] ?? method
}

export async function GET(request: Request) {
  const access = await requirePermission(request, 'finance:read')
  if (access.response) return access.response

  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError

  const url = new URL(request.url)
  const type = z.enum(['customer', 'supplier']).safeParse(url.searchParams.get('type'))
  const partyId = z.string().min(1).safeParse(url.searchParams.get('partyId'))
  const fromValue = url.searchParams.get('from')
  const toValue = url.searchParams.get('to')
  const from = fromValue ? dateSchema.safeParse(fromValue) : null
  const to = toValue ? dateSchema.safeParse(toValue) : null

  if (!type.success || !partyId.success || (from && !from.success) || (to && !to.success)) {
    return NextResponse.json({ error: 'Los datos del estado de cuenta no son válidos.' }, { status: 400 })
  }
  if (fromValue && toValue && fromValue > toValue) {
    return NextResponse.json({ error: 'La fecha inicial no puede ser posterior a la fecha final.' }, { status: 400 })
  }

  const start = fromValue ? new Date(`${fromValue}T00:00:00.000Z`) : null
  const endExclusive = toValue ? new Date(`${toValue}T00:00:00.000Z`) : null
  if (endExclusive) endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)

  let party: { id: string; name: string; document: string } | null
  const entries: LedgerEntry[] = []

  if (type.data === 'customer') {
    party = await prisma.customer.findUnique({
      where: { id: partyId.data },
      select: { id: true, name: true, document: true },
    })
    if (!party) return NextResponse.json({ error: 'No se encontró el cliente.' }, { status: 404 })

    const sales = await prisma.sale.findMany({
      where: { customerId: party.id, ...branchWhere(branchContext) },
      select: {
        id: true,
        number: true,
        status: true,
        paymentMethod: true,
        total: true,
        notes: true,
        createdAt: true,
        items: {
          select: {
            quantity: true,
            lineTotal: true,
            product: { select: { name: true, type: true } },
          },
        },
        cashMovements: { select: { id: true, type: true, amount: true, description: true, reference: true, createdAt: true } },
        returns: { select: { id: true, number: true, total: true, cashAccountId: true, createdAt: true } },
        receivable: {
          select: {
            updatedAt: true,
            status: true,
            balance: true,
            dueDate: true,
            payments: {
              select: { id: true, amount: true, paymentMethod: true, reference: true, description: true, externalReference: true, createdAt: true, reversedAt: true, reversalReason: true },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })

    for (const sale of sales) {
      entries.push({
        id: `sale-${sale.id}`,
        groupId: `sale-${sale.id}`,
        date: sale.createdAt,
        number: sale.number,
        description: sale.status === 'CANCELLED' ? 'Venta anulada' : sale.notes || 'Venta',
        details: sale.items.map((item) =>
          `${item.product.type === 'SERVICE' ? 'Servicio' : 'Producto'}: ${item.product.name} × ${item.quantity} · Bs ${Number(item.lineTotal).toFixed(2)}`,
        ),
        debit: Number(sale.total),
        credit: 0,
        outstandingBalance:
          sale.receivable && sale.receivable.status !== 'PAID' && sale.receivable.status !== 'CANCELLED'
            ? Number(sale.receivable.balance)
            : 0,
        dueDate: sale.receivable?.dueDate,
      })
      if (sale.status === 'CANCELLED') {
        const returnedTotal = sale.returns.reduce((total, saleReturn) => total + Number(saleReturn.total), 0)
        const cancellationMovement = sale.cashMovements.find((movement) =>
          movement.type === 'OUT' && movement.description.toLocaleLowerCase().includes('anulación'),
        )
        entries.push({
          id: `cancel-${sale.id}`,
          groupId: `sale-${sale.id}`,
          date: cancellationMovement?.createdAt ?? sale.receivable?.updatedAt ?? sale.createdAt,
          number: sale.number,
          description: 'Anulación de venta',
          debit: 0,
          credit: Math.max(Number(sale.total) - returnedTotal, 0),
        })
      }
      for (const saleReturn of sale.returns) {
        entries.push({
          id: `return-${saleReturn.id}`,
          groupId: `return-${saleReturn.id}`,
          date: saleReturn.createdAt,
          number: saleReturn.number,
          description: 'Devolución de venta',
          debit: 0,
          credit: Number(saleReturn.total),
        })
      }
      for (const movement of sale.cashMovements) {
        const recordedAsReceivablePayment =
          movement.type === 'IN' &&
          sale.receivable?.payments.some((payment) =>
            Number(payment.amount) === Number(movement.amount) &&
            payment.createdAt.getTime() === movement.createdAt.getTime(),
          )
        if (recordedAsReceivablePayment) continue

        entries.push({
          id: `cash-sale-${movement.id}`,
          groupId: `sale-${sale.id}`,
          date: movement.createdAt,
          number: movement.reference ?? sale.number,
          description: movement.description,
          details: movement.type === 'IN'
            ? [`Medio: ${paymentMethodLabel(sale.paymentMethod)}`, `Importe: Bs ${Number(movement.amount).toFixed(2)}`]
            : [`Importe reembolsado: Bs ${Number(movement.amount).toFixed(2)}`],
          debit: movement.type === 'OUT' ? Number(movement.amount) : 0,
          credit: movement.type === 'IN' ? Number(movement.amount) : 0,
        })
      }
      for (const payment of sale.receivable?.payments ?? []) {
        entries.push({
          id: `payment-${payment.id}`,
          groupId: `sale-${sale.id}`,
          date: payment.createdAt,
          number: payment.reference ?? sale.number,
          description: payment.reversedAt ? 'Cobro revertido' : payment.description || 'Cobro recibido',
          details: [
            `Medio: ${paymentMethodLabel(payment.paymentMethod)}`,
            `Importe: Bs ${Number(payment.amount).toFixed(2)}`,
            ...(payment.externalReference ? [`Referencia: ${payment.externalReference}`] : []),
          ],
          debit: 0,
          credit: Number(payment.amount),
        })
        if (payment.reversedAt) {
          entries.push({
            id: `payment-reversal-${payment.id}`,
            groupId: `sale-${sale.id}`,
            date: payment.reversedAt,
            number: payment.reference ?? sale.number,
            description: `Reversión de cobro: ${payment.reversalReason ?? ''}`.trim(),
            details: [
              `Medio original: ${paymentMethodLabel(payment.paymentMethod)}`,
              `Importe revertido: Bs ${Number(payment.amount).toFixed(2)}`,
              ...(payment.externalReference ? [`Referencia: ${payment.externalReference}`] : []),
            ],
            debit: Number(payment.amount),
            credit: 0,
          })
        }
      }
    }
  } else {
    party = await prisma.supplier.findUnique({
      where: { id: partyId.data },
      select: { id: true, name: true, document: true },
    })
    if (!party) return NextResponse.json({ error: 'No se encontró el proveedor.' }, { status: 404 })

    const purchases = await prisma.purchase.findMany({
      where: { supplierId: party.id, ...branchWhere(branchContext) },
      select: {
        id: true,
        number: true,
        status: true,
        paymentMethod: true,
        total: true,
        createdAt: true,
        items: {
          select: {
            quantity: true,
            lineTotal: true,
            product: { select: { name: true, type: true } },
          },
        },
        cashMovements: { select: { id: true, type: true, amount: true, description: true, createdAt: true } },
        payable: {
          select: {
            updatedAt: true,
            payments: {
              select: { id: true, amount: true, paymentMethod: true, reference: true, createdAt: true, reversedAt: true, reversalReason: true },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })

    for (const purchase of purchases) {
      entries.push({
        id: `purchase-${purchase.id}`,
        groupId: `purchase-${purchase.id}`,
        date: purchase.createdAt,
        number: purchase.number,
        description: purchase.status === 'CANCELLED' ? 'Compra anulada' : 'Compra',
        details: purchase.items.map((item) =>
          `${item.product.type === 'SERVICE' ? 'Servicio' : 'Producto'}: ${item.product.name} × ${item.quantity} · Bs ${Number(item.lineTotal).toFixed(2)}`,
        ),
        debit: Number(purchase.total),
        credit: 0,
      })
      if (purchase.status === 'CANCELLED') {
        const refundMovement = purchase.cashMovements.find((movement) => movement.type === 'IN')
        entries.push({
          id: `cancel-purchase-${purchase.id}`,
          groupId: `purchase-${purchase.id}`,
          date: refundMovement?.createdAt ?? purchase.payable?.updatedAt ?? purchase.createdAt,
          number: purchase.number,
          description: 'Anulación de compra',
          debit: 0,
          credit: Number(purchase.total),
        })
      }
      for (const movement of purchase.cashMovements) {
        entries.push({
          id: `cash-purchase-${movement.id}`,
          groupId: `purchase-${purchase.id}`,
          date: movement.createdAt,
          number: purchase.number,
          description: movement.description,
          details: movement.type === 'OUT'
            ? [`Medio: ${paymentMethodLabel(purchase.paymentMethod)}`, `Importe: Bs ${Number(movement.amount).toFixed(2)}`]
            : [`Importe reembolsado: Bs ${Number(movement.amount).toFixed(2)}`],
          debit: movement.type === 'IN' ? Number(movement.amount) : 0,
          credit: movement.type === 'OUT' ? Number(movement.amount) : 0,
        })
      }
      for (const payment of purchase.payable?.payments ?? []) {
        entries.push({
          id: `payment-${payment.id}`,
          groupId: `purchase-${purchase.id}`,
          date: payment.createdAt,
          number: payment.reference ?? purchase.number,
          description: payment.reversedAt ? 'Pago revertido' : 'Pago realizado',
          details: [`Medio: ${paymentMethodLabel(payment.paymentMethod)}`, `Importe: Bs ${Number(payment.amount).toFixed(2)}`],
          debit: 0,
          credit: Number(payment.amount),
        })
        if (payment.reversedAt) {
          entries.push({
            id: `payment-reversal-${payment.id}`,
            groupId: `purchase-${purchase.id}`,
            date: payment.reversedAt,
            number: payment.reference ?? purchase.number,
            description: `Reversión de pago: ${payment.reversalReason ?? ''}`.trim(),
            details: [`Medio original: ${paymentMethodLabel(payment.paymentMethod)}`, `Importe revertido: Bs ${Number(payment.amount).toFixed(2)}`],
            debit: Number(payment.amount),
            credit: 0,
          })
        }
      }
    }
  }

  const firstDateByGroup = new Map<string, number>()
  for (const entry of entries) {
    const firstDate = firstDateByGroup.get(entry.groupId)
    if (firstDate === undefined || entry.date.getTime() < firstDate) {
      firstDateByGroup.set(entry.groupId, entry.date.getTime())
    }
  }
  entries.sort((left, right) => {
    const groupDateOrder = firstDateByGroup.get(left.groupId)! - firstDateByGroup.get(right.groupId)!
    if (groupDateOrder !== 0) return groupDateOrder
    const groupOrder = left.groupId.localeCompare(right.groupId)
    if (groupOrder !== 0) return groupOrder
    const dateOrder = left.date.getTime() - right.date.getTime()
    if (dateOrder !== 0) return dateOrder
    const rowOrder = (entry: LedgerEntry) => entry.id.startsWith('sale-') || entry.id.startsWith('purchase-')
      ? 0
      : entry.id.startsWith('cash-')
        ? 1
        : entry.id.startsWith('payment-')
          ? 2
          : 3
    return rowOrder(left) - rowOrder(right) || left.id.localeCompare(right.id)
  })
  const openingBalance = round(entries
    .filter((entry) => start && entry.date < start)
    .reduce((balance, entry) => balance + entry.debit - entry.credit, 0))
  const selectedEntries = entries.filter((entry) =>
    (!start || entry.date >= start) && (!endExclusive || entry.date < endExclusive),
  )
  let balance = openingBalance
  const data = selectedEntries.map((entry) => {
    balance = round(balance + entry.debit - entry.credit)
    return {
      ...entry,
      date: entry.date.toISOString(),
      debit: round(entry.debit),
      credit: round(entry.credit),
      balance,
    }
  })

  return NextResponse.json({
    party,
    type: type.data,
    from: fromValue,
    to: toValue,
    openingBalance,
    closingBalance: balance,
    entries: data,
  })
}
