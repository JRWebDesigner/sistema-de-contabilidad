import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { requireAdmin, requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { branchContextError, branchWhere, resolveBranchContext } from '@/lib/branches'

const resourceSchema = z.enum(['periods', 'journal', 'trial-balance', 'income-statement', 'balance-sheet', 'cash-flow'])
const periodActionSchema = z.object({
  action: z.enum(['close', 'reopen']),
  periodId: z.string().min(1),
  reason: z.string().trim().min(3).max(500).optional(),
})

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const day = (value: string) => new Date(`${value}T00:00:00.000Z`)

export async function GET(request: Request) {
  const access = await requirePermission(request, 'finance:read')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError

  const url = new URL(request.url)
  const parsedResource = resourceSchema.safeParse(url.searchParams.get('resource'))
  if (!parsedResource.success) return NextResponse.json({ error: 'Tipo de informe contable inválido.' }, { status: 400 })

  const resource = parsedResource.data
  const yearResult = z.coerce.number().int().min(2000).max(2200).safeParse(url.searchParams.get('year') ?? new Date().getUTCFullYear())
  if (!yearResult.success) return NextResponse.json({ error: 'El año no es válido.' }, { status: 400 })

  if (resource === 'periods') {
    const year = yearResult.data
    const opening = await prisma.journalEntry.findFirst({ where: { sourceType: 'OPENING_BALANCE' }, orderBy: { entryDate: 'asc' }, select: { entryDate: true } })
    const cutoff = opening?.entryDate
    for (let month = 0; month < 12; month += 1) {
      const firstDay = new Date(Date.UTC(year, month, 1))
      const lastDay = new Date(Date.UTC(year, month + 1, 0))
      if (cutoff && lastDay < cutoff) continue
      const monthStart = cutoff && firstDay < cutoff ? cutoff : firstDay
      const code = `${year}-${String(month + 1).padStart(2, '0')}`
      await prisma.accountingPeriod.upsert({
        where: { code },
        create: { code, startDate: monthStart, endDate: lastDay },
        update: {},
      })
    }
    const periods = await prisma.accountingPeriod.findMany({ where: { startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }, orderBy: { startDate: 'asc' } })
    return NextResponse.json(periods)
  }

  const fromQuery = url.searchParams.get('from')
  const toQuery = url.searchParams.get('to')
  const fromDate = fromQuery ? day(fromQuery) : resource === 'income-statement' || resource === 'cash-flow' ? new Date(Date.UTC(yearResult.data, 0, 1)) : undefined
  const toDate = toQuery ? day(toQuery) : day(new Date().toISOString().slice(0, 10))
  if ((fromDate && Number.isNaN(fromDate.getTime())) || Number.isNaN(toDate.getTime()) || (fromDate && fromDate > toDate)) {
    return NextResponse.json({ error: 'El rango de fechas no es válido.' }, { status: 400 })
  }
  const openingEntry = await prisma.journalEntry.findFirst({ where: { sourceType: 'OPENING_BALANCE' }, orderBy: { entryDate: 'asc' }, select: { entryDate: true } })
  if (openingEntry && (toDate < openingEntry.entryDate || (fromDate && fromDate < openingEntry.entryDate))) {
    return NextResponse.json({ error: `El libro mayor inicia el ${openingEntry.entryDate.toISOString().slice(0, 10)}; elige un rango posterior.` }, { status: 400 })
  }

  const lines = await prisma.journalLine.findMany({
    where: {
      ...(resource === 'journal' && url.searchParams.get('accountId') ? { accountId: url.searchParams.get('accountId')! } : {}),
      entry: { is: {
        entryDate: { ...(fromDate ? { gte: fromDate } : {}), lte: toDate },
        ...branchWhere(branchContext),
        ...(resource === 'cash-flow' ? { sourceType: { not: 'OPENING_BALANCE' } } : {}),
      } },
    },
    include: { account: true, entry: true },
    orderBy: [{ entry: { entryDate: 'asc' } }, { entryId: 'asc' }, { id: 'asc' }],
  })

  if (resource === 'journal') {
    return NextResponse.json(lines.map((line) => ({
      date: line.entry.entryDate,
      number: line.entry.number,
      description: line.entry.description,
      accountCode: line.account.code,
      accountName: line.account.name,
      lineDescription: line.description,
      debit: line.debit.toString(),
      credit: line.credit.toString(),
    })))
  }

  const accountTotals = new Map<string, { account: typeof lines[number]['account']; debit: number; credit: number }>()
  for (const line of lines) {
    const total = accountTotals.get(line.accountId) ?? { account: line.account, debit: 0, credit: 0 }
    total.debit += Number(line.debit)
    total.credit += Number(line.credit)
    accountTotals.set(line.accountId, total)
  }

  const totals = Array.from(accountTotals.values()).map(({ account, debit, credit }) => ({
    code: account.code,
    name: account.name,
    type: account.type,
    debit: round(debit),
    credit: round(credit),
    balance: round(['ASSET', 'EXPENSE'].includes(account.type) ? debit - credit : credit - debit),
  }))

  if (resource === 'trial-balance') {
    return NextResponse.json({ data: totals, debitTotal: round(totals.reduce((sum, item) => sum + item.debit, 0)), creditTotal: round(totals.reduce((sum, item) => sum + item.credit, 0)) })
  }

  if (resource === 'income-statement') {
    const income = totals.filter((item) => item.type === 'INCOME').map((item) => ({ ...item, balance: round(item.credit - item.debit) }))
    const expenses = totals.filter((item) => item.type === 'EXPENSE').map((item) => ({ ...item, balance: round(item.debit - item.credit) }))
    const incomeTotal = round(income.reduce((sum, item) => sum + item.balance, 0))
    const expenseTotal = round(expenses.reduce((sum, item) => sum + item.balance, 0))
    const salesRevenue = round(income.find((item) => item.code === '4000')?.balance ?? 0)
    const salesReturns = round(expenses.find((item) => item.code === '4100')?.balance ?? 0)
    const netSales = round(salesRevenue - salesReturns)
    const costOfSales = round(expenses.find((item) => item.code === '5000')?.balance ?? 0)
    const grossProfit = round(netSales - costOfSales)
    const operatingExpenses = round(expenses
      .filter((item) => item.code !== '4100' && item.code !== '5000')
      .reduce((sum, item) => sum + item.balance, 0))
    const operatingIncome = round(grossProfit - operatingExpenses)
    const otherIncome = round(income
      .filter((item) => item.code !== '4000')
      .reduce((sum, item) => sum + item.balance, 0))
    const netIncome = round(incomeTotal - expenseTotal)
    return NextResponse.json({
      income,
      expenses,
      incomeTotal,
      expenseTotal,
      salesRevenue,
      salesReturns,
      netSales,
      costOfSales,
      grossProfit,
      grossMarginPercent: netSales > 0 ? round(grossProfit / netSales * 100) : 0,
      operatingExpenses,
      operatingIncome,
      otherIncome,
      netIncome,
      netMarginPercent: netSales > 0 ? round(netIncome / netSales * 100) : 0,
    })
  }

  if (resource === 'balance-sheet') {
    const assets = totals.filter((item) => item.type === 'ASSET')
    const liabilities = totals.filter((item) => item.type === 'LIABILITY')
    const equityAccounts = totals.filter((item) => item.type === 'EQUITY')
    const earnings = round(totals.filter((item) => item.type === 'INCOME').reduce((sum, item) => sum + item.credit - item.debit, 0)
      - totals.filter((item) => item.type === 'EXPENSE').reduce((sum, item) => sum + item.debit - item.credit, 0))
    const assetTotal = round(assets.reduce((sum, item) => sum + item.balance, 0))
    const liabilityTotal = round(liabilities.reduce((sum, item) => sum + item.balance, 0))
    const equityTotal = round(equityAccounts.reduce((sum, item) => sum + item.balance, 0) + earnings)
    return NextResponse.json({ assets, liabilities, equity: equityAccounts, retainedEarnings: earnings, assetTotal, liabilityTotal, equityTotal, difference: round(assetTotal - liabilityTotal - equityTotal) })
  }

  if (resource === 'cash-flow') {
    const cashLines = lines.filter((line) => line.account.code === '1000')
    const inflows = round(cashLines.reduce((sum, line) => sum + Number(line.debit), 0))
    const outflows = round(cashLines.reduce((sum, line) => sum + Number(line.credit), 0))
    return NextResponse.json({ inflows, outflows, netCashFlow: round(inflows - outflows), entries: cashLines.map((line) => ({ date: line.entry.entryDate, number: line.entry.number, description: line.entry.description, inflow: Number(line.debit), outflow: Number(line.credit) })) })
  }

  return NextResponse.json({ error: 'Informe contable no disponible.' }, { status: 400 })
}

export async function POST(request: Request) {
  const access = await requireAdmin(request)
  if (access.response) return access.response
  const payload = periodActionSchema.safeParse(await request.json())
  if (!payload.success || (payload.data.action === 'reopen' && !payload.data.reason)) {
    return NextResponse.json({ error: 'Selecciona un período y especifica el motivo de reapertura.' }, { status: 400 })
  }

  try {
    const period = await prisma.$transaction(async (transaction) => {
      const current = await transaction.accountingPeriod.findUnique({ where: { id: payload.data.periodId } })
      if (!current) throw new Error('PERIOD_NOT_FOUND')
      if (payload.data.action === 'close') {
        if (current.status === 'CLOSED') throw new Error('PERIOD_ALREADY_CLOSED')
        if (current.endDate > day(new Date().toISOString().slice(0, 10))) throw new Error('PERIOD_NOT_ENDED')
        const lines = await transaction.journalLine.findMany({ where: { entry: { is: { periodId: current.id } } }, select: { debit: true, credit: true } })
        const debit = round(lines.reduce((sum, line) => sum + Number(line.debit), 0))
        const credit = round(lines.reduce((sum, line) => sum + Number(line.credit), 0))
        if (Math.abs(debit - credit) > 0.01) throw new Error('PERIOD_UNBALANCED')
        const updated = await transaction.accountingPeriod.update({
          where: { id: current.id },
          data: { status: 'CLOSED', closedAt: new Date(), closedBy: access.session?.userId, closeNote: payload.data.reason },
        })
        await logAudit({ request, action: 'UPDATE', moduleName: 'Contabilidad', entity: 'AccountingPeriod', entityId: current.id, details: `Se cerró el período ${current.code}.`, oldValue: { status: current.status }, newValue: { status: 'CLOSED', reason: payload.data.reason ?? null } }, transaction)
        return updated
      }
      if (current.status !== 'CLOSED') throw new Error('PERIOD_NOT_CLOSED')
      const updated = await transaction.accountingPeriod.update({
        where: { id: current.id },
        data: { status: 'OPEN', closedAt: null, closedBy: null, closeNote: null },
      })
      await logAudit({ request, action: 'UPDATE', moduleName: 'Contabilidad', entity: 'AccountingPeriod', entityId: current.id, details: `Se reabrió el período ${current.code}. Motivo: ${payload.data.reason}.`, oldValue: { status: current.status }, newValue: { status: 'OPEN', reason: payload.data.reason } }, transaction)
      return updated
    }, { isolationLevel: 'Serializable' })
    return NextResponse.json(period)
  } catch (error) {
    const messages: Record<string, string> = {
      PERIOD_NOT_FOUND: 'El período no existe.',
      PERIOD_ALREADY_CLOSED: 'El período ya está cerrado.',
      PERIOD_NOT_CLOSED: 'Solo se pueden reabrir períodos cerrados.',
      PERIOD_UNBALANCED: 'No se puede cerrar el período: los débitos y créditos no coinciden.',
      PERIOD_NOT_ENDED: 'No se puede cerrar un período antes de su fecha de fin.',
    }
    return NextResponse.json({ error: error instanceof Error ? messages[error.message] ?? 'No se pudo actualizar el período.' : 'No se pudo actualizar el período.' }, { status: 400 })
  }
}