import { NextResponse } from 'next/server'
import bcrypt from 'bcrypt'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { setBranchCookie } from '@/lib/branches'

const userSchema = z.object({
  name: z.string().trim().min(2).max(120),
  alias: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().email().max(180),
  password: z.string().min(8).max(100),
  role: z.enum(['ADMIN', 'SALES', 'INVENTORY', 'ACCOUNTING', 'VIEWER']),
  branchId: z.string().min(1).nullable().optional(),
})

const updateSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['ADMIN', 'SALES', 'INVENTORY', 'ACCOUNTING', 'VIEWER']).optional(),
  isActive: z.boolean().optional(),
  branchId: z.string().min(1).nullable().optional(),
})

export async function GET(request: Request) {
  const access = await requireAdmin(request)
  if (access.response) return access.response
  const users = await prisma.user.findMany({ select: { id: true, name: true, alias: true, email: true, role: true, branchId: true, branch: { select: { name: true, code: true } }, isActive: true, lastLoginAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json(users)
}

export async function POST(request: Request) {
  const access = await requireAdmin(request)
  if (access.response) return access.response
  const session = access.session
  const payload = userSchema.safeParse(await request.json())
  if (payload.success) {
    const branchId = payload.data.role === 'ADMIN' ? payload.data.branchId ?? null : payload.data.branchId
    if (payload.data.role !== 'ADMIN' && !branchId) {
      return NextResponse.json({ error: 'Asigna una sucursal a todo usuario operativo.' }, { status: 400 })
    }
    if (branchId && !await prisma.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true } })) {
      return NextResponse.json({ error: 'La sucursal no existe o está inactiva.' }, { status: 400 })
    }
  }
  if (!payload.success) return NextResponse.json({ error: 'Revisa nombre, correo, contraseña y rol.' }, { status: 400 })
  const branchId = payload.data.branchId ?? null
  try {
    const passwordHash = await bcrypt.hash(payload.data.password, 12)
    const user = await prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({ data: { name: payload.data.name, alias: payload.data.alias.toLowerCase(), email: payload.data.email.toLowerCase(), passwordHash, role: payload.data.role, branchId }, select: { id: true, name: true, alias: true, email: true, role: true, branchId: true, isActive: true, createdAt: true } })
      await logAudit({
        request,
        userId: session.userId,
        action: 'CREATE',
        moduleName: 'Usuarios',
        entity: 'User',
        entityId: created.id,
        details: `Se creó el usuario ${created.name} (${created.email}) con rol ${created.role}.`,
      }, transaction)
      return created
    })
    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message.includes('Unique constraint') ? 'El correo o alias ya está registrado.' : 'No se pudo crear el usuario.' }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  const access = await requireAdmin(request)
  if (access.response) return access.response
  const session = access.session
  const payload = updateSchema.safeParse(await request.json())
  if (!payload.success) return NextResponse.json({ error: 'Datos de usuario inválidos.' }, { status: 400 })
  if (payload.data.id === session.userId && payload.data.isActive === false) return NextResponse.json({ error: 'No puedes desactivar tu propia cuenta.' }, { status: 400 })
  const currentUser = await prisma.user.findUnique({ where: { id: payload.data.id }, select: { id: true, role: true, branchId: true } })
  if (!currentUser) return NextResponse.json({ error: 'El usuario no existe.' }, { status: 404 })
  const nextRole = payload.data.role ?? currentUser.role
  const nextBranchId = payload.data.branchId === undefined ? currentUser.branchId : payload.data.branchId
  if (nextRole !== 'ADMIN' && !nextBranchId) {
    return NextResponse.json({ error: 'Asigna una sucursal a todo usuario operativo.' }, { status: 400 })
  }
  if (nextBranchId && !await prisma.branch.findFirst({ where: { id: nextBranchId, isActive: true }, select: { id: true } })) {
    return NextResponse.json({ error: 'La sucursal no existe o está inactiva.' }, { status: 400 })
  }
  const user = await prisma.$transaction(async (transaction) => {
    const previousUser = await transaction.user.findUniqueOrThrow({ where: { id: payload.data.id }, select: { id: true, name: true, email: true, role: true, branchId: true, isActive: true } })
    const updated = await transaction.user.update({ where: { id: payload.data.id }, data: { role: payload.data.role, branchId: nextBranchId, isActive: payload.data.isActive }, select: { id: true, name: true, alias: true, email: true, role: true, branchId: true, isActive: true, lastLoginAt: true, createdAt: true } })
    await logAudit({
      request,
      userId: session.userId,
      action: 'UPDATE',
      moduleName: 'Usuarios',
      entity: 'User',
      entityId: updated.id,
      details: `Se actualizó el usuario ${updated.name}. Rol: ${previousUser.role} -> ${updated.role}. Sucursal: ${previousUser.branchId ?? 'Sin asignar'} -> ${updated.branchId ?? 'Sin asignar'}. Estado: ${previousUser.isActive ? 'Activo' : 'Inactivo'} -> ${updated.isActive ? 'Activo' : 'Inactivo'}.`,
      oldValue: { role: previousUser.role, branchId: previousUser.branchId, isActive: previousUser.isActive },
      newValue: { role: updated.role, branchId: updated.branchId, isActive: updated.isActive },
    }, transaction)
    return updated
  })
  const response = NextResponse.json(user)
  if (payload.data.id === session.userId && user.role === 'ADMIN') {
    response.headers.set('Set-Cookie', setBranchCookie(user.branchId ?? 'all'))
  }
  return response
}
