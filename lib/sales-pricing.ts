import { Prisma } from '@/lib/generated/prisma/client'

type PricingClient = Pick<Prisma.TransactionClient, 'customer' | 'promotion'>

export type EffectiveProductPrice = {
  unitPrice: number | null
  promotionDiscountPercent: number
  promotionName: string | null
}

export type SalesPricing = {
  prices: Map<string, EffectiveProductPrice>
  priceListName: string | null
}

export async function resolveSalesPricing(
  client: PricingClient,
  productIds: string[],
  customerId?: string,
) {
  const uniqueProductIds = [...new Set(productIds)]
  const now = new Date()
  const [customer, promotions] = await Promise.all([
    customerId
      ? client.customer.findFirst({
          where: { id: customerId, isActive: true },
          select: {
            priceList: {
              select: {
                name: true,
                isActive: true,
                items: {
                  where: { productId: { in: uniqueProductIds } },
                  select: { productId: true, unitPrice: true },
                },
              },
            },
          },
        })
      : null,
    client.promotion.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
        OR: [
          { products: { some: { productId: { in: uniqueProductIds } } } },
          { products: { none: {} } },
        ],
      },
      include: { products: { select: { productId: true } } },
      orderBy: [{ discountPercent: 'desc' }, { name: 'asc' }],
    }),
  ])

  const segmentPrices = new Map(
    customer?.priceList?.isActive
      ? customer.priceList.items.map((item) => [item.productId, Number(item.unitPrice)])
      : [],
  )
  const priceListName = customer?.priceList?.isActive ? customer.priceList.name : null
  const pricing = new Map<string, EffectiveProductPrice>()

  for (const productId of uniqueProductIds) {
    const promotion = promotions.find((candidate) =>
      candidate.products.length === 0 || candidate.products.some((item) => item.productId === productId),
    )
    pricing.set(productId, {
      unitPrice: segmentPrices.get(productId) ?? null,
      promotionDiscountPercent: promotion ? Number(promotion.discountPercent) : 0,
      promotionName: promotion?.name ?? null,
    })
  }

  return { prices: pricing, priceListName }
}
