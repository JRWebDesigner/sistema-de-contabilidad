import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { requireAdmin, requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'

const supplierSchema = z.object({
  document: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(180),
  email: z.union([z.string().email().max(180), z.literal('')]).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(250).optional(),
  contactName: z.string().trim().max(180).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  city: z.string().trim().max(100).optional(),
  paymentTerms: z.string().trim().max(250).optional(),
  estimatedDeliveryDays: z.preprocess(
    (value) => value === '' || value === null || value === undefined ? null : Number(value),
    z.number().int().min(0).max(3650).nullable(),
  ),
  observations: z.string().trim().max(500).optional(),
})

export async function GET(request: Request) {
  const access = await requirePermission(request, 'contacts:read')
  if (access.response) return access.response
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  const suppliers = await prisma.supplier.findMany({
    where: {
      isActive: true,
      ...(query ? { OR: [{ name: { contains: query, mode: 'insensitive' } }, { document: { contains: query, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(suppliers)
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'contacts:write')
  if (access.response) return access.response
  const payload = supplierSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Revisa los datos del proveedor.' }, { status: 400 })
  try {
    const supplier = await prisma.$transaction(async (transaction) => {
      const created = await transaction.supplier.create({ data: payload.data })
      await logAudit({ request, action: 'CREATE', moduleName: 'Proveedores', entity: 'Supplier', entityId: created.id, details: `Se registró el proveedor ${created.name} (${created.document}).` }, transaction)
      return created
    })
    return NextResponse.json(supplier, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message.includes('Unique constraint') ? 'El NIT ya está registrado.' : 'No se pudo guardar el proveedor.' }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  const access = await requirePermission(request, 'contacts:write')
  if (access.response) return access.response
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta el identificador del proveedor.' }, { status: 400 })
  const payload = supplierSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Revisa los datos del proveedor.' }, { status: 400 })

  try {
    const supplier = await prisma.$transaction(async (transaction) => {
      const current = await transaction.supplier.findUnique({ where: { id } })
      if (!current) throw new Error('SUPPLIER_NOT_FOUND')
      const updated = await transaction.supplier.update({ where: { id }, data: payload.data })
      await logAudit({ request, action: 'UPDATE', moduleName: 'Proveedores', entity: 'Supplier', entityId: updated.id, details: `Se actualizó el proveedor ${current.name} (${current.document}) a ${updated.name} (${updated.document}).` }, transaction)
      return updated
    })
    return NextResponse.json(supplier)
  } catch (error) {
    const message = error instanceof Error && error.message === 'SUPPLIER_NOT_FOUND'
      ? 'El proveedor no existe.'
      : error instanceof Error && error.message.includes('Unique constraint')
        ? 'El NIT ya está registrado.'
        : 'No se pudo actualizar el proveedor.'
    return NextResponse.json({ error: message }, { status: message === 'El proveedor no existe.' ? 404 : 400 })
  }
}

export async function DELETE(request: Request) {
  const access = await requireAdmin(request)
  if (access.response) return access.response

  const url = new URL(request.url)
  const id = url.searchParams.get('id') ?? (await request.clone().json().catch(() => ({}))).id

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Falta el identificador del proveedor.' }, { status: 400 })
  }

  try {
    const supplier = await prisma.supplier.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } })
    if (!supplier) return NextResponse.json({ error: 'El proveedor no existe.' }, { status: 404 })

    await prisma.$transaction(async (transaction) => {
      await transaction.supplier.update({ where: { id }, data: { isActive: false } })
      await logAudit({ request, action: 'DELETE', moduleName: 'Proveedores', entity: 'Supplier', entityId: id, details: `Se desactivó el proveedor ${supplier.name}.` }, transaction)
    })
    return NextResponse.json({ ok: true, id, name: supplier.name })
  } catch {
    return NextResponse.json({ error: 'No se pudo eliminar el proveedor.' }, { status: 400 })
  }
}
