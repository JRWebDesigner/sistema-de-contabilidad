import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAnyPermission, rolePermissions } from '@/lib/permissions'
import { resolveBranchContext, branchContextError } from '@/lib/branches'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'

const archiveTypeSchema = z.enum([
  'CUSTOMER_STATEMENT_DETAILED',
  'CUSTOMER_STATEMENT_SUMMARY',
  'CUSTOMER_DEBTS',
  'SALES_REPORT',
  'INVENTORY_REPORT',
  'CONTACTS_REPORT',
  'FINANCE_REPORT',
])
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
})
const maxFileSize = 15 * 1024 * 1024

function permittedTypes(permissions: string[]) {
  const types: Array<z.infer<typeof archiveTypeSchema>> = []
  if (permissions.includes('finance:read')) {
    types.push('CUSTOMER_STATEMENT_DETAILED', 'CUSTOMER_STATEMENT_SUMMARY', 'CUSTOMER_DEBTS', 'FINANCE_REPORT')
  }
  if (permissions.includes('sales:read')) types.push('SALES_REPORT')
  if (permissions.includes('inventory:read')) types.push('INVENTORY_REPORT')
  if (permissions.includes('contacts:read')) types.push('CONTACTS_REPORT')
  return types
}

function safeFileName(value: string) {
  const normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180) || 'reporte.pdf'
}

function parseDate(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || value === '') return null
  const parsed = dateSchema.safeParse(value)
  if (!parsed.success) throw new Error('INVALID_PERIOD')
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('INVALID_PERIOD')
  }
  return date
}

export async function GET(request: Request) {
  const access = await requireAnyPermission(request, ['sales:read', 'finance:read'])
  if (access.response) return access.response

  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError

  const url = new URL(request.url)
  const typeValue = url.searchParams.get('type')
  const type = typeValue ? archiveTypeSchema.safeParse(typeValue) : null
  const customerId = url.searchParams.get('customerId')?.trim()
  const query = url.searchParams.get('q')?.trim().slice(0, 120)
  const fromValue = url.searchParams.get('from')
  const toValue = url.searchParams.get('to')
  const fromResult = fromValue ? dateSchema.safeParse(fromValue) : null
  const toResult = toValue ? dateSchema.safeParse(toValue) : null
  const pageResult = z.coerce.number().int().min(1).safeParse(url.searchParams.get('page') ?? '1')
  if (!pageResult.success) return NextResponse.json({ error: 'El número de página no es válido.' }, { status: 400 })
  const allowedTypes = permittedTypes(rolePermissions(access.session.role))

  if (type && !type.success) return NextResponse.json({ error: 'El tipo de documento no es válido.' }, { status: 400 })
  if ((fromResult && !fromResult.success) || (toResult && !toResult.success) || (fromValue && toValue && fromValue > toValue)) {
    return NextResponse.json({ error: 'El rango de fechas no es válido.' }, { status: 400 })
  }
  if (type?.success && !allowedTypes.includes(type.data)) {
    return NextResponse.json({ error: 'No tienes permiso para consultar este tipo de documento.' }, { status: 403 })
  }

  const where = {
    type: type?.success ? type.data : { in: allowedTypes },
    ...(branchContext.isAll ? {} : { branchId: branchContext.branchId }),
    ...(customerId ? { customerId } : {}),
    ...(query ? { OR: [{ title: { contains: query, mode: 'insensitive' as const } }, { fileName: { contains: query, mode: 'insensitive' as const } }] } : {}),
    ...((fromValue || toValue) ? {
      AND: [
        ...(fromValue ? [{ periodEnd: { gte: new Date(`${fromValue}T00:00:00.000Z`) } }] : []),
        ...(toValue ? [{ periodStart: { lte: new Date(`${toValue}T00:00:00.000Z`) } }] : []),
      ],
    } : {}),
  }
  const [reports, total] = await Promise.all([
    prisma.archivedReport.findMany({
      where,
    select: {
      id: true,
      title: true,
      type: true,
      source: true,
      fileName: true,
      sizeBytes: true,
      periodStart: true,
      periodEnd: true,
      createdAt: true,
      customer: { select: { id: true, name: true, document: true } },
      branch: { select: { id: true, name: true } },
      createdBy: { select: { name: true, alias: true } },
    },
    orderBy: { createdAt: 'desc' },
      take: 50,
      skip: (pageResult.data - 1) * 50,
    }),
    prisma.archivedReport.count({ where }),
  ])

  return NextResponse.json({ data: reports, pagination: { page: pageResult.data, pageSize: 50, total, totalPages: Math.ceil(total / 50) } })
}

