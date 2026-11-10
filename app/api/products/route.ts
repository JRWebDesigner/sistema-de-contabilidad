import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma, serializableTransaction } from '@/lib/db'
import { requireAdmin, requirePermission } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { postJournalEntry } from '@/lib/accounting'
import { adjustBranchStock } from '@/lib/branch-stock'
import { branchContextError, branchWhere, requireSingleBranch, resolveBranchContext } from '@/lib/branches'

const productSchema = z.object({
  type: z.enum(['PRODUCT', 'SERVICE']),
  serviceBillingPeriod: z.enum(['ONE_TIME', 'MONTHLY', 'ANNUAL']).nullable(),
  sku: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(180),
  categoryId: z.string().min(1),
  unit: z.string().trim().min(1).max(30),
  cost: z.coerce.number().finite().min(0),
  price: z.coerce.number().finite().positive(),
  currentStock: z.coerce.number().int().min(0),
  minimumStock: z.coerce.number().int().min(0),
}).superRefine((product, context) => {
  if (product.type === 'SERVICE' && !product.serviceBillingPeriod) {
    context.addIssue({ code: 'custom', path: ['serviceBillingPeriod'], message: 'Selecciona la periodicidad del servicio.' })
  }
  if (product.type === 'PRODUCT' && product.serviceBillingPeriod) {
    context.addIssue({ code: 'custom', path: ['serviceBillingPeriod'], message: 'Los productos no tienen periodicidad de servicio.' })
  }
  if (product.type === 'SERVICE' && (product.cost !== 0 || product.currentStock !== 0 || product.minimumStock !== 0)) {
    context.addIssue({ code: 'custom', path: ['currentStock'], message: 'Los servicios no tienen costo de inventario ni control de stock.' })
  }
})

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export async function GET(request: Request) {
  const access = await requirePermission(request, 'inventory:read')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  const type = new URL(request.url).searchParams.get('type')

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(type === 'PRODUCT' || type === 'SERVICE' ? { type } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { sku: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: { category: true, branchStocks: { where: branchWhere(branchContext), select: { quantity: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(
    products.map((product) => ({
      ...product,
      currentStock: branchContext.branchId ? product.branchStocks[0]?.quantity ?? 0 : product.currentStock,
      branchStocks: undefined,
      cost: product.cost.toString(),
      price: product.price.toString(),
    })),
  )
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'inventory:write')
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!
  const formData = await request.formData()
  const image = formData.get('image')
  const fields = Object.fromEntries(
    ['type', 'serviceBillingPeriod', 'sku', 'name', 'categoryId', 'unit', 'cost', 'price', 'currentStock', 'minimumStock']
      .map((field) => [field, formData.get(field)]),
  )
  fields.serviceBillingPeriod = fields.serviceBillingPeriod || null
  const payload = productSchema.safeParse(fields)

  if (!payload.success) {
    return NextResponse.json({ error: 'Revisa los datos del producto.' }, { status: 400 })
  }

  let imageUrl: string | undefined
  if (image instanceof File && image.size > 0) {
    const allowedTypes: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    }
    const extension = allowedTypes[image.type]
    if (!extension || image.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'La imagen debe ser JPG, PNG o WebP y pesar como máximo 5 MB.' }, { status: 400 })
    }

    const fileName = `${randomUUID()}.${extension}`
    const uploadDirectory = path.join(process.cwd(), 'public', 'uploads', 'products')
    await mkdir(uploadDirectory, { recursive: true })
    await writeFile(path.join(uploadDirectory, fileName), Buffer.from(await image.arrayBuffer()))
    imageUrl = `/uploads/products/${fileName}`
  }

  try {
    const product = await prisma.$transaction(async (transaction) => {
      const createdProduct = await transaction.product.create({
        data: {
          ...payload.data,
          currentStock: 0,
          minimumStock: payload.data.type === 'SERVICE' ? 0 : payload.data.minimumStock,
          imageUrl,
        },
      })

      if (payload.data.type === 'PRODUCT' && payload.data.currentStock > 0) {
        await adjustBranchStock(transaction, createdProduct.id, branchId, payload.data.currentStock)
        const movement = await transaction.inventoryMovement.create({
          data: {
            type: 'INITIAL',
            quantity: payload.data.currentStock,
            unitCost: createdProduct.cost,
            productId: createdProduct.id,
            reference: 'STOCK-INICIAL',
            branchId,
          },
        })
        const openingValue = Number(createdProduct.cost) * payload.data.currentStock
        if (openingValue > 0) {
          await postJournalEntry(transaction, {
            date: movement.createdAt,
            description: `Stock inicial de ${createdProduct.name}`,
            sourceType: 'INITIAL_INVENTORY',
            sourceId: movement.id,
            branchId,
            lines: [
              { accountCode: '1300', debit: openingValue },
              { accountCode: '3000', credit: openingValue },
            ],
          })
        }
      }

      await logAudit({
        request,
        action: 'CREATE',
        moduleName: 'Inventario',
        entity: 'Product',
        entityId: createdProduct.id,
        details: `Se registró el producto ${createdProduct.name} con stock inicial ${createdProduct.currentStock}.`,
      }, transaction)

      return transaction.product.findUniqueOrThrow({
        where: { id: createdProduct.id },
        include: { category: true },
      })
    })

    return NextResponse.json(
      {
        ...product,
        cost: product.cost.toString(),
        price: product.price.toString(),
      },
      { status: 201 },
    )
  } catch (error) {
    const message = error instanceof Error && error.message.includes('Unique constraint')
      ? 'El SKU ya existe.'
      : error instanceof Error && error.message.includes('Foreign key constraint')
        ? 'La categoría seleccionada no existe.'
        : 'No se pudo guardar el producto.'

    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  const access = await requirePermission(request, 'inventory:write')
  if (access.response) return access.response
  if (access.session?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo el administrador puede editar productos.' }, { status: 403 })
  }
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = requireSingleBranch(branchContext)
  if (branchError) return branchError
  const branchId = branchContext.branchId!

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta el identificador del producto.' }, { status: 400 })

  const formData = await request.formData()
  const image = formData.get('image')
  const fields = Object.fromEntries(
    ['type', 'serviceBillingPeriod', 'sku', 'name', 'categoryId', 'unit', 'cost', 'price', 'currentStock', 'minimumStock']
      .map((field) => [field, formData.get(field)]),
  )
  fields.serviceBillingPeriod = fields.serviceBillingPeriod || null
  const payload = productSchema.safeParse(fields)
  if (!payload.success) return NextResponse.json({ error: 'Revisa los datos del producto.' }, { status: 400 })

  let imageUrl: string | undefined
  if (image instanceof File && image.size > 0) {
    const allowedTypes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
    const extension = allowedTypes[image.type]
    if (!extension || image.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'La imagen debe ser JPG, PNG o WebP y pesar como máximo 5 MB.' }, { status: 400 })
    }
    const fileName = `${randomUUID()}.${extension}`
    const uploadDirectory = path.join(process.cwd(), 'public', 'uploads', 'products')
    await mkdir(uploadDirectory, { recursive: true })
    await writeFile(path.join(uploadDirectory, fileName), Buffer.from(await image.arrayBuffer()))
    imageUrl = `/uploads/products/${fileName}`
  }

  try {
    const product = await serializableTransaction(async (transaction) => {
      const current = await transaction.product.findUnique({ where: { id } })
      if (!current) throw new Error('NOT_FOUND')
      if (current.type !== payload.data.type) throw new Error('PRODUCT_TYPE_IMMUTABLE')
      const currentBranchStock = await transaction.productStock.findFirst({
        where: { productId: id, branchId },
        select: { quantity: true },
      })
      const previousBranchQuantity = currentBranchStock?.quantity ?? 0
      const stockDifference = payload.data.type === 'PRODUCT'
        ? payload.data.currentStock - previousBranchQuantity
        : -previousBranchQuantity
      const { currentStock: _requestedStock, ...productFields } = payload.data

      const updatedProduct = await transaction.product.update({
        where: { id },
        data: {
          ...productFields,
          minimumStock: payload.data.type === 'SERVICE' ? 0 : payload.data.minimumStock,
          ...(imageUrl ? { imageUrl } : {}),
        },
      })
      if (stockDifference !== 0) {
        await adjustBranchStock(transaction, updatedProduct.id, branchId, stockDifference)
        const movement = await transaction.inventoryMovement.create({
          data: {
            type: stockDifference > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
            quantity: Math.abs(stockDifference),
            unitCost: updatedProduct.cost,
            productId: updatedProduct.id,
            reference: 'EDICION-PRODUCTO',
            branchId,
          },
        })
        const inventoryDifference = Number(updatedProduct.cost) * payload.data.currentStock - Number(current.cost) * previousBranchQuantity
        if (inventoryDifference !== 0) {
          await postJournalEntry(transaction, {
            date: movement.createdAt,
            description: `Ajuste de existencias de ${updatedProduct.name}`,
            sourceType: 'INVENTORY_ADJUSTMENT',
            sourceId: movement.id,
            branchId,
            lines: inventoryDifference > 0
              ? [
                  { accountCode: '1300', debit: inventoryDifference },
                  { accountCode: '4900', credit: inventoryDifference },
                ]
              : [
                  { accountCode: '5100', debit: Math.abs(inventoryDifference) },
                  { accountCode: '1300', credit: Math.abs(inventoryDifference) },
                ],
          })
        }
      } else if (payload.data.type === 'PRODUCT' && Number(updatedProduct.cost) !== Number(current.cost) && previousBranchQuantity > 0) {
        const revaluation = roundMoney((Number(updatedProduct.cost) - Number(current.cost)) * previousBranchQuantity)
        await postJournalEntry(transaction, {
          date: new Date(),
          description: `Revalorización de costo de ${updatedProduct.name}`,
          sourceType: 'PRODUCT_COST_CHANGE',
          sourceId: `${updatedProduct.id}:${branchId}:${randomUUID()}`,
          branchId,
          lines: revaluation > 0
            ? [
                { accountCode: '1300', debit: revaluation },
                { accountCode: '4900', credit: revaluation },
              ]
            : [
                { accountCode: '5100', debit: Math.abs(revaluation) },
                { accountCode: '1300', credit: Math.abs(revaluation) },
              ],
        })
      }

      await logAudit({
        request,
        action: 'UPDATE',
        moduleName: 'Inventario',
        entity: 'Product',
        entityId: updatedProduct.id,
        details: `Se actualizó el producto ${updatedProduct.name}.`,
      }, transaction)

      return transaction.product.findUniqueOrThrow({ where: { id }, include: { category: true } })
    })

    return NextResponse.json({ ...product, cost: product.cost.toString(), price: product.price.toString() })
  } catch (error) {
    const message = error instanceof Error && error.message === 'NOT_FOUND'
      ? 'El producto no existe.'
      : error instanceof Error && error.message.includes('Unique constraint')
        ? 'El SKU ya existe.'
        : error instanceof Error && error.message === 'PRODUCT_TYPE_IMMUTABLE'
          ? 'No se puede cambiar un producto a servicio ni un servicio a producto; crea un registro nuevo.'
        : error instanceof Error && error.message.includes('Foreign key constraint')
          ? 'La categoría seleccionada no existe.'
          : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_CLOSED'
            ? 'El período contable de esta fecha está cerrado.'
            : error instanceof Error && error.message === 'ACCOUNTING_PERIOD_NOT_STARTED'
              ? 'La fecha de operación es anterior al inicio del libro mayor.'
          : 'No se pudo actualizar el producto.'
    return NextResponse.json({ error: message }, { status: message === 'El producto no existe.' ? 404 : 400 })
  }
}

export async function DELETE(request: Request) {
  const access = await requireAdmin(request)
  if (access.response) return access.response

  const url = new URL(request.url)
  const id = url.searchParams.get('id') ?? (await request.clone().json().catch(() => ({}))).id

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Falta el identificador del producto.' }, { status: 400 })
  }

  try {
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } })
    if (!product) return NextResponse.json({ error: 'El producto no existe.' }, { status: 404 })

    await prisma.$transaction(async (transaction) => {
      await transaction.product.update({ where: { id }, data: { isActive: false } })
      await logAudit({
        request,
        action: 'DELETE',
        moduleName: 'Inventario',
        entity: 'Product',
        entityId: id,
        details: `Se desactivó el producto ${product.name}.`,
        oldValue: { isActive: product.isActive },
        newValue: { isActive: false },
      }, transaction)
    })
    return NextResponse.json({ ok: true, id, name: product.name })
  } catch {
    return NextResponse.json({ error: 'No se pudo eliminar el producto.' }, { status: 400 })
  }
}
