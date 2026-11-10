import type { Prisma } from '@/lib/generated/prisma/client'

export async function adjustBranchStock(
  transaction: Prisma.TransactionClient,
  productId: string,
  branchId: string,
  quantity: number,
) {
  if (!Number.isInteger(quantity) || quantity === 0) {
    throw new Error('INVALID_STOCK_ADJUSTMENT')
  }

  const existing = await transaction.productStock.findFirst({
    where: { productId, branchId },
    select: { id: true, quantity: true },
  })

  if (existing) {
    const updated = await transaction.productStock.updateMany({
      where: {
        id: existing.id,
        ...(quantity < 0 ? { quantity: { gte: Math.abs(quantity) } } : {}),
      },
      data: { quantity: { increment: quantity } },
    })
    if (updated.count !== 1) throw new Error('INSUFFICIENT_BRANCH_STOCK')
  } else {
    if (quantity < 0) throw new Error('INSUFFICIENT_BRANCH_STOCK')
    await transaction.productStock.create({ data: { productId, branchId, quantity } })
  }

  const total = await transaction.product.updateMany({
    where: {
      id: productId,
      ...(quantity < 0 ? { currentStock: { gte: Math.abs(quantity) } } : {}),
    },
    data: { currentStock: { increment: quantity } },
  })
  if (total.count !== 1) throw new Error('INSUFFICIENT_STOCK')
}
