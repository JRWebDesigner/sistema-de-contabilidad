import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'

const customerSchema = z.object({
  type: z.enum(['PERSON', 'COMPANY']),
  nit: z.string().trim().max(30).optional(),
  documentNumber: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(180),
  alias: z.string().trim().max(120).optional(),
  observation: z.string().trim().max(500).optional(),
  email: z.union([z.string().email().max(180), z.literal('')]).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(250).optional(),
  billingData: z.record(z.string(), z.string()).optional(),
  branches: z.array(z.string().trim().min(1)).optional(),
  legalRepresentatives: z.array(z.string().trim().min(1)).optional(),
  communicationPhones: z.array(z.string().trim().min(1)).optional(),
  communicationEmails: z.array(z.string().trim().min(1)).optional(),
  socialNetworks: z.array(z.string().trim().min(1)).optional(),
  contacts: z.array(z.string().trim().min(1)).optional(),
  credit: z.boolean().default(false),
  paymentDays: z.number().int().min(0).max(365).optional(),
  creditLimit: z.number().finite().positive().nullable().optional(),
  priceListId: z.string().min(1).nullable().optional(),
  firstSale: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accountingReference: z.string().trim().max(120).optional(),
  addresses: z.array(z.union([
    z.string().trim().min(1),
    z.object({
      label: z.string().trim().max(250),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }),
  ])).optional(),
  attachments: z.array(z.string().trim().min(1)).optional(),
}).refine((customer) => !customer.credit || (customer.creditLimit != null && customer.creditLimit > 0), {
  message: 'Define un límite de crédito mayor a cero para habilitar crédito.',
  path: ['creditLimit'],
})

export async function GET(request: Request) {
  const access = await requirePermission(request, 'contacts:read')
  if (access.response) return access.response
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  const customers = await prisma.customer.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { document: { contains: query, mode: 'insensitive' } },
          ],
        }
      : undefined,
    include: { priceList: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(customers)
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'contacts:write')
  if (access.response) return access.response
  const payload = customerSchema.safeParse(await request.json())

  if (!payload.success) {
    const fields = payload.error.issues
      .map((issue) => `${issue.path.join('.') || 'formulario'}: ${issue.message}`)
      .join(' | ')
    return NextResponse.json({ error: `Revisa los datos del cliente. ${fields}` }, { status: 400 })
  }

  try {
    const customer = await prisma.$transaction(async (transaction) => {
      if (payload.data.branches?.length) {
        const branches = await transaction.customer.findMany({
          where: { id: { in: payload.data.branches } },
          select: { id: true },
        })
        if (branches.length !== new Set(payload.data.branches).size) throw new Error('BRANCH_NOT_FOUND')
      }
      if (payload.data.priceListId) {
        const priceList = await transaction.priceList.findFirst({
          where: { id: payload.data.priceListId, isActive: true },
          select: { id: true },
        })
        if (!priceList) throw new Error('PRICE_LIST_NOT_FOUND')
      }

      const firstAddress = payload.data.addresses?.[0]
      const legacyAddress = payload.data.address || (typeof firstAddress === 'string' ? firstAddress : firstAddress?.label)
      const created = await transaction.customer.create({
        data: {
          ...payload.data,
          document: payload.data.nit || payload.data.documentNumber,
          documentNumber: payload.data.documentNumber,
          email: payload.data.email || payload.data.communicationEmails?.[0] || null,
          phone: payload.data.phone || payload.data.communicationPhones?.[0] || null,
          address: legacyAddress || null,
          firstSale: payload.data.firstSale ? new Date(`${payload.data.firstSale}T00:00:00.000Z`) : null,
        },
      })
      await logAudit({
        request,
        action: 'CREATE',
        moduleName: 'Clientes',
        entity: 'Customer',
        entityId: created.id,
        details: `Se agregó el cliente ${created.name} (${created.document}).`,
      }, transaction)
      return created
    })
    return NextResponse.json(customer, { status: 201 })
  } catch (error) {
    console.error('No se pudo guardar el cliente:', error)
    const message = error instanceof Error && error.message === 'BRANCH_NOT_FOUND'
      ? 'Una o más filiales seleccionadas no existen.'
      : error instanceof Error && error.message === 'PRICE_LIST_NOT_FOUND'
        ? 'La lista de precios seleccionada no existe o está inactiva.'
      : error instanceof Error && error.message.includes('Unique constraint')
      ? 'El documento ya está registrado.'
      : 'No se pudo guardar el cliente.'

    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  const access = await requirePermission(request, 'contacts:write')
  if (access.response) return access.response
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta el identificador del cliente.' }, { status: 400 })

  const payload = customerSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Revisa los datos del cliente.' }, { status: 400 })

  try {
    const customer = await prisma.$transaction(async (transaction) => {
      const current = await transaction.customer.findUnique({ where: { id } })
      if (!current) throw new Error('CUSTOMER_NOT_FOUND')
      if (payload.data.branches?.length) {
        const branches = await transaction.customer.findMany({ where: { id: { in: payload.data.branches } }, select: { id: true } })
        if (branches.length !== new Set(payload.data.branches).size) throw new Error('BRANCH_NOT_FOUND')
      }
      if (payload.data.priceListId && payload.data.priceListId !== current.priceListId) {
        const priceList = await transaction.priceList.findFirst({
          where: { id: payload.data.priceListId, isActive: true },
          select: { id: true },
        })
        if (!priceList) throw new Error('PRICE_LIST_NOT_FOUND')
      }

      const firstAddress = payload.data.addresses?.[0]
      const legacyAddress = payload.data.address || (typeof firstAddress === 'string' ? firstAddress : firstAddress?.label)
      const updated = await transaction.customer.update({
        where: { id },
        data: {
          ...payload.data,
          document: payload.data.nit || payload.data.documentNumber,
          documentNumber: payload.data.documentNumber,
          email: payload.data.email || payload.data.communicationEmails?.[0] || null,
          phone: payload.data.phone || payload.data.communicationPhones?.[0] || null,
          address: legacyAddress || null,
          firstSale: payload.data.firstSale ? new Date(`${payload.data.firstSale}T00:00:00.000Z`) : null,
        },
      })
      await logAudit({
        request,
        action: 'UPDATE',
        moduleName: 'Clientes',
        entity: 'Customer',
        entityId: updated.id,
        details: `Se actualizó el cliente ${current.name} (${current.document}) a ${updated.name} (${updated.document}).`,
      }, transaction)
      return updated
    })
    return NextResponse.json(customer)
  } catch (error) {
    const message = error instanceof Error && error.message === 'CUSTOMER_NOT_FOUND'
      ? 'El cliente no existe.'
      : error instanceof Error && error.message === 'BRANCH_NOT_FOUND'
        ? 'Una o más filiales seleccionadas no existen.'
        : error instanceof Error && error.message === 'PRICE_LIST_NOT_FOUND'
          ? 'La lista de precios seleccionada no existe o está inactiva.'
        : error instanceof Error && error.message.includes('Unique constraint')
          ? 'El documento ya está registrado.'
          : 'No se pudo actualizar el cliente.'
    return NextResponse.json({ error: message }, { status: message === 'El cliente no existe.' ? 404 : 400 })
  }
}
