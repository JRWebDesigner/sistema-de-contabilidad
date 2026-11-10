import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'

const followUpSchema = z.object({
  customerId: z.string().min(1),
  note: z.string().trim().min(1).max(500),
  dueAt: z.string().datetime(),
})

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['OPEN', 'COMPLETED']),
})

export async function GET(request: Request) {
  const access = await requirePermission(request, 'contacts:read')
  if (access.response) return access.response
  const followUps = await prisma.customerFollowUp.findMany({
    include: { customer: { select: { id: true, name: true, document: true } } },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    take: 200,
  })
  return NextResponse.json(followUps)
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'contacts:write')
  if (access.response) return access.response
  const payload = followUpSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Indica un cliente, una actividad y una fecha de seguimiento válida.' }, { status: 400 })

  try {
    const followUp = await prisma.$transaction(async (transaction) => {
      const customer = await transaction.customer.findFirst({
        where: { id: payload.data.customerId, isActive: true },
        select: { id: true, name: true },
      })
      if (!customer) throw new Error('CUSTOMER_NOT_FOUND')
      const created = await transaction.customerFollowUp.create({
        data: {
          customerId: customer.id,
          note: payload.data.note,
          dueAt: new Date(payload.data.dueAt),
        },
        include: { customer: { select: { id: true, name: true, document: true } } },
      })
      await logAudit({
        request,
        action: 'CREATE',
        moduleName: 'Clientes',
        entity: 'CustomerFollowUp',
        entityId: created.id,
        details: `Se programó un seguimiento comercial para ${customer.name}.`,
      }, transaction)
      return created
    })
    return NextResponse.json(followUp, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'CUSTOMER_NOT_FOUND') {
      return NextResponse.json({ error: 'El cliente no existe o está inactivo.' }, { status: 404 })
    }
    console.error('ERROR_CREATING_CUSTOMER_FOLLOW_UP', error)
    return NextResponse.json({ error: 'No se pudo programar el seguimiento.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const access = await requirePermission(request, 'contacts:write')
  if (access.response) return access.response
  const payload = statusSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'La actualización del seguimiento no es válida.' }, { status: 400 })

  try {
    const updated = await prisma.$transaction(async (transaction) => {
      const current = await transaction.customerFollowUp.findUnique({
        where: { id: payload.data.id },
        include: { customer: { select: { name: true } } },
      })
      if (!current) throw new Error('FOLLOW_UP_NOT_FOUND')
      const followUp = await transaction.customerFollowUp.update({
        where: { id: current.id },
        data: {
          status: payload.data.status,
          completedAt: payload.data.status === 'COMPLETED' ? new Date() : null,
        },
        include: { customer: { select: { id: true, name: true, document: true } } },
      })
      await logAudit({
        request,
        action: 'UPDATE',
        moduleName: 'Clientes',
        entity: 'CustomerFollowUp',
        entityId: followUp.id,
        details: `Se ${followUp.status === 'COMPLETED' ? 'completó' : 'reabrió'} un seguimiento de ${current.customer.name}.`,
      }, transaction)
      return followUp
    })
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof Error && error.message === 'FOLLOW_UP_NOT_FOUND') {
      return NextResponse.json({ error: 'El seguimiento ya no existe.' }, { status: 404 })
    }
    console.error('ERROR_UPDATING_CUSTOMER_FOLLOW_UP', error)
    return NextResponse.json({ error: 'No se pudo actualizar el seguimiento.' }, { status: 500 })
  }
}
