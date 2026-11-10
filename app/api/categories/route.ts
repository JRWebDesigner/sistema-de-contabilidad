import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { requireAdmin, requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'

const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
})

export async function GET(request: Request) {
  const access = await requirePermission(request, 'inventory:read')
  if (access.response) return access.response
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    include: { _count: { select: { products: { where: { isActive: true } } } } },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(categories)
}

export async function PATCH(request: Request) {
  const access = await requireAdmin(request)
  if (access.response) return access.response

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta el identificador de la categoría.' }, { status: 400 })
  const payload = categorySchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'El nombre de la categoría es obligatorio.' }, { status: 400 })

  try {
    const current = await prisma.category.findFirst({ where: { id, isActive: true } })
    if (!current) return NextResponse.json({ error: 'La categoría no existe.' }, { status: 404 })
    const category = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.category.update({ where: { id }, data: { name: payload.data.name } })
      await logAudit({
        request,
        action: 'UPDATE',
        moduleName: 'Categorías',
        entity: 'Category',
        entityId: id,
        details: `Se renombró la categoría ${current.name} a ${updated.name}.`,
        oldValue: { name: current.name },
        newValue: { name: updated.name },
      }, transaction)
      return updated
    })
    return NextResponse.json(category)
  } catch (error) {
    const message = error instanceof Error && error.message.includes('Unique constraint')
      ? 'La categoría ya existe.'
      : error instanceof Error && error.message.includes('Record to update not found')
        ? 'La categoría no existe.'
        : 'No se pudo actualizar la categoría.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'inventory:write')
  if (access.response) return access.response
  const payload = categorySchema.safeParse(await request.json())

  if (!payload.success) {
    return NextResponse.json({ error: 'El nombre de la categoría es obligatorio.' }, { status: 400 })
  }

  try {
    const category = await prisma.$transaction(async (transaction) => {
      const created = await transaction.category.create({ data: payload.data })
      await logAudit({ request, action: 'CREATE', moduleName: 'Categorías', entity: 'Category', entityId: created.id, details: `Se creó la categoría ${created.name}.`, newValue: { name: created.name } }, transaction)
      return created
    })
    return NextResponse.json(category, { status: 201 })
  } catch (error) {
    const message = error instanceof Error && error.message.includes('Unique constraint')
      ? 'La categoría ya existe.'
      : 'No se pudo guardar la categoría.'

    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  const access = await requireAdmin(request)
  if (access.response) return access.response

  const url = new URL(request.url)
  const id = url.searchParams.get('id') ?? (await request.clone().json().catch(() => ({}))).id

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Falta el identificador de la categoría.' }, { status: 400 })
  }

  try {
    const category = await prisma.category.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } })
    if (!category) return NextResponse.json({ error: 'La categoría no existe.' }, { status: 404 })

    await prisma.$transaction(async (transaction) => {
      await transaction.category.update({ where: { id }, data: { isActive: false } })
      await logAudit({ request, action: 'DELETE', moduleName: 'Categorías', entity: 'Category', entityId: id, details: `Se desactivó la categoría ${category.name}.`, oldValue: { isActive: category.isActive }, newValue: { isActive: false } }, transaction)
    })
    return NextResponse.json({ ok: true, id, name: category.name })
  } catch {
    return NextResponse.json({ error: 'No se pudo eliminar la categoría.' }, { status: 400 })
  }
}
