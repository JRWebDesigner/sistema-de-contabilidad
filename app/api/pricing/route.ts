import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@/lib/generated/prisma/client'

import { prisma } from '@/lib/db'
import { requireAnyPermission, requirePermission, rolePermissions } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'

const priceListSchema = z.object({
  kind: z.literal('price-list'),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    unitPrice: z.coerce.number().finite().positive().max(9_999_999_999.99),
  })).min(1),
})

const promotionSchema = z.object({
  kind: z.literal('promotion'),
  name: z.string().trim().min(1).max(120),
  discountPercent: z.coerce.number().finite().gt(0).max(100),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  productIds: z.array(z.string().min(1)).default([]),
}).refine((promotion) => new Date(promotion.endsAt) >= new Date(promotion.startsAt), {
  message: 'La fecha de fin debe ser posterior a la de inicio.',
  path: ['endsAt'],
})

const statusSchema = z.object({
  kind: z.enum(['price-list', 'promotion']),
  id: z.string().min(1),
  isActive: z.boolean(),
})

export async function PUT(request: Request) {
  const access = await requirePermission(request, 'sales:manage-pricing')
  if (access.response) return access.response
  const body: unknown = await request.json()
  const kind = body && typeof body === 'object' && 'kind' in body ? body.kind : undefined

  if (kind === 'price-list') {
    const payload = priceListSchema.extend({ id: z.string().min(1) }).safeParse(body)
    if (!payload.success) return NextResponse.json({ error: 'Revisa los datos de la lista de precios.' }, { status: 400 })
    if (new Set(payload.data.items.map((item) => item.productId)).size !== payload.data.items.length) {
      return NextResponse.json({ error: 'No repitas productos en una lista de precios.' }, { status: 400 })
    }
    try {
      const updated = await prisma.$transaction(async (transaction) => {
        const products = await transaction.product.findMany({
          where: { id: { in: payload.data.items.map((item) => item.productId) } },
          select: { id: true },
        })
        if (products.length !== payload.data.items.length) throw new Error('PRODUCT_NOT_FOUND')
        const priceList = await transaction.priceList.update({
          where: { id: payload.data.id },
          data: {
            name: payload.data.name,
            description: payload.data.description || null,
            items: { deleteMany: {}, create: payload.data.items },
          },
          include: { items: { include: { product: { select: { id: true, name: true, sku: true } } } } },
        })
        await logAudit({
          request,
          action: 'UPDATE',
          moduleName: 'Ventas',
          entity: 'PriceList',
          entityId: priceList.id,
          details: `Se actualizó la lista de precios ${priceList.name}.`,
        }, transaction)
        return priceList
      })
      return NextResponse.json(updated)
    } catch (error) {
      return pricingWriteError(error)
    }
  }

  if (kind === 'promotion') {
    const payload = promotionSchema.extend({ id: z.string().min(1) }).safeParse(body)
    if (!payload.success) return NextResponse.json({ error: 'Revisa los datos de la promoción.' }, { status: 400 })
    if (new Set(payload.data.productIds).size !== payload.data.productIds.length) {
      return NextResponse.json({ error: 'No repitas productos en una promoción.' }, { status: 400 })
    }
    try {
      const updated = await prisma.$transaction(async (transaction) => {
        if (payload.data.productIds.length) {
          const products = await transaction.product.findMany({
            where: { id: { in: payload.data.productIds }, isActive: true },
            select: { id: true },
          })
          if (products.length !== payload.data.productIds.length) throw new Error('PRODUCT_NOT_FOUND')
        }
        const promotion = await transaction.promotion.update({
          where: { id: payload.data.id },
          data: {
            name: payload.data.name,
            discountPercent: payload.data.discountPercent,
            startsAt: new Date(payload.data.startsAt),
            endsAt: new Date(payload.data.endsAt),
            products: {
              deleteMany: {},
              create: payload.data.productIds.map((productId) => ({ productId })),
            },
          },
          include: { products: { include: { product: { select: { id: true, name: true, sku: true } } } } },
        })
        await logAudit({
          request,
          action: 'UPDATE',
          moduleName: 'Ventas',
          entity: 'Promotion',
          entityId: promotion.id,
          details: `Se actualizó la promoción ${promotion.name}.`,
        }, transaction)
        return promotion
      })
      return NextResponse.json(updated)
    } catch (error) {
      return pricingWriteError(error)
    }
  }

  return NextResponse.json({ error: 'Tipo de configuración no válido.' }, { status: 400 })
}

function pricingWriteError(error: unknown) {
  if (error instanceof Error && error.message === 'PRODUCT_NOT_FOUND') {
    return NextResponse.json({ error: 'Uno o más productos no existen o están inactivos.' }, { status: 400 })
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    return NextResponse.json({ error: 'No se encontró la configuración.' }, { status: 404 })
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return NextResponse.json({ error: 'Ya existe una lista con ese nombre.' }, { status: 409 })
  }
  console.error('ERROR_WRITING_SALES_PRICING', error)
  return NextResponse.json({ error: 'No se pudo guardar la configuración.' }, { status: 500 })
}

