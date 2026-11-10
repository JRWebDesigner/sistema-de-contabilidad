import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@/lib/generated/prisma/client'

import { prisma } from '@/lib/db'
import { requirePermission, rolePermissions, type Permission } from '@/lib/permissions'
import { branchContextError, branchWhere, resolveBranchContext } from '@/lib/branches'

const reportTypeSchema = z.enum(['ventas', 'vendedores', 'compras', 'clientes', 'cxc', 'cxp', 'caja', 'inventario', 'proveedores'])

const permissionForReport: Record<z.infer<typeof reportTypeSchema>, Permission> = {
  ventas: 'sales:read',
  vendedores: 'sales:read',
  compras: 'finance:read',
  clientes: 'contacts:read',
  cxc: 'finance:read',
  cxp: 'finance:read',
  caja: 'finance:read',
  inventario: 'inventory:read',
  proveedores: 'contacts:read',
}

function pagination(total: number, page: number, pageSize: number) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
}

function parseReportDate(value: string | null) {
  if (value == null) return { date: null, valid: true }
  const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(value)
  if (!parsed.success) return { date: null, valid: false }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { date: null, valid: false }
  }
  return { date, valid: true }
}

function rounded(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsedType = reportTypeSchema.safeParse(url.searchParams.get('type'))
  if (!parsedType.success) return NextResponse.json({ error: 'Tipo de reporte inválido.' }, { status: 400 })

  const access = await requirePermission(request, permissionForReport[parsedType.data])
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError
  const scope = branchWhere(branchContext)

  const parsedPage = z.coerce.number().int().positive().safeParse(url.searchParams.get('page') ?? '1')
  const parsedPageSize = z.coerce.number().int().positive().safeParse(url.searchParams.get('pageSize') ?? '25')
  if (!parsedPage.success || !parsedPageSize.success) {
    return NextResponse.json({ error: 'La página o el tamaño solicitado no es válido.' }, { status: 400 })
  }

  const pageSize = Math.min(parsedPageSize.data, 100)
  const requestedPage = parsedPage.data
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 120)
  const contains = { contains: query, mode: 'insensitive' as const }

  if (parsedType.data === 'vendedores') {
    const todayInBolivia = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const dateValue = url.searchParams.get('date') ?? todayInBolivia
    const parsedDate = parseReportDate(dateValue)
    if (!parsedDate.valid || !parsedDate.date) {
      return NextResponse.json({ error: 'La fecha del reporte diario no es válida.' }, { status: 400 })
    }

    const dayStart = new Date(Date.UTC(
      parsedDate.date.getUTCFullYear(),
      parsedDate.date.getUTCMonth(),
      parsedDate.date.getUTCDate(),
      4,
    ))
    const dayEnd = new Date(dayStart)
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)
    const canReadFinance = rolePermissions(access.session.role).includes('finance:read')
    const [activeSellers, sales] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'SALES', isActive: true, ...scope },
        select: { id: true, name: true, alias: true, role: true },
        orderBy: { name: 'asc' },
      }),
      prisma.sale.findMany({
        where: { ...scope, createdAt: { gte: dayStart, lt: dayEnd } },
        select: {
          id: true,
          sellerId: true,
          seller: { select: { id: true, name: true, alias: true, role: true } },
          status: true,
          subtotal: true,
          discountTotal: true,
          total: true,
          items: { select: { id: true, quantity: true, unitCost: true } },
          returns: { select: { items: { select: { saleItemId: true, quantity: true, lineTotal: true } } } },
        },
      }),
    ])

    type SellerDailyMetrics = {
      id: string
      sellerName: string
      alias: string
      role: string | null
      salesCount: number
      cancelledSales: number
      cancelledAmount: number
      units: number
      grossSales: number
      discounts: number
      refunds: number
      netSales: number
      cost: number
    }
    const sellerMetrics = new Map<string, SellerDailyMetrics>()
    const getSeller = (id: string, name: string, alias: string, role: string | null) => {
      let metrics = sellerMetrics.get(id)
      if (!metrics) {
        metrics = {
          id,
          sellerName: name,
          alias,
          role,
          salesCount: 0,
          cancelledSales: 0,
          cancelledAmount: 0,
          units: 0,
          grossSales: 0,
          discounts: 0,
          refunds: 0,
          netSales: 0,
          cost: 0,
        }
        sellerMetrics.set(id, metrics)
      }
      return metrics
    }

    for (const seller of activeSellers) getSeller(seller.id, seller.name, seller.alias, seller.role)
    for (const sale of sales) {
      const metrics = sale.seller
        ? getSeller(sale.seller.id, sale.seller.name, sale.seller.alias, sale.seller.role)
        : getSeller('unassigned', 'Sin vendedor registrado', '', null)

      if (sale.status === 'CANCELLED') {
        metrics.cancelledSales += 1
        metrics.cancelledAmount += Number(sale.total)
        continue
      }

      metrics.salesCount += 1
      metrics.grossSales += Number(sale.subtotal)
      metrics.discounts += Number(sale.discountTotal)
      const returnedByItem = new Map<string, { quantity: number; amount: number }>()
      for (const saleReturn of sale.returns) {
        for (const returnedItem of saleReturn.items) {
          const current = returnedByItem.get(returnedItem.saleItemId) ?? { quantity: 0, amount: 0 }
          current.quantity += returnedItem.quantity
          current.amount += Number(returnedItem.lineTotal)
          returnedByItem.set(returnedItem.saleItemId, current)
          metrics.refunds += Number(returnedItem.lineTotal)
        }
      }
      for (const item of sale.items) {
        const returned = returnedByItem.get(item.id) ?? { quantity: 0, amount: 0 }
        const retainedQuantity = Math.max(0, item.quantity - returned.quantity)
        metrics.units += retainedQuantity
        metrics.cost += Number(item.unitCost) * retainedQuantity
      }
      metrics.netSales += Number(sale.total) - Array.from(returnedByItem.values()).reduce((sum, item) => sum + item.amount, 0)
    }

    const roundedMetrics = Array.from(sellerMetrics.values())
      .filter((seller) => !query || `${seller.sellerName} ${seller.alias}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .map((seller) => ({
        id: seller.id,
        sellerName: seller.sellerName,
        alias: seller.alias,
        role: seller.role,
        salesCount: seller.salesCount,
        cancelledSales: seller.cancelledSales,
        cancelledAmount: rounded(seller.cancelledAmount),
        units: seller.units,
        grossSales: rounded(seller.grossSales),
        discounts: rounded(seller.discounts),
        refunds: rounded(seller.refunds),
        netSales: rounded(seller.netSales),
        cost: canReadFinance ? rounded(seller.cost) : null,
        grossProfit: canReadFinance ? rounded(seller.netSales - seller.cost) : null,
      }))
      .sort((left, right) => left.sellerName.localeCompare(right.sellerName, 'es'))

    const total = roundedMetrics.length
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)))
    const pageRows = roundedMetrics.slice((page - 1) * pageSize, page * pageSize)
    const sellerDailySummary = {
      date: dateValue,
      sellerCount: roundedMetrics.length,
      sellersWithActivity: roundedMetrics.filter((seller) => seller.salesCount + seller.cancelledSales > 0).length,
      salesCount: roundedMetrics.reduce((sum, seller) => sum + seller.salesCount, 0),
      cancelledSales: roundedMetrics.reduce((sum, seller) => sum + seller.cancelledSales, 0),
      cancelledAmount: rounded(roundedMetrics.reduce((sum, seller) => sum + seller.cancelledAmount, 0)),
      grossSales: rounded(roundedMetrics.reduce((sum, seller) => sum + seller.grossSales, 0)),
      discounts: rounded(roundedMetrics.reduce((sum, seller) => sum + seller.discounts, 0)),
      refunds: rounded(roundedMetrics.reduce((sum, seller) => sum + seller.refunds, 0)),
      netSales: rounded(roundedMetrics.reduce((sum, seller) => sum + seller.netSales, 0)),
      cost: canReadFinance ? rounded(roundedMetrics.reduce((sum, seller) => sum + (seller.cost ?? 0), 0)) : null,
      grossProfit: canReadFinance ? rounded(roundedMetrics.reduce((sum, seller) => sum + (seller.grossProfit ?? 0), 0)) : null,
    }

    return NextResponse.json({
      data: pageRows,
      pagination: pagination(total, page, pageSize),
      sellerDailySummary,
    })
  }

  if (parsedType.data === 'ventas') {
    const fromDate = parseReportDate(url.searchParams.get('from'))
    const toDate = parseReportDate(url.searchParams.get('to'))
    if (!fromDate.valid || !toDate.valid || (fromDate.date && toDate.date && fromDate.date > toDate.date)) {
      return NextResponse.json({ error: 'El período del reporte no es válido.' }, { status: 400 })
    }
    const dateWhere: Prisma.SaleWhereInput = { ...scope }
    if (fromDate.date || toDate.date) {
      const createdAt: Prisma.DateTimeFilter = {}
      if (fromDate.date) createdAt.gte = fromDate.date
      if (toDate.date) {
        const endExclusive = new Date(toDate.date)
        endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
        createdAt.lt = endExclusive
      }
      dateWhere.createdAt = createdAt
    }
    const proformaDateWhere: Prisma.ProformaWhereInput = { ...scope }
    if (fromDate.date || toDate.date) {
      const proformaCreatedAt: Prisma.DateTimeFilter<'Proforma'> = {}
      if (fromDate.date) proformaCreatedAt.gte = fromDate.date
      if (toDate.date) {
        const endExclusive = new Date(toDate.date)
        endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
        proformaCreatedAt.lt = endExclusive
      }
      proformaDateWhere.createdAt = proformaCreatedAt
    }
    const proformaFunnelAt = new Date()
    const searchWhere: Prisma.SaleWhereInput = query ? { OR: [
      { number: contains },
      { paymentReference: contains },
      { customer: { is: { name: contains } } },
      { items: { some: { product: { name: contains } } } },
      { items: { some: { product: { sku: contains } } } },
    ] } : {}
    const where: Prisma.SaleWhereInput = { ...dateWhere, ...searchWhere }
    const total = await prisma.sale.count({ where })
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)))
    const canReadFinance = rolePermissions(access.session.role).includes('finance:read')
    const [sales, completedSales, receivables, accounts, issuedProformas, acceptedProformas, pendingProformas, expiredProformas, rejectedProformas] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          customer: { select: { name: true, document: true } },
          items: { include: { product: { select: { name: true, sku: true } } } },
          returns: { select: { number: true, reason: true, createdAt: true, items: { select: { saleItemId: true, quantity: true, lineTotal: true } } } },
          receivable: { select: { balance: true, paidAmount: true, status: true, originalAmount: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.sale.findMany({
        where: { ...dateWhere, status: 'COMPLETED' },
        select: {
          id: true,
          customerId: true,
          priceListName: true,
          customer: { select: { name: true } },
          items: {
            select: {
              id: true,
              quantity: true,
              unitPrice: true,
              discountPercent: true,
              unitCost: true,
              lineTotal: true,
              promotionName: true,
              productId: true,
              product: { select: { name: true, sku: true } },
            },
          },
          returns: {
            select: {
              items: { select: { saleItemId: true, quantity: true, lineTotal: true } },
            },
          },
        },
      }),
      canReadFinance ? prisma.accountReceivable.aggregate({ where: branchContext.isAll ? undefined : { sale: { is: scope } }, _sum: { balance: true } }) : Promise.resolve(null),
      canReadFinance ? prisma.cashAccount.aggregate({ where: { isActive: true, ...scope }, _sum: { balance: true } }) : Promise.resolve(null),
      prisma.proforma.aggregate({ where: proformaDateWhere, _count: { _all: true }, _sum: { total: true } }),
      prisma.proforma.aggregate({ where: { ...proformaDateWhere, status: 'ACCEPTED' }, _count: { _all: true }, _sum: { total: true } }),
      prisma.proforma.aggregate({ where: { ...proformaDateWhere, status: 'SENT', validUntil: { gte: proformaFunnelAt } }, _count: { _all: true }, _sum: { total: true } }),
      prisma.proforma.aggregate({ where: { ...proformaDateWhere, status: 'SENT', validUntil: { lt: proformaFunnelAt } }, _count: { _all: true }, _sum: { total: true } }),
      prisma.proforma.aggregate({ where: { ...proformaDateWhere, status: 'REJECTED' }, _count: { _all: true }, _sum: { total: true } }),
    ])

    type Performance = {
      id: string
      name: string
      sales: Set<string>
      quantity: number
      revenue: number
      cost: number
      discounts: number
    }
    const byCustomer = new Map<string, Performance>()
    const byProduct = new Map<string, Performance>()
    const bySegment = new Map<string, Performance>()
    const byPromotion = new Map<string, Performance>()
    const getPerformance = (groups: Map<string, Performance>, id: string, name: string) => {
      let group = groups.get(id)
      if (!group) {
        group = { id, name, sales: new Set(), quantity: 0, revenue: 0, cost: 0, discounts: 0 }
        groups.set(id, group)
      }
      return group
    }
    const totals = { saleCount: completedSales.length, quantity: 0, revenue: 0, cost: 0, discounts: 0 }

    for (const sale of completedSales) {
      const customerId = sale.customerId ?? 'walk-in'
      const customerName = sale.customer?.name ?? 'Consumidor final'
      const customerGroup = getPerformance(byCustomer, customerId, customerName)
      const segmentName = sale.priceListName ?? 'Sin segmento registrado'
      const segmentGroup = getPerformance(bySegment, segmentName, segmentName)
      customerGroup.sales.add(sale.id)
      segmentGroup.sales.add(sale.id)

      const returnedByItem = new Map<string, { quantity: number; amount: number }>()
      for (const saleReturn of sale.returns) {
        for (const returnedItem of saleReturn.items) {
          const current = returnedByItem.get(returnedItem.saleItemId) ?? { quantity: 0, amount: 0 }
          current.quantity += returnedItem.quantity
          current.amount += Number(returnedItem.lineTotal)
          returnedByItem.set(returnedItem.saleItemId, current)
        }
      }

      for (const item of sale.items) {
        const returned = returnedByItem.get(item.id) ?? { quantity: 0, amount: 0 }
        const retainedQuantity = Math.max(0, item.quantity - returned.quantity)
        const revenue = rounded(Math.max(0, Number(item.lineTotal) - returned.amount))
        const cost = rounded(Number(item.unitCost) * retainedQuantity)
        const originalValue = rounded(Number(item.unitPrice) * retainedQuantity)
        const discount = rounded(Math.max(0, originalValue - revenue))
        const productId = item.productId
        const productName = `${item.product.name} (${item.product.sku})`
        const productGroup = getPerformance(byProduct, productId, productName)

        for (const group of [customerGroup, segmentGroup, productGroup]) {
          group.quantity += retainedQuantity
          group.revenue += revenue
          group.cost += cost
          group.discounts += discount
          group.sales.add(sale.id)
        }
        totals.quantity += retainedQuantity
        totals.revenue += revenue
        totals.cost += cost
        totals.discounts += discount

        if (item.promotionName) {
          const promotionGroup = getPerformance(byPromotion, item.promotionName, item.promotionName)
          promotionGroup.quantity += retainedQuantity
          promotionGroup.revenue += revenue
          promotionGroup.cost += cost
          promotionGroup.discounts += discount
          promotionGroup.sales.add(sale.id)
        }
      }
    }

    const serializeGroups = (groups: Map<string, Performance>) => Array.from(groups.values())
      .map((group) => {
        const revenue = rounded(group.revenue)
        const margin = rounded(group.revenue - group.cost)
        return {
          id: group.id,
          name: group.name,
          saleCount: group.sales.size,
          quantity: group.quantity,
          revenue,
          discounts: rounded(group.discounts),
          margin: canReadFinance ? margin : null,
          marginPercent: canReadFinance && revenue > 0 ? rounded(margin / revenue * 100) : null,
        }
      })
      .sort((left, right) => right.revenue - left.revenue)
      .slice(0, 10)

    return NextResponse.json({
      data: sales.map((sale) => ({
        ...sale,
        taxRate: sale.taxRate.toString(),
        subtotal: sale.subtotal.toString(),
        discountTotal: sale.discountTotal.toString(),
        taxAmount: sale.taxAmount.toString(),
        total: sale.total.toString(),
        receivable: sale.receivable ? {
          ...sale.receivable,
          balance: sale.receivable.balance.toString(),
          paidAmount: sale.receivable.paidAmount.toString(),
          originalAmount: sale.receivable.originalAmount.toString(),
        } : null,
        returns: sale.returns.map((saleReturn) => ({
          number: saleReturn.number,
          reason: saleReturn.reason,
          createdAt: saleReturn.createdAt,
          items: saleReturn.items.map((item) => ({
            ...item,
            lineTotal: item.lineTotal.toString(),
          })),
        })),
        items: sale.items.map((item) => ({
          ...item,
          unitPrice: item.unitPrice.toString(),
          discountPercent: item.discountPercent.toString(),
          unitCost: item.unitCost.toString(),
          lineTotal: item.lineTotal.toString(),
        })),
      })),
      pagination: pagination(total, page, pageSize),
      salesSummary: {
        receivables: Number(receivables?._sum.balance ?? 0),
        cash: Number(accounts?._sum.balance ?? 0),
      },
      commercialSummary: {
        from: fromDate.date?.toISOString().slice(0, 10) ?? null,
        to: toDate.date?.toISOString().slice(0, 10) ?? null,
        saleCount: totals.saleCount,
        quantity: totals.quantity,
        revenue: rounded(totals.revenue),
        discounts: rounded(totals.discounts),
        margin: canReadFinance ? rounded(totals.revenue - totals.cost) : null,
        averageTicket: totals.saleCount ? rounded(totals.revenue / totals.saleCount) : 0,
        byCustomer: serializeGroups(byCustomer),
        byProduct: serializeGroups(byProduct),
        bySegment: serializeGroups(bySegment),
        byPromotion: serializeGroups(byPromotion),
        proformaFunnel: {
          issued: {
            count: issuedProformas._count._all,
            amount: Number(issuedProformas._sum.total ?? 0),
          },
          converted: {
            count: acceptedProformas._count._all,
            amount: Number(acceptedProformas._sum.total ?? 0),
          },
          pending: {
            count: pendingProformas._count._all,
            amount: Number(pendingProformas._sum.total ?? 0),
          },
          expired: {
            count: expiredProformas._count._all,
            amount: Number(expiredProformas._sum.total ?? 0),
          },
          rejected: {
            count: rejectedProformas._count._all,
            amount: Number(rejectedProformas._sum.total ?? 0),
          },
          conversionRate: issuedProformas._count._all
            ? rounded(acceptedProformas._count._all / issuedProformas._count._all * 100)
            : 0,
        },
      },
    })
  }

  if (parsedType.data === 'compras') {
    const where = query ? { ...scope, OR: [
      { number: contains },
      { supplier: { is: { name: contains } } },
    ] } : scope
    const total = await prisma.purchase.count({ where })
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)))
    const data = await prisma.purchase.findMany({
      where,
      include: { supplier: { select: { name: true, document: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    return NextResponse.json({ data, pagination: pagination(total, page, pageSize) })
  }

  if (parsedType.data === 'clientes') {
    const where = query ? { OR: [
      { name: contains },
      { document: contains },
      { email: contains },
    ] } : {}
    const total = await prisma.customer.count({ where })
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)))
    const data = await prisma.customer.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    return NextResponse.json({ data, pagination: pagination(total, page, pageSize) })
  }

  if (parsedType.data === 'cxc') {
    const statusValue = url.searchParams.get('status') ?? 'ALL'
    const agingValue = url.searchParams.get('aging') ?? 'ALL'
    const statusResult = z.enum(['ALL', 'PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED']).safeParse(statusValue)
    const agingResult = z.enum(['ALL', 'CURRENT', '1-30', '31-60', '61-90', '90+']).safeParse(agingValue)
    const fromResult = parseReportDate(url.searchParams.get('from'))
    const toResult = parseReportDate(url.searchParams.get('to'))
    if (!statusResult.success || !agingResult.success || !fromResult.valid || !toResult.valid
      || (fromResult.date && toResult.date && fromResult.date > toResult.date)) {
      return NextResponse.json({ error: 'Los filtros de cuentas por cobrar no son válidos.' }, { status: 400 })
    }
    const currentTime = new Date()
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const agingBounds: Record<string, { gte?: Date; lt?: Date }> = {
      CURRENT: { gte: today },
      '1-30': { gte: new Date(today.getTime() - 30 * 86400000), lt: today },
      '31-60': { gte: new Date(today.getTime() - 60 * 86400000), lt: new Date(today.getTime() - 30 * 86400000) },
      '61-90': { gte: new Date(today.getTime() - 90 * 86400000), lt: new Date(today.getTime() - 60 * 86400000) },
      '90+': { lt: new Date(today.getTime() - 90 * 86400000) },
    }
    const accountFilters: Prisma.AccountReceivableWhereInput[] = []
    if (statusResult.data === 'OVERDUE') {
      accountFilters.push({ status: { notIn: ['PAID', 'CANCELLED'] } }, { balance: { gt: 0 } }, { dueDate: { lt: currentTime } })
    } else if (statusResult.data !== 'ALL') {
      accountFilters.push({ status: statusResult.data })
    }
    if (agingResult.data !== 'ALL') {
      accountFilters.push(
        { status: { notIn: ['PAID', 'CANCELLED'] } },
        { balance: { gt: 0 } },
        { dueDate: agingBounds[agingResult.data] },
      )
    }
    if (fromResult.date) accountFilters.push({ dueDate: { gte: fromResult.date } })
    if (toResult.date) accountFilters.push({ dueDate: { lt: new Date(toResult.date.getTime() + 86400000) } })
    const where: Prisma.AccountReceivableWhereInput = {
      ...(branchContext.isAll ? {} : { sale: { is: scope } }),
      ...(query ? { OR: [
        { number: contains },
        { customer: { name: contains } },
        { customer: { document: contains } },
        { sale: { number: contains } },
      ] } : {}),
      ...(url.searchParams.get('partyId') ? { customerId: url.searchParams.get('partyId')! } : {}),
      ...(accountFilters.length > 0 ? { AND: accountFilters } : {}),
    }
    const total = await prisma.accountReceivable.count({ where })
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)))
    const records = await prisma.accountReceivable.findMany({
      where,
      include: { customer: { select: { name: true, document: true } }, sale: { select: { number: true } } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    const data = records.map((record) => ({
      ...record,
      status: record.status !== 'PAID' && record.status !== 'CANCELLED'
        && Number(record.balance) > 0 && record.dueDate < currentTime
        ? 'OVERDUE'
        : record.status,
      originalAmount: record.originalAmount.toString(),
      paidAmount: record.paidAmount.toString(),
      balance: record.balance.toString(),
    }))
    return NextResponse.json({ data, pagination: pagination(total, page, pageSize) })
  }

  if (parsedType.data === 'cxp') {
    const statusValue = url.searchParams.get('status') ?? 'ALL'
    const agingValue = url.searchParams.get('aging') ?? 'ALL'
    const statusResult = z.enum(['ALL', 'PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED']).safeParse(statusValue)
    const agingResult = z.enum(['ALL', 'CURRENT', '1-30', '31-60', '61-90', '90+']).safeParse(agingValue)
    const fromResult = parseReportDate(url.searchParams.get('from'))
    const toResult = parseReportDate(url.searchParams.get('to'))
    if (!statusResult.success || !agingResult.success || !fromResult.valid || !toResult.valid
      || (fromResult.date && toResult.date && fromResult.date > toResult.date)) {
      return NextResponse.json({ error: 'Los filtros de cuentas por pagar no son válidos.' }, { status: 400 })
    }
    const currentTime = new Date()
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const agingBounds: Record<string, { gte?: Date; lt?: Date }> = {
      CURRENT: { gte: today },
      '1-30': { gte: new Date(today.getTime() - 30 * 86400000), lt: today },
      '31-60': { gte: new Date(today.getTime() - 60 * 86400000), lt: new Date(today.getTime() - 30 * 86400000) },
      '61-90': { gte: new Date(today.getTime() - 90 * 86400000), lt: new Date(today.getTime() - 60 * 86400000) },
      '90+': { lt: new Date(today.getTime() - 90 * 86400000) },
    }
    const accountFilters: Prisma.AccountPayableWhereInput[] = []
    if (statusResult.data === 'OVERDUE') {
      accountFilters.push({ status: { notIn: ['PAID', 'CANCELLED'] } }, { balance: { gt: 0 } }, { dueDate: { lt: currentTime } })
    } else if (statusResult.data !== 'ALL') {
      accountFilters.push({ status: statusResult.data })
    }
    if (agingResult.data !== 'ALL') {
      accountFilters.push(
        { status: { notIn: ['PAID', 'CANCELLED'] } },
        { balance: { gt: 0 } },
        { dueDate: agingBounds[agingResult.data] },
      )
    }
    if (fromResult.date) accountFilters.push({ dueDate: { gte: fromResult.date } })
    if (toResult.date) accountFilters.push({ dueDate: { lt: new Date(toResult.date.getTime() + 86400000) } })
    const where: Prisma.AccountPayableWhereInput = {
      ...(branchContext.isAll ? {} : { purchase: { is: scope } }),
      ...(query ? { OR: [
        { number: contains },
        { supplier: { name: contains } },
        { supplier: { document: contains } },
        { purchase: { number: contains } },
      ] } : {}),
      ...(url.searchParams.get('partyId') ? { supplierId: url.searchParams.get('partyId')! } : {}),
      ...(accountFilters.length > 0 ? { AND: accountFilters } : {}),
    }
    const total = await prisma.accountPayable.count({ where })
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)))
    const records = await prisma.accountPayable.findMany({
      where,
      include: { supplier: { select: { name: true, document: true } }, purchase: { select: { number: true } } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    const data = records.map((record) => ({
      ...record,
      status: record.status !== 'PAID' && record.status !== 'CANCELLED'
        && Number(record.balance) > 0 && record.dueDate < currentTime
        ? 'OVERDUE'
        : record.status,
      originalAmount: record.originalAmount.toString(),
      paidAmount: record.paidAmount.toString(),
      balance: record.balance.toString(),
    }))
    return NextResponse.json({ data, pagination: pagination(total, page, pageSize) })
  }

  if (parsedType.data === 'caja') {
    const where = query ? { account: { is: scope }, OR: [
      { description: contains },
      { reference: contains },
      { account: { name: contains } },
    ] } : { account: { is: scope } }
    const total = await prisma.cashMovement.count({ where })
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)))
    const [movements, accounts] = await Promise.all([
      prisma.cashMovement.findMany({
        where,
        include: { account: { select: { name: true, type: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.cashAccount.findMany({ where: scope, select: { id: true, name: true, type: true, balance: true, isActive: true }, orderBy: { name: 'asc' } }),
    ])
    const grouped = new Map<string, { name: string; type: string; balance: string; movements: typeof movements }>()
    for (const movement of movements) {
      const accountId = movement.accountId
      const account = accounts.find((item) => item.id === accountId)
      const group = grouped.get(accountId) ?? {
        name: movement.account.name,
        type: movement.account.type,
        balance: account?.balance.toString() ?? '0',
        movements: [],
      }
      group.movements.push(movement)
      grouped.set(accountId, group)
    }
    const data = Array.from(grouped.values()).map((account) => ({
      ...account,
      movements: account.movements.map((movement) => ({ ...movement, amount: movement.amount.toString() })),
    }))
    return NextResponse.json({
      data,
      pagination: pagination(total, page, pageSize),
      cashAccountsSummary: accounts.filter((account) => account.isActive).map((account) => ({ name: account.name, type: account.type, balance: Number(account.balance) })),
    })
  }

  if (parsedType.data === 'inventario') {
    const where: Prisma.ProductWhereInput = query ? { OR: [
      { name: contains },
      { sku: contains },
      { category: { name: contains } },
    ] } : {}
    const total = await prisma.product.count({ where })
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)))
    const records = await prisma.product.findMany({
      where,
      include: { category: true, branchStocks: { where: scope, select: { quantity: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    const data = records.map((product) => ({ ...product, currentStock: branchContext.branchId ? product.branchStocks[0]?.quantity ?? 0 : product.currentStock, branchStocks: undefined, cost: product.cost.toString(), price: product.price.toString() }))
    return NextResponse.json({ data, pagination: pagination(total, page, pageSize) })
  }

  const where = query ? { OR: [
    { name: contains },
    { document: contains },
    { email: contains },
  ], isActive: true } : { isActive: true }
  const total = await prisma.supplier.count({ where })
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)))
  const data = await prisma.supplier.findMany({
    where,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  })
  return NextResponse.json({ data, pagination: pagination(total, page, pageSize) })
}
