import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/permissions'
import { resolveSalesPricing } from '@/lib/sales-pricing'

export async function GET(request: Request) {
  const access = await requirePermission(request, 'sales:read')
  if (access.response) return access.response
  const customerId = new URL(request.url).searchParams.get('customerId') || undefined

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { type: 'PRODUCT' },
        { type: 'SERVICE', serviceBillingPeriod: 'ONE_TIME' },
      ],
    },
    select: { id: true, price: true },
  })
  const pricing = await prisma.$transaction((transaction) =>
    resolveSalesPricing(transaction, products.map((product) => product.id), customerId),
  )
  const effectivePrices = pricing.prices

  return NextResponse.json(products.map((product) => {
    const effectivePrice = effectivePrices.get(product.id)
    return {
      id: product.id,
      price: (effectivePrice?.unitPrice ?? Number(product.price)).toFixed(2),
      promotionDiscountPercent: effectivePrice?.promotionDiscountPercent ?? 0,
      promotionName: effectivePrice?.promotionName ?? null,
    }
  }))
}