export async function GET(request: Request) {
  const access = await requireAnyPermission(request, ['sales:read', 'contacts:read'])
  if (access.response) return access.response
  const canManage = access.session?.role
    ? rolePermissions(access.session.role).includes('sales:manage-pricing')
    : false
  const where = canManage ? undefined : { isActive: true }
  const [priceLists, promotions] = await Promise.all([
    prisma.priceList.findMany({
      where,
      include: {
        _count: { select: { customers: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.promotion.findMany({
      where,
      include: { products: { include: { product: { select: { id: true, name: true, sku: true } } } } },
      orderBy: { startsAt: 'desc' },
    }),
  ])

  return NextResponse.json({
    priceLists: priceLists.map((list) => ({
      ...list,
      items: list.items.map((item) => ({ ...item, unitPrice: item.unitPrice.toString() })),
    })),
    promotions: promotions.map((promotion) => ({
      ...promotion,
      discountPercent: promotion.discountPercent.toString(),
    })),
  })
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'sales:manage-pricing')
  if (access.response) return access.response
  const body: unknown = await request.json()
  const kind = body && typeof body === 'object' && 'kind' in body ? body.kind : undefined

  if (kind === 'price-list') {
    const payload = priceListSchema.safeParse(body)
    if (!payload.success) return NextResponse.json({ error: 'Revisa los datos de la lista de precios.' }, { status: 400 })
    if (new Set(payload.data.items.map((item) => item.productId)).size !== payload.data.items.length) {
      return NextResponse.json({ error: 'No repitas productos en una lista de precios.' }, { status: 400 })
    }

    try {
      const created = await prisma.$transaction(async (transaction) => {
        const products = await transaction.product.findMany({
          where: { id: { in: payload.data.items.map((item) => item.productId) } },
          select: { id: true },
        })
        if (products.length !== payload.data.items.length) throw new Error('PRODUCT_NOT_FOUND')
        const priceList = await transaction.priceList.create({
          data: {
            name: payload.data.name,
            description: payload.data.description || null,
            items: { create: payload.data.items },
          },
          include: { items: { include: { product: { select: { id: true, name: true, sku: true } } } } },
        })
        await logAudit({
          request,
          action: 'CREATE',
          moduleName: 'Ventas',
          entity: 'PriceList',
          entityId: priceList.id,
          details: `Se creó la lista de precios ${priceList.name}.`,
        }, transaction)
        return priceList
      })
      return NextResponse.json(created, { status: 201 })
    } catch (error) {
      return pricingWriteError(error)
    }
  }

  if (kind === 'promotion') {
    const payload = promotionSchema.safeParse(body)
    if (!payload.success) return NextResponse.json({ error: 'Revisa los datos de la promoción.' }, { status: 400 })
    if (new Set(payload.data.productIds).size !== payload.data.productIds.length) {
      return NextResponse.json({ error: 'No repitas productos en una promoción.' }, { status: 400 })
    }
    try {
      const promotion = await prisma.$transaction(async (transaction) => {
        if (payload.data.productIds.length) {
          const products = await transaction.product.findMany({
            where: { id: { in: payload.data.productIds }, isActive: true },
            select: { id: true },
          })
          if (products.length !== payload.data.productIds.length) throw new Error('PRODUCT_NOT_FOUND')
        }
        const created = await transaction.promotion.create({
          data: {
            name: payload.data.name,
            discountPercent: payload.data.discountPercent,
            startsAt: new Date(payload.data.startsAt),
            endsAt: new Date(payload.data.endsAt),
            products: { create: payload.data.productIds.map((productId) => ({ productId })) },
          },
          include: { products: { include: { product: { select: { id: true, name: true, sku: true } } } } },
        })
        await logAudit({
          request,
          action: 'CREATE',
          moduleName: 'Ventas',
          entity: 'Promotion',
          entityId: created.id,
          details: `Se creó la promoción ${created.name} con ${Number(created.discountPercent)}% de descuento.`,
        }, transaction)
        return created
      })
      return NextResponse.json(promotion, { status: 201 })
    } catch (error) {
      return pricingWriteError(error)
    }
  }

  return NextResponse.json({ error: 'Tipo de configuración no válido.' }, { status: 400 })
}

export async function PATCH(request: Request) {
  const access = await requirePermission(request, 'sales:manage-pricing')
  if (access.response) return access.response
  const payload = statusSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'La solicitud de estado no es válida.' }, { status: 400 })
  try {
    const updated = await prisma.$transaction(async (transaction) => {
      const entity = payload.data.kind === 'price-list'
        ? await transaction.priceList.update({
            where: { id: payload.data.id },
            data: { isActive: payload.data.isActive },
            select: { id: true, name: true, isActive: true },
          })
        : await transaction.promotion.update({
            where: { id: payload.data.id },
            data: { isActive: payload.data.isActive },
            select: { id: true, name: true, isActive: true },
          })
      await logAudit({
        request,
        action: 'UPDATE',
        moduleName: 'Ventas',
        entity: payload.data.kind === 'price-list' ? 'PriceList' : 'Promotion',
        entityId: entity.id,
        details: `Se ${entity.isActive ? 'activó' : 'desactivó'} ${payload.data.kind === 'price-list' ? 'la lista' : 'la promoción'} ${entity.name}.`,
      }, transaction)
      return entity
    })
    return NextResponse.json(updated)
  } catch (error) {
    return pricingWriteError(error)
  }
}
