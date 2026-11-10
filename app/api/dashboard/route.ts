import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import { requireAnyPermission, rolePermissions } from '@/lib/permissions'
import { branchContextError, branchWhere, resolveBranchContext } from '@/lib/branches'

const money = (value: number | { toString(): string }) => Number(value.toString()).toFixed(2)

export async function GET(request: Request) {
  const access = await requireAnyPermission(request, ['sales:read', 'inventory:read', 'finance:read'])
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError
  const scope = branchWhere(branchContext)

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const rolePermissionSet = rolePermissions(access.session?.role ?? '')
  const canReadSales = rolePermissionSet.includes('sales:read')
  const canReadInventory = rolePermissionSet.includes('inventory:read')
  const canReadFinance = rolePermissionSet.includes('finance:read')

  const [sales, previousSales] = canReadSales
    ? await Promise.all([
        prisma.sale.findMany({
          where: { ...scope, status: 'COMPLETED', createdAt: { gte: startOfYear } },
          include: {
            items: { include: { product: { select: { name: true, sku: true } } } },
            movements: { where: { type: 'RETURN_IN' }, select: { productId: true, quantity: true } },
            returns: { include: { items: { select: { productId: true, quantity: true, lineTotal: true, saleItem: { select: { unitCost: true } } } } } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.sale.findMany({
          where: { ...scope, status: 'COMPLETED', createdAt: { gte: startOfPreviousMonth, lt: startOfMonth } },
          select: { total: true, returns: { select: { total: true } } },
        }),
      ])
    : [[], null]
    const [products, movements] = canReadInventory
    ? await Promise.all([
        prisma.product.findMany({ where: { isActive: true, type: 'PRODUCT' }, include: { category: true, branchStocks: { where: scope, select: { quantity: true } } }, orderBy: { currentStock: 'asc' } })
          .then((items) => items
            .map((product) => ({ ...product, currentStock: branchContext.branchId ? product.branchStocks[0]?.quantity ?? 0 : product.currentStock }))
            .sort((left, right) => left.currentStock - right.currentStock)),
        prisma.inventoryMovement.findMany({ where: scope, include: { product: { select: { name: true, sku: true } } }, orderBy: { createdAt: 'desc' }, take: 6 }),
      ])
    : [[], []]
    const [inventorySnapshot, inventoryMovementTotals] = canReadInventory
      ? await Promise.all([
          branchContext.branchId
            ? prisma.productStock.findMany({ where: { branchId: branchContext.branchId, product: { type: 'PRODUCT' } }, select: { productId: true, quantity: true, product: { select: { cost: true } } } })
              .then((rows) => rows.map((row) => ({ id: row.productId, currentStock: row.quantity, cost: row.product.cost })))
            : prisma.product.findMany({ where: { type: 'PRODUCT' }, select: { id: true, currentStock: true, cost: true } }),
          prisma.inventoryMovement.groupBy({ by: ['productId'], where: scope, _sum: { quantity: true } }),
        ])
      : [[], []]
  const [accounts, receivables, payables] = canReadFinance
    ? await Promise.all([
        prisma.cashAccount.findMany({ where: { isActive: true, ...scope }, include: { movements: { select: { type: true, amount: true } } }, orderBy: { name: 'asc' } }),
        prisma.accountReceivable.findMany({ where: { status: { not: 'CANCELLED' }, ...(branchContext.isAll ? {} : { sale: { is: scope } }) } }),
        prisma.accountPayable.findMany({ where: { status: { not: 'CANCELLED' }, ...(branchContext.isAll ? {} : { purchase: { is: scope } }) } }),
      ])
    : [[], [], []]
  const inventoryLedger = canReadFinance
    ? await prisma.journalLine.aggregate({ where: { account: { is: { code: '1300' } }, entry: { is: scope } }, _sum: { debit: true, credit: true } })
    : null

  const monthSales = sales.filter((sale) => sale.createdAt >= startOfMonth)
  const currentSalesTotal = monthSales.reduce((sum, sale) =>
    sum + Number(sale.total) - sale.returns.reduce((returned, item) => returned + Number(item.total), 0), 0)
  const averageTicket = monthSales.length > 0 ? currentSalesTotal / monthSales.length : 0
  const productSales = new Map<string, { name: string; sku: string; quantity: number; total: number }>()
  for (const sale of monthSales) {
    for (const item of sale.items) {
      const key = item.productId
      const returnedQuantity = sale.movements
        .filter((movement) => movement.productId === key)
        .reduce((sum, movement) => sum + movement.quantity, 0)
      const returnedTotal = sale.returns
        .flatMap((saleReturn) => saleReturn.items)
        .filter((returnedItem) => returnedItem.productId === key)
        .reduce((sum, returnedItem) => sum + Number(returnedItem.lineTotal), 0)
      const quantity = Math.max(item.quantity - returnedQuantity, 0)
      if (quantity === 0 && returnedTotal >= Number(item.lineTotal)) continue
      const current = productSales.get(key) ?? { name: item.product.name, sku: item.product.sku, quantity: 0, total: 0 }
      current.quantity += quantity
      current.total += Math.max(Number(item.lineTotal) - returnedTotal, 0)
      productSales.set(key, current)
    }
  }
  const topProducts = [...productSales.entries()]
    .sort(([, left], [, right]) => right.quantity - left.quantity || right.total - left.total)
    .slice(0, 5)
    .map(([productId, product]) => ({ productId, ...product, total: money(product.total) }))
  const currentProfit = monthSales.reduce((sum, sale) => {
    const grossMargin = sale.items.reduce((itemSum, item) => itemSum + Number(item.lineTotal) - Number(item.unitCost) * item.quantity, 0)
    const returnedMargin = sale.returns.reduce((returnSum, saleReturn) =>
      returnSum + saleReturn.items.reduce((itemSum, item) =>
        itemSum + Number(item.lineTotal) - Number(item.saleItem.unitCost) * item.quantity, 0), 0)
    return sum + grossMargin - returnedMargin
  }, 0)
  const previousTotal = previousSales?.reduce((sum, sale) =>
    sum + Number(sale.total) - sale.returns.reduce((returned, item) => returned + Number(item.total), 0), 0) ?? 0
  const change = previousTotal === 0 ? 0 : ((currentSalesTotal - previousTotal) / previousTotal) * 100
  const inventoryValue = inventorySnapshot.reduce((sum, product) => sum + Number(product.cost) * product.currentStock, 0)
  const receivableTotal = receivables.reduce((sum, item) => sum + Number(item.balance), 0)
  const payableTotal = payables.reduce((sum, item) => sum + Number(item.balance), 0)
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
  const difference = (left: number, right: number) => round(left - right)
  const cashBalance = round(accounts.reduce((sum, account) => sum + Number(account.balance), 0))
  const cashMovements = round(accounts.reduce((sum, account) => sum + account.movements.reduce((accountSum, movement) => accountSum + (movement.type === 'IN' ? Number(movement.amount) : -Number(movement.amount)), 0), 0))
  const receivableOriginal = round(receivables.reduce((sum, item) => sum + Number(item.originalAmount), 0))
  const receivablePaid = round(receivables.reduce((sum, item) => sum + Number(item.paidAmount), 0))
  const receivableBalance = round(receivables.reduce((sum, item) => sum + Number(item.balance), 0))
  const payableOriginal = round(payables.reduce((sum, item) => sum + Number(item.originalAmount), 0))
  const payablePaid = round(payables.reduce((sum, item) => sum + Number(item.paidAmount), 0))
  const payableBalance = round(payables.reduce((sum, item) => sum + Number(item.balance), 0))
  const inventoryCostValue = round(inventoryValue)
  const movementQuantityByProduct = new Map(inventoryMovementTotals.map((movement) => [movement.productId, Number(movement._sum.quantity ?? 0)]))
  const inventoryMismatches = inventorySnapshot.filter((product) => product.currentStock !== (movementQuantityByProduct.get(product.id) ?? 0))
  const inventoryLedgerValue = round(Number(inventoryLedger?._sum.debit ?? 0) - Number(inventoryLedger?._sum.credit ?? 0))
  const inventoryLedgerDifference = round(inventoryCostValue - inventoryLedgerValue)
  const chart = Array.from({ length: 12 }, (_, index) => ({
    month: new Date(now.getFullYear(), index, 1).toLocaleDateString('es-BO', { month: 'short' }).replace('.', ''),
    value: sales.filter((sale) => sale.createdAt.getMonth() === index).reduce((sum, sale) =>
      sum + Number(sale.total) - sale.returns.reduce((returned, item) => returned + Number(item.total), 0), 0),
  }))

  return NextResponse.json({
    visibility: { sales: canReadSales, inventory: canReadInventory, finance: canReadFinance },
    kpis: { sales: money(currentSalesTotal), profit: money(currentProfit), averageTicket: money(averageTicket), salesCount: monthSales.length, receivables: money(receivableTotal), inventory: money(inventoryValue), salesChange: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`, payables: money(payableTotal) },
    chart,
    topProducts,
    accounts: accounts.map((account) => ({ name: account.name, type: account.type, balance: money(account.balance) })),
    reconciliation: {
      cash: { recorded: money(cashBalance), movements: money(cashMovements), difference: money(difference(cashBalance, cashMovements)), reconciled: Math.abs(difference(cashBalance, cashMovements)) <= 0.01 },
      receivables: { original: money(receivableOriginal), paid: money(receivablePaid), balance: money(receivableBalance), difference: money(difference(receivableOriginal, receivablePaid + receivableBalance)), reconciled: Math.abs(difference(receivableOriginal, receivablePaid + receivableBalance)) <= 0.01 },
      payables: { original: money(payableOriginal), paid: money(payablePaid), balance: money(payableBalance), difference: money(difference(payableOriginal, payablePaid + payableBalance)), reconciled: Math.abs(difference(payableOriginal, payablePaid + payableBalance)) <= 0.01 },
      inventory: {
        valueAtCost: money(inventoryCostValue),
        ledgerValue: money(inventoryLedgerValue),
        difference: money(inventoryLedgerDifference),
        stockMismatches: inventoryMismatches.length,
        reconciled: canReadFinance && inventoryMismatches.length === 0 && Math.abs(inventoryLedgerDifference) <= 0.01,
      },
    },
    lowStock: products.filter((product) => product.currentStock <= product.minimumStock).slice(0, 6).map((product) => ({ name: product.name, sku: product.sku, category: product.category.name, stock: product.currentStock, price: money(product.price) })),
    movements: movements.map((movement) => ({ type: movement.type, product: movement.product.name, sku: movement.product.sku, quantity: movement.quantity, time: movement.createdAt.toISOString() })),
  })
}
