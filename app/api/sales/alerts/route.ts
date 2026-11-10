import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import { requireAnyPermission, rolePermissions } from '@/lib/permissions'
import { branchContextError, branchWhere, resolveBranchContext } from '@/lib/branches'

export async function GET(request: Request) {
  const access = await requireAnyPermission(request, ['sales:read', 'contacts:read'])
  if (access.response) return access.response
  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError
  const scope = branchWhere(branchContext)

  const permissions = rolePermissions(access.session.role)
  const canReadSales = permissions.includes('sales:read')
  const canReadContacts = permissions.includes('contacts:read')
  const now = new Date()
  const proformaWindowEnd = new Date(now)
  proformaWindowEnd.setDate(proformaWindowEnd.getDate() + 3)
  const inactiveSince = new Date(now)
  inactiveSince.setDate(inactiveSince.getDate() - 60)

  const [overdueFollowUps, overdueFollowUpCount, expiringProformas, expiringProformaCount, inactiveCustomers, inactiveCustomerCount] = await Promise.all([
    canReadContacts
      ? prisma.customerFollowUp.findMany({
          where: { status: 'OPEN', dueAt: { lt: now } },
          select: {
            id: true,
            note: true,
            dueAt: true,
            customer: { select: { id: true, name: true } },
          },
          orderBy: { dueAt: 'asc' },
          take: 10,
        })
      : Promise.resolve([]),
    canReadContacts
      ? prisma.customerFollowUp.count({ where: { status: 'OPEN', dueAt: { lt: now } } })
      : Promise.resolve(0),
    canReadSales
      ? prisma.proforma.findMany({
          where: { ...scope, status: 'SENT', validUntil: { gte: now, lte: proformaWindowEnd } },
          select: {
            id: true,
            number: true,
            validUntil: true,
            total: true,
            customer: { select: { id: true, name: true } },
          },
          orderBy: { validUntil: 'asc' },
          take: 10,
        })
      : Promise.resolve([]),
    canReadSales
      ? prisma.proforma.count({ where: { ...scope, status: 'SENT', validUntil: { gte: now, lte: proformaWindowEnd } } })
      : Promise.resolve(0),
    canReadContacts
      ? prisma.customer.findMany({
          where: {
            isActive: true,
            sales: {
              some: { ...scope, status: 'COMPLETED', createdAt: { lt: inactiveSince } },
              none: { ...scope, status: 'COMPLETED', createdAt: { gte: inactiveSince } },
            },
          },
          select: {
            id: true,
            name: true,
            document: true,
            sales: {
              where: { ...scope, status: 'COMPLETED' },
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
          orderBy: { name: 'asc' },
          take: 10,
        })
      : Promise.resolve([]),
    canReadContacts
      ? prisma.customer.count({
          where: {
            isActive: true,
            sales: {
              some: { ...scope, status: 'COMPLETED', createdAt: { lt: inactiveSince } },
              none: { ...scope, status: 'COMPLETED', createdAt: { gte: inactiveSince } },
            },
          },
        })
      : Promise.resolve(0),
  ])

  return NextResponse.json({
    generatedAt: now.toISOString(),
    proformaWindowDays: 3,
    inactiveCustomerDays: 60,
    overdueFollowUps: {
      count: overdueFollowUpCount,
      items: overdueFollowUps,
    },
    expiringProformas: {
      count: expiringProformaCount,
      items: expiringProformas.map((proforma) => ({
        ...proforma,
        total: proforma.total.toString(),
      })),
    },
    inactiveCustomers: {
      count: inactiveCustomerCount,
      items: inactiveCustomers.map((customer) => ({
        id: customer.id,
        name: customer.name,
        document: customer.document,
        lastSaleAt: customer.sales[0]?.createdAt ?? null,
      })),
    },
  })
}
