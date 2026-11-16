import { NextResponse } from 'next/server'
import bcrypt from 'bcrypt'
import { z } from 'zod'

import { getSession } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/db'

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  alias: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().trim().email().max(180),
  currentPassword: z.string().min(8).max(100).optional(),
  newPassword: z.string().min(8).max(100).optional(),
}).refine((profile) => Boolean(profile.currentPassword) === Boolean(profile.newPassword), {
  message: 'Para cambiar la contraseña, ingresa la contraseña actual y la nueva.',
  path: ['newPassword'],
})

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

export async function PATCH(request: Request) {
  const session = await getSession(request)
  if (!session?.userId) return NextResponse.json({ error: 'Sesión requerida.' }, { status: 401 })

  const payload = profileSchema.safeParse(await request.json())
  if (!payload.success) {
    return NextResponse.json({ error: payload.error.issues[0]?.message ?? 'Revisa los datos del perfil.' }, { status: 400 })
  }

  const profile = payload.data
  const name = profile.name.trim()
  const alias = profile.alias.trim().toLowerCase()
  const email = profile.email.trim().toLowerCase()
  const currentUser = await prisma.user.findFirst({
    where: { id: session.userId, isActive: true },
    select: { id: true, name: true, alias: true, email: true, passwordHash: true },
  })
  if (!currentUser) return NextResponse.json({ error: 'La cuenta no está disponible.' }, { status: 401 })

  let passwordHash: string | undefined
  if (profile.newPassword) {
    if (!profile.currentPassword) {
      return NextResponse.json({ error: 'Ingresa la contraseña actual antes de elegir una nueva.' }, { status: 400 })
    }
    const matchesCurrentPassword = await bcrypt.compare(profile.currentPassword, currentUser.passwordHash)
    if (!matchesCurrentPassword) {
      return NextResponse.json({ error: 'La contraseña actual no es correcta.' }, { status: 400 })
    }
    passwordHash = await bcrypt.hash(profile.newPassword, 12)
  }

  try {
    const user = await prisma.$transaction(async (transaction) => {
      const update = await transaction.user.updateMany({
        where: { id: session.userId, isActive: true },
        data: {
          name,
          alias,
          email,
          ...(passwordHash ? { passwordHash } : {}),
        },
      })
      if (update.count !== 1) throw new Error('PROFILE_ACCOUNT_UNAVAILABLE')

      const updatedUser = await transaction.user.findUniqueOrThrow({
        where: { id: session.userId },
        select: { id: true, name: true, alias: true, email: true, role: true },
      })
      await logAudit({
        request,
        action: 'UPDATE',
        moduleName: 'Usuarios',
        entity: 'User',
        entityId: updatedUser.id,
        details: `El usuario ${updatedUser.name} actualizó su perfil.`,
        oldValue: { name: currentUser.name, alias: currentUser.alias, email: currentUser.email },
        newValue: { name: updatedUser.name, alias: updatedUser.alias, email: updatedUser.email },
      }, transaction)
      return updatedUser
    })

    return NextResponse.json({ user })
  } catch (error) {
    if (error instanceof Error && error.message === 'PROFILE_ACCOUNT_UNAVAILABLE') {
      return NextResponse.json({ error: 'La cuenta ya no está disponible.' }, { status: 401 })
    }
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: 'Ese correo o alias ya está registrado.' }, { status: 409 })
    }
    console.error('ERROR_UPDATING_PROFILE', error)
    return NextResponse.json({ error: 'No se pudo actualizar el perfil.' }, { status: 500 })
  }
}
