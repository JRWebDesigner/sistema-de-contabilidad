import { NextResponse } from 'next/server'
import { z } from 'zod'

import { adjustBranchStock } from '@/lib/branch-stock'
import { logAudit } from '@/lib/audit'
import { prisma, serializableTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'

const transferSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  fromBranchId: z.string().min(1).nullable(),
  toBranchId: z.string().min(1),
})

function transferNumber() {
  return `TR-${Date.now().toString(36).toUpperCase()}`
}

export async function GET(request: Request) {
  const access = await requirePermission(request, 'inventory:read')
  if (access.response) return access.response
  if (access.session.role !== 'ADMIN') return NextResponse.json({ canManage: false, branches: [], products: [] })
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  })
  const products = await prisma.product.findMany({
    where: { isActive: true, type: 'PRODUCT' },
    select: {
      id: true,
      name: true,
      sku: true,
      branchStocks: { select: { branchId: true, quantity: true } },
    },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({
    canManage: access.session.role === 'ADMIN',
    branches,
    products: products.map(({ branchStocks, ...product }) => ({
      ...product,
      stocks: branchStocks,
    })),
  })
}

export async function POST(request: Request) {
  const access = await requirePermission(request, 'inventory:write')
  if (access.response) return access.response
  if (access.session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo administración puede reasignar stock o transferir entre sucursales.' }, { status: 403 })
  }

  const payload = transferSchema.safeParse(await request.json())
  if (!payload.success || payload.data.fromBranchId === payload.data.toBranchId) {
    return NextResponse.json({ error: 'Indica producto, sucursal de origen/destino y una cantidad válida.' }, { status: 400 })
  }

  try {
    const result = await serializableTransaction(async (transaction) => {
      const product = await transaction.product.findFirst({
        where: { id: payload.data.productId, isActive: true, type: 'PRODUCT' },
        select: { id: true, name: true, cost: true },
      })
      if (!product) throw new Error('PRODUCT_NOT_FOUND')

      const destination = await transaction.branch.findFirst({
        where: { id: payload.data.toBranchId, isActive: true },
        select: { id: true, name: true },
      })
      if (!destination) throw new Error('DESTINATION_NOT_FOUND')

      if (payload.data.fromBranchId) {
        const source = await transaction.branch.findFirst({
          where: { id: payload.data.fromBranchId, isActive: true },
          select: { id: true },
        })
        if (!source) throw new Error('SOURCE_NOT_FOUND')
      }

      const number = transferNumber()
      const transfer = await transaction.stockTransfer.create({
        data: {
          number,
          fromBranchId: payload.data.fromBranchId,
          toBranchId: destination.id,
        },
      })

      if (payload.data.fromBranchId) {
        await adjustBranchStock(transaction, product.id, payload.data.fromBranchId, -payload.data.quantity)
      } else {
        const legacyStock = await transaction.productStock.findFirst({
          where: { productId: product.id, branchId: null },
          select: { id: true },
        })
        if (!legacyStock) throw new Error('INSUFFICIENT_UNASSIGNED_STOCK')
        const changed = await transaction.productStock.updateMany({
          where: { id: legacyStock.id, quantity: { gte: payload.data.quantity } },
          data: { quantity: { decrement: payload.data.quantity } },
        })
        if (changed.count !== 1) throw new Error('INSUFFICIENT_UNASSIGNED_STOCK')
        const changedTotal = await transaction.product.updateMany({
          where: { id: product.id, currentStock: { gte: payload.data.quantity } },
          data: { currentStock: { decrement: payload.data.quantity } },
        })
        if (changedTotal.count !== 1) throw new Error('INSUFFICIENT_UNASSIGNED_STOCK')
      }
      await adjustBranchStock(transaction, product.id, destination.id, payload.data.quantity)

      await transaction.inventoryMovement.createMany({
        data: [
          {
            type: 'TRANSFER_OUT',
            quantity: -payload.data.quantity,
            unitCost: product.cost,
            reference: number,
            productId: product.id,
            branchId: payload.data.fromBranchId,
            transferId: transfer.id,
          },
          {
            type: 'TRANSFER_IN',
            quantity: payload.data.quantity,
            unitCost: product.cost,
            reference: number,
            productId: product.id,
            branchId: destination.id,
            transferId: transfer.id,
          },
        ],
      })

      await logAudit({
        request,
        userId: access.session.userId,
        action: 'CREATE',
        moduleName: 'Inventario',
        entity: 'StockTransfer',
        entityId: transfer.id,
        details: `Se transfirieron ${payload.data.quantity} unidades de ${product.name} desde ${payload.data.fromBranchId ? 'otra sucursal' : 'Sin sucursal'} a ${destination.name}.`,
        newValue: {
          productId: product.id,
          quantity: payload.data.quantity,
          fromBranchId: payload.data.fromBranchId,
          toBranchId: destination.id,
        },
      }, transaction)

      return { id: transfer.id, number, destination: destination.name }
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const messages: Record<string, string> = {
      PRODUCT_NOT_FOUND: 'El producto no existe o está inactivo.',
      DESTINATION_NOT_FOUND: 'La sucursal de destino no existe o está inactiva.',
      SOURCE_NOT_FOUND: 'La sucursal de origen no existe o está inactiva.',
      INSUFFICIENT_BRANCH_STOCK: 'No hay stock suficiente en la sucursal de origen.',
      INSUFFICIENT_UNASSIGNED_STOCK: 'No hay stock suficiente sin sucursal asignada.',
      INSUFFICIENT_STOCK: 'No hay stock total suficiente para completar la transferencia.',
    }
    const message = error instanceof Error ? messages[error.message] : undefined
    return NextResponse.json({ error: message ?? 'No se pudo completar la transferencia.' }, { status: message ? 400 : 500 })
  }
}
