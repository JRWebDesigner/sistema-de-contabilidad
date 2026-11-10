import { randomUUID } from 'node:crypto'

import { Prisma } from '@/lib/generated/prisma/client'

const systemAccounts = [
  { code: '1000', name: 'Caja y bancos', type: 'ASSET' },
  { code: '1200', name: 'Cuentas por cobrar', type: 'ASSET' },
  { code: '1300', name: 'Inventario', type: 'ASSET' },
  { code: '2100', name: 'Cuentas por pagar', type: 'LIABILITY' },
  { code: '3000', name: 'Capital y saldos iniciales', type: 'EQUITY' },
  { code: '4000', name: 'Ventas', type: 'INCOME' },
  { code: '4100', name: 'Devoluciones y descuentos sobre ventas', type: 'EXPENSE' },
  { code: '4900', name: 'Otros ingresos', type: 'INCOME' },
  { code: '5000', name: 'Costo de ventas', type: 'EXPENSE' },
  { code: '5100', name: 'Ajustes y mermas de inventario', type: 'EXPENSE' },
  { code: '6000', name: 'Gastos generales', type: 'EXPENSE' },
] as const

export type JournalLineInput = {
  accountCode: string
  debit?: number
  credit?: number
  description?: string
}

export async function ensureSystemAccounts(transaction: Prisma.TransactionClient) {
  for (const account of systemAccounts) {
    await transaction.ledgerAccount.upsert({
      where: { code: account.code },
      create: { ...account, isSystem: true },
      update: {},
    })
  }
}

export async function postJournalEntry(
  transaction: Prisma.TransactionClient,
  input: {
    date: Date
    description: string
    sourceType?: string
    sourceId?: string
    branchId?: string | null
    isReversal?: boolean
    lines: JournalLineInput[]
  },
) {
  if ((input.sourceType && !input.sourceId) || (!input.sourceType && input.sourceId)) {
    throw new Error('JOURNAL_SOURCE_INVALID')
  }

  if (input.sourceType && input.sourceId) {
    const existing = await transaction.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } },
      select: { id: true, number: true },
    })
    if (existing) return existing
  }

  const lines = input.lines.map((line) => ({
    ...line,
    debit: roundMoney(line.debit ?? 0),
    credit: roundMoney(line.credit ?? 0),
  })).filter((line) => line.debit > 0 || line.credit > 0)
  const debitTotal = roundMoney(lines.reduce((sum, line) => sum + line.debit, 0))
  const creditTotal = roundMoney(lines.reduce((sum, line) => sum + line.credit, 0))
  if (lines.length < 2 || lines.some((line) => (line.debit > 0) === (line.credit > 0)) || debitTotal !== creditTotal) {
    throw new Error('JOURNAL_NOT_BALANCED')
  }

  await ensureSystemAccounts(transaction)
  const entryDate = utcDay(input.date)
  const cutover = await transaction.journalEntry.findFirst({
    where: { sourceType: 'OPENING_BALANCE' },
    orderBy: { entryDate: 'asc' },
    select: { entryDate: true },
  })
  if (cutover && entryDate < utcDay(cutover.entryDate)) throw new Error('ACCOUNTING_PERIOD_NOT_STARTED')
  const periodCode = `${entryDate.getUTCFullYear()}-${String(entryDate.getUTCMonth() + 1).padStart(2, '0')}`
  const startDate = new Date(Date.UTC(entryDate.getUTCFullYear(), entryDate.getUTCMonth(), 1))
  const endDate = new Date(Date.UTC(entryDate.getUTCFullYear(), entryDate.getUTCMonth() + 1, 0))
  const period = await transaction.accountingPeriod.upsert({
    where: { code: periodCode },
    create: { code: periodCode, startDate, endDate },
    update: {},
  })
  if (period.status === 'CLOSED') throw new Error('ACCOUNTING_PERIOD_CLOSED')

  return transaction.journalEntry.create({
    data: {
      number: `AS-${periodCode.replace('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`,
      entryDate,
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      branchId: input.branchId,
      isReversal: input.isReversal ?? false,
      periodId: period.id,
      lines: {
        create: lines.map((line) => ({
          account: { connect: { code: line.accountCode } },
          debit: line.debit,
          credit: line.credit,
          description: line.description,
        })),
      },
    },
    select: { id: true, number: true },
  })
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function utcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}