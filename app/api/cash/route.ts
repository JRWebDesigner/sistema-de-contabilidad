import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma, serializableTransaction } from '@/lib/db'
import { requireAdmin, requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { postJournalEntry } from '@/lib/accounting'
import { branchContextError, branchWhere, requireSingleBranch, resolveBranchContext } from '@/lib/branches'

const accountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['CASH', 'BANK', 'POS']),
  initialBalance: z.coerce.number().finite().min(0).default(0),
})

const movementSchema = z.object({
  accountId: z.string().min(1),
  type: z.enum(['IN', 'OUT']),
  amount: z.coerce.number().finite().positive(),
  description: z.string().trim().min(1).max(250),
})
const assignAccountSchema = z.object({
  action: z.literal('assign-branch'),
  accountId: z.string().min(1),
  branchId: z.string().min(1),
})
const depositSchema = z.object({
  action: z.literal('deposit'),
  sourceAccountId: z.string().min(1),
  destinationAccountId: z.string().min(1),
  amount: z.coerce.number().finite().positive(),
  externalReference: z.string().trim().max(100).optional(),
})

function serializeAccount(account: { balance: { toString(): string }; [key: string]: unknown }) {
  return { ...account, balance: account.balance.toString() }
}

export async function GET(request: Request) {
  const access = await requirePermission(request, 'finance:read')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError
  const url = new URL(request.url)
  if (url.searchParams.get('statement') === 'true') {
    const accountId = z.string().min(1).safeParse(url.searchParams.get('accountId'))
    const fromValue = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(url.searchParams.get('from'))
    const toValue = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(url.searchParams.get('to'))
    if (!accountId.success || !fromValue.success || !toValue.success) {
      return NextResponse.json({ error: 'Selecciona la cuenta y un rango de fechas válido.' }, { status: 400 })
    }
    const start = new Date(`${fromValue.data}T00:00:00.000Z`)
    const endExclusive = new Date(`${toValue.data}T00:00:00.000Z`)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(endExclusive.getTime())
      || start.toISOString().slice(0, 10) !== fromValue.data
      || endExclusive.toISOString().slice(0, 10) !== toValue.data
      || fromValue.data > toValue.data) {
      return NextResponse.json({ error: 'El rango de fechas no es válido.' }, { status: 400 })
    }
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
    const account = await prisma.cashAccount.findFirst({
      where: { id: accountId.data, isActive: true, ...branchWhere(branchContext) },
      select: { id: true, name: true, type: true, balance: true },
    })
    if (!account) return NextResponse.json({ error: 'La cuenta no existe o no está disponible en esta sucursal.' }, { status: 404 })

    const movementWhere = { accountId: account.id, createdAt: { gte: start } }
    const [laterMovementTotals, movements] = await Promise.all([
      prisma.cashMovement.groupBy({
        by: ['type'],
        where: movementWhere,
        _sum: { amount: true },
      }),
      prisma.cashMovement.findMany({
        where: { accountId: account.id, createdAt: { gte: start, lt: endExclusive } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, type: true, amount: true, description: true, reference: true, createdAt: true },
      }),
    ])
    const laterIn = Number(laterMovementTotals.find((item) => item.type === 'IN')?._sum.amount ?? 0)
    const laterOut = Number(laterMovementTotals.find((item) => item.type === 'OUT')?._sum.amount ?? 0)
    let runningBalance = Math.round((Number(account.balance) - laterIn + laterOut + Number.EPSILON) * 100) / 100
    const openingBalance = runningBalance
    const data = movements.map((movement) => {
      const amount = Number(movement.amount)
      runningBalance = Math.round((runningBalance + (movement.type === 'IN' ? amount : -amount) + Number.EPSILON) * 100) / 100
      return { ...movement, amount: movement.amount.toString(), balance: runningBalance }
    })
    return NextResponse.json({
      account: { ...account, balance: account.balance.toString() },
      from: fromValue.data,
      to: toValue.data,
      openingBalance,
      closingBalance: runningBalance,
      movements: data,
    })
  }
  const includeAllMovements = new URL(request.url).searchParams.get('history') === 'all'
  const accounts = await prisma.cashAccount.findMany({
    where: { isActive: true, ...branchWhere(branchContext) },
    include: {
      custodian: { select: { alias: true } },
      movements: { orderBy: { createdAt: 'desc' }, ...(includeAllMovements ? {} : { take: 10 }) },
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(accounts.map((account) => ({
    ...serializeAccount(account),
    canDeposit: account.custodianId === access.session.userId,
    movements: account.movements.map((movement) => ({ ...movement, amount: movement.amount.toString() })),
  })))
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'finance:write')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!
  const body = await request.json()
  const depositPayload = depositSchema.safeParse(body)

  if (depositPayload.success) {
    if (depositPayload.data.sourceAccountId === depositPayload.data.destinationAccountId) {
      return NextResponse.json({ error: 'Selecciona cuentas distintas para el depósito.' }, { status: 400 })
    }

    try {
      const deposit = await serializableTransaction(async (transaction) => {
        const source = await transaction.cashAccount.findFirst({
          where: {
            id: depositPayload.data.sourceAccountId,
            isActive: true,
            branchId,
            type: 'CASH',
            custodianId: access.session.userId,
          },
          select: { id: true, name: true, balance: true },
        })
        if (!source) throw new Error('CUSTODY_ACCOUNT_NOT_FOUND')

        const destination = await transaction.cashAccount.findFirst({
          where: {
            id: depositPayload.data.destinationAccountId,
            isActive: true,
            branchId,
            type: 'BANK',
            custodianId: null,
          },
          select: { id: true, name: true },
        })
        if (!destination) throw new Error('BANK_ACCOUNT_NOT_FOUND')

        const debited = await transaction.cashAccount.updateMany({
          where: { id: source.id, balance: { gte: depositPayload.data.amount } },
          data: { balance: { decrement: depositPayload.data.amount } },
        })
        if (debited.count !== 1) throw new Error('INSUFFICIENT_CUSTODY_BALANCE')

        await transaction.cashAccount.update({
          where: { id: destination.id },
          data: { balance: { increment: depositPayload.data.amount } },
        })

        const reference = `DEP-${randomUUID().slice(0, 8).toUpperCase()}`
        const description = `Depósito de efectivo de ${source.name} a ${destination.name}`
        const createdAt = new Date()
        const outMovement = await transaction.cashMovement.create({
          data: {
            type: 'OUT',
            amount: depositPayload.data.amount,
            description,
            reference: depositPayload.data.externalReference || reference,
            accountId: source.id,
            createdAt,
          },
        })
        const inMovement = await transaction.cashMovement.create({
          data: {
            type: 'IN',
            amount: depositPayload.data.amount,
            description,
            reference: depositPayload.data.externalReference || reference,
            accountId: destination.id,
            createdAt,
          },
        })

        await postJournalEntry(transaction, {
          date: createdAt,
          description,
          sourceType: 'CASH_CUSTODY_DEPOSIT',
          sourceId: reference,
          branchId,
          lines: [
            { accountCode: '1000', debit: depositPayload.data.amount, description: destination.name },
            { accountCode: '1000', credit: depositPayload.data.amount, description: source.name },
          ],
        })

        await logAudit({
          request,
          action: 'TRANSFER',
          moduleName: 'Caja y bancos',
          entity: 'CashCustodyDeposit',
          entityId: reference,
          details: `${description} por ${depositPayload.data.amount.toFixed(2)} Bs.`,
          newValue: {
            sourceAccountId: source.id,
            destinationAccountId: destination.id,
            amount: depositPayload.data.amount,
            externalReference: depositPayload.data.externalReference,
            movementIds: [outMovement.id, inMovement.id],
          },
        }, transaction)

        return { reference, amount: depositPayload.data.amount }
      })

      return NextResponse.json(deposit, { status: 201 })
    } catch (error) {
      console.error('ERROR_REGISTERING_CASH_CUSTODY_DEPOSIT', error)
      const message = error instanceof Error && error.message === 'CUSTODY_ACCOUNT_NOT_FOUND'
        ? 'No tienes una cuenta de efectivo en custodia disponible.'
        : error instanceof Error && error.message === 'BANK_ACCOUNT_NOT_FOUND'
          ? 'Selecciona una cuenta bancaria activa de esta sucursal.'
          : error instanceof Error && error.message === 'INSUFFICIENT_CUSTODY_BALANCE'
            ? 'El depósito supera el efectivo disponible bajo tu custodia.'
            : 'No se pudo registrar el depósito.'
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  const accountPayload = accountSchema.safeParse(body)

  if (accountPayload.success) {
    try {
      const account = await prisma.$transaction(async (transaction) => {
        const created = await transaction.cashAccount.create({
          data: {
            name: accountPayload.data.name,
            type: accountPayload.data.type,
            balance: accountPayload.data.initialBalance,
            branchId,
          },
        })
        if (accountPayload.data.initialBalance > 0) {
          await transaction.cashMovement.create({
            data: {
              type: 'IN',
              amount: accountPayload.data.initialBalance,
              description: 'Saldo inicial',
              reference: 'SALDO-INICIAL',
              accountId: created.id,
            },
          })
          await postJournalEntry(transaction, {
            date: created.createdAt,
            description: `Saldo inicial de ${created.name}`,
            sourceType: 'CASH_ACCOUNT_OPENING',
            sourceId: created.id,
            branchId,
            lines: [
              { accountCode: '1000', debit: accountPayload.data.initialBalance },
              { accountCode: '3000', credit: accountPayload.data.initialBalance },
            ],
          })
        }
        await logAudit({
          request,
          action: 'CREATE',
          moduleName: 'Caja y bancos',
          entity: 'CashAccount',
          entityId: created.id,
          details: `Se creó la cuenta ${created.name} con saldo inicial de ${accountPayload.data.initialBalance.toFixed(2)} Bs.`,
          newValue: { name: created.name, type: created.type, balance: accountPayload.data.initialBalance },
        }, transaction)
        return created
      })
      return NextResponse.json(serializeAccount(account), { status: 201 })
    } catch {
      return NextResponse.json({ error: 'No se pudo crear la cuenta.' }, { status: 400 })
    }
  }

  const movementPayload = movementSchema.safeParse(body)
  if (!movementPayload.success) {
    return NextResponse.json({ error: 'Revisa los datos de la cuenta o movimiento.' }, { status: 400 })
  }

  try {
    const account = await serializableTransaction(async (transaction) => {
      const current = await transaction.cashAccount.findFirst({ where: { id: movementPayload.data.accountId, isActive: true, branchId, custodianId: null } })
      if (!current) throw new Error('ACCOUNT_NOT_FOUND')
      const signedAmount = movementPayload.data.type === 'IN' ? movementPayload.data.amount : -movementPayload.data.amount
      if (signedAmount < 0) {
        const updated = await transaction.cashAccount.updateMany({
          where: { id: current.id, isActive: true, balance: { gte: movementPayload.data.amount } },
          data: { balance: { decrement: movementPayload.data.amount } },
        })
        if (updated.count !== 1) throw new Error('INSUFFICIENT_BALANCE')
      } else {
        await transaction.cashAccount.update({ where: { id: current.id }, data: { balance: { increment: signedAmount } } })
      }
      const cashMovement = await transaction.cashMovement.create({
        data: {
          type: movementPayload.data.type,
          amount: movementPayload.data.amount,
          description: movementPayload.data.description,
          reference: 'AJUSTE-CAJA',
          accountId: current.id,
        },
      })
      await postJournalEntry(transaction, {
        date: cashMovement.createdAt,
        description: movementPayload.data.description,
        sourceType: 'CASH_MOVEMENT',
        sourceId: cashMovement.id,
        branchId,
        lines: movementPayload.data.type === 'IN'
          ? [
              { accountCode: '1000', debit: movementPayload.data.amount },
              { accountCode: '4900', credit: movementPayload.data.amount },
            ]
          : [
              { accountCode: '6000', debit: movementPayload.data.amount },
              { accountCode: '1000', credit: movementPayload.data.amount },
            ],
      })
      await logAudit({
        request,
        action: 'CREATE',
        moduleName: 'Caja y bancos',
        entity: 'CashMovement',
        entityId: cashMovement.id,
        details: `Se registró un ${movementPayload.data.type === 'IN' ? 'ingreso' : 'egreso'} de ${movementPayload.data.amount.toFixed(2)} Bs en ${current.name}: ${movementPayload.data.description}.`,
        oldValue: { balance: Number(current.balance) },
        newValue: { type: cashMovement.type, amount: Number(cashMovement.amount), balance: Number(current.balance) + signedAmount },
      }, transaction)
      return transaction.cashAccount.findUniqueOrThrow({ where: { id: current.id } })
    })
    return NextResponse.json(serializeAccount(account), { status: 201 })
  } catch (error) {
    const message = error instanceof Error && error.message === 'INSUFFICIENT_BALANCE'
      ? 'El retiro supera el saldo disponible.'
      : error instanceof Error && error.message === 'ACCOUNT_NOT_FOUND'
        ? 'La cuenta no existe o está inactiva.'
        : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_CLOSED'
          ? 'El período contable de esta fecha está cerrado.'
          : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_NOT_STARTED'
            ? 'La fecha de operación es anterior al inicio del libro mayor.'
        : 'No se pudo registrar el movimiento.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  const access = await requireAdmin(request)
  if (access.response) return access.response
  const payload = assignAccountSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Selecciona una cuenta y una sucursal válidas.' }, { status: 400 })

  const branch = await prisma.branch.findFirst({
    where: { id: payload.data.branchId, isActive: true },
    select: { id: true, name: true },
  })
  if (!branch) return NextResponse.json({ error: 'La sucursal no existe o está inactiva.' }, { status: 404 })

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const account = await transaction.cashAccount.findFirst({
        where: { id: payload.data.accountId, branchId: null },
        select: { id: true, name: true },
      })
      if (!account) throw new Error('ACCOUNT_ALREADY_ASSIGNED')
      const updated = await transaction.cashAccount.update({
        where: { id: account.id },
        data: { branchId: branch.id },
      })
      await logAudit({
        request,
        userId: access.session.userId,
        action: 'UPDATE',
        moduleName: 'Caja y bancos',
        entity: 'CashAccount',
        entityId: account.id,
        details: `Se asignó la cuenta ${account.name} a la sucursal ${branch.name}.`,
        oldValue: { branchId: null },
        newValue: { branchId: branch.id },
      }, transaction)
      return updated
    })
    return NextResponse.json(serializeAccount(result))
  } catch (error) {
    if (error instanceof Error && error.message === 'ACCOUNT_ALREADY_ASSIGNED') {
      return NextResponse.json({ error: 'La cuenta no existe o ya está asignada a una sucursal.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'No se pudo asignar la cuenta.' }, { status: 500 })
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
    return NextResponse.json({ error: 'Falta el identificador de la cuenta.' }, { status: 400 })
  }

  try {
    const account = await prisma.cashAccount.findFirst({ where: { id, branchId }, select: { id: true, name: true, isActive: true, custodianId: true } })
    if (!account) return NextResponse.json({ error: 'La cuenta no existe.' }, { status: 404 })
    if (account.custodianId) {
      return NextResponse.json({ error: 'Las cuentas de efectivo en custodia no se pueden eliminar.' }, { status: 409 })
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.cashAccount.update({ where: { id }, data: { isActive: false } })
      await logAudit({
        request,
        action: 'DELETE',
        moduleName: 'Caja y bancos',
        entity: 'CashAccount',
        entityId: id,
        details: `Se desactivó la cuenta ${account.name}.`,
        oldValue: { isActive: account.isActive },
        newValue: { isActive: false },
      }, transaction)
    })
    return NextResponse.json({ ok: true, id, name: account.name })
  } catch {
    return NextResponse.json({ error: 'No se pudo eliminar la cuenta.' }, { status: 400 })
  }
}