export async function POST(request: Request) {
  const access = await requireAnyPermission(request, ['sales:read', 'inventory:read', 'finance:read', 'contacts:read'])
  if (access.response) return access.response

  const branchContext = await resolveBranchContext(request, access.session)
  const branchError = branchContextError(branchContext)
  if (branchError) return branchError

  try {
    const formData = await request.formData()
    const typeResult = archiveTypeSchema.safeParse(formData.get('type'))
    const sourceValue = formData.get('source')
    const titleValue = formData.get('title')
    const customerValue = formData.get('customerId')
    const file = formData.get('file')
    const permissions = rolePermissions(access.session.role)

    if (!typeResult.success || (sourceValue !== 'GENERATED' && sourceValue !== 'IMPORTED')) {
      return NextResponse.json({ error: 'Selecciona un tipo de documento válido.' }, { status: 400 })
    }
    if (sourceValue === 'IMPORTED' && !permissions.includes('finance:write')) {
      return NextResponse.json({ error: 'No tienes permiso para importar documentos.' }, { status: 403 })
    }
    if (!permittedTypes(permissions).includes(typeResult.data)) {
      return NextResponse.json({ error: 'No tienes permiso para archivar este tipo de documento.' }, { status: 403 })
    }
    if (typeof titleValue !== 'string' || !titleValue.trim() || titleValue.trim().length > 180) {
      return NextResponse.json({ error: 'El nombre debe tener entre 1 y 180 caracteres.' }, { status: 400 })
    }
    if (!(file instanceof File) || file.size === 0 || file.size > maxFileSize) {
      return NextResponse.json({ error: 'El PDF debe pesar menos de 15 MB.' }, { status: 400 })
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Solo se permiten archivos PDF.' }, { status: 400 })
    }

    const content = Buffer.from(await file.arrayBuffer())
    if (content.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return NextResponse.json({ error: 'El archivo no contiene un PDF válido.' }, { status: 400 })
    }

    const periodStart = parseDate(formData.get('periodStart'))
    const periodEnd = parseDate(formData.get('periodEnd'))
    if ((periodStart && !periodEnd) || (!periodStart && periodEnd) || (periodStart && periodEnd && periodStart > periodEnd)) {
      return NextResponse.json({ error: 'Indica un rango de fechas válido y completo.' }, { status: 400 })
    }
    const customerId = typeof customerValue === 'string' && customerValue ? customerValue : null
    const customerRequired = ['CUSTOMER_STATEMENT_DETAILED', 'CUSTOMER_STATEMENT_SUMMARY', 'CUSTOMER_DEBTS'].includes(typeResult.data)
    if (customerRequired && !customerId) {
      return NextResponse.json({ error: 'Selecciona el cliente del estado de cuenta.' }, { status: 400 })
    }
    if (customerId) {
      const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } })
      if (!customer) return NextResponse.json({ error: 'No se encontró el cliente seleccionado.' }, { status: 404 })
    }

    const report = await prisma.$transaction(async (transaction) => {
      const created = await transaction.archivedReport.create({
        data: {
          title: titleValue.trim(),
          type: typeResult.data,
          source: sourceValue,
          fileName: safeFileName(file.name),
          sizeBytes: content.byteLength,
          content,
          periodStart,
          periodEnd,
          customerId,
          branchId: branchContext.branchId,
          createdById: access.session.userId,
        },
        select: { id: true, title: true, type: true, source: true },
      })
      await logAudit({
        request,
        action: 'CREATE',
        moduleName: 'Archivo de reportes',
        entity: 'ArchivedReport',
        entityId: created.id,
        details: `Se archivó el documento ${created.title}.`,
      }, transaction)
      return created
    })
    return NextResponse.json(report, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_PERIOD') {
      return NextResponse.json({ error: 'El período indicado no es válido.' }, { status: 400 })
    }
    console.error('ERROR_CREATING_ARCHIVED_REPORT', error)
    return NextResponse.json({ error: 'No se pudo guardar el documento en el archivo.' }, { status: 500 })
  }
}
