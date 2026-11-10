import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { resolveBranchContext, setBranchCookie } from '@/lib/branches'
import { requireAdmin, requireAnyPermission } from '@/lib/permissions'

const branchSchema = z.object({
  action: z.literal('create'),
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/),
  address: z.string().trim().max(250).optional(),
  phone: z.string().trim().max(30).optional(),
})
const selectionSchema = z.object({
  action: z.literal('select'),
  branchId: z.string().min(1),
})

export async function GET(request: Request) {
  const access = await requireAnyPermission(request, ['sales:read', 'inventory:read', 'finance:read'])
  if (access.response) return access.response

  const context = await resolveBranchContext(request, access.session)
  if (access.session.role !== 'ADMIN') {
    if (!context.branchId) {
      return NextResponse.json({ error: 'Tu usuario aún no tiene una sucursal activa asignada.' }, { status: 409 })
    }
    const branch = await prisma.branch.findUnique({ where: { id: context.branchId }, select: { id: true, name: true, code: true } })
    return NextResponse.json({ branches: branch ? [branch] : [], selectedBranchId: branch?.id ?? null, allBranches: false })
  }

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({
    branches,
    selectedBranchId: context.branchId,
    allBranches: context.isAll,
  })
}

export async function POST(request: Request) {
  const access = await requireAdmin(request)
  if (access.response) return access.response
  const body = await request.json()

  const selection = selectionSchema.safeParse(body)
  if (selection.success) {
    const branch = selection.data.branchId === 'all'
      ? null
      : await prisma.branch.findFirst({
          where: { id: selection.data.branchId, isActive: true },
          select: { id: true },
        })
    if (selection.data.branchId !== 'all' && !branch) {
      return NextResponse.json({ error: 'La sucursal no existe o está inactiva.' }, { status: 404 })
    }
    const response = NextResponse.json({ selectedBranchId: branch?.id ?? null, allBranches: !branch })
    response.headers.set('Set-Cookie', setBranchCookie(branch?.id ?? 'all'))
    return response
  }

  const payload = branchSchema.safeParse(body)
  if (!payload.success) {
    return NextResponse.json({ error: 'Revisa el nombre, código y datos de la sucursal.' }, { status: 400 })
  }

  try {
    const branch = await prisma.$transaction(async (transaction) => {
      const created = await transaction.branch.create({
        data: {
          name: payload.data.name,
          code: payload.data.code.toUpperCase(),
          address: payload.data.address || null,
          phone: payload.data.phone || null,
        },
        select: { id: true, name: true, code: true, address: true, phone: true, isActive: true },
      })
      await logAudit({
        request,
        action: 'CREATE',
        moduleName: 'Sucursales',
        entity: 'Branch',
        entityId: created.id,
        details: `Se creó la sucursal ${created.name} (${created.code}).`,
        newValue: { name: created.name, code: created.code },
      }, transaction)
      return created
    })
    return NextResponse.json(branch, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error && error.message.includes('Unique constraint')
        ? 'El nombre o código de la sucursal ya está registrado.'
        : 'No se pudo crear la sucursal.',
    }, { status: 400 })
  }
}
