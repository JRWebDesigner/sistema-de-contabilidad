import { NextResponse } from 'next/server'
import bcrypt from 'bcrypt'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { createSessionToken, SESSION_COOKIE, verifySessionToken } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { rolePermissions } from '@/lib/permissions'

const credentialsSchema = z.object({ identifier: z.string().trim().min(1).max(180), alias: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/).optional(), password: z.string().min(8), name: z.string().trim().min(2).max(120).optional() })

function sessionCookie(token: string) {
  return { name: SESSION_COOKIE, value: token, httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 8, path: '/' }
}

export async function POST(request: Request) {
  const action = request.headers.get('x-auth-action') ?? 'login'
  const raw = await request.json().catch(() => ({}))
  const normalized = {
    ...raw,
    identifier: typeof raw?.identifier === 'string' ? raw.identifier.trim() : '',
    alias: typeof raw?.alias === 'string' && raw.alias.trim() ? raw.alias.trim() : undefined,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : undefined,
    password: typeof raw?.password === 'string' ? raw.password : '',
  }
  const payload = credentialsSchema.safeParse(normalized)
  if (!payload.success) return NextResponse.json({ error: 'Correo y contraseña válidos son obligatorios.' }, { status: 400 })

  if (action === 'setup') {
    const passwordHash = await bcrypt.hash(payload.data.password, 12)
    if (!payload.data.alias) return NextResponse.json({ error: 'El alias es obligatorio.' }, { status: 400 })
    let user
    try {
      user = await prisma.$transaction(async (transaction) => {
        if (await transaction.user.count() > 0) throw new Error('INITIAL_ADMIN_EXISTS')
        const created = await transaction.user.create({ data: { name: payload.data.name ?? 'Administrador', alias: payload.data.alias!.toLowerCase(), email: payload.data.identifier.toLowerCase(), passwordHash, role: 'ADMIN' } })
        await logAudit({
          request,
          userId: created.id,
          userName: created.name,
          userEmail: created.email,
          action: 'JOIN',
          moduleName: 'Usuarios',
          entity: 'User',
          entityId: created.id,
          details: `Se registró el usuario ${created.name} como administrador inicial.`,
        }, transaction)
        return created
      }, { isolationLevel: 'Serializable' })
    } catch (error) {
      if (error instanceof Error && error.message === 'INITIAL_ADMIN_EXISTS') {
        return NextResponse.json({ error: 'El administrador inicial ya fue creado.' }, { status: 409 })
      }
      throw error
    }
    const token = await createSessionToken(user.id, user.role)
    const response = NextResponse.json({ user: { id: user.id, name: user.name, alias: user.alias, email: user.email, role: user.role } }, { status: 201 })
    response.cookies.set(sessionCookie(token))
    return response
  }

  const identifier = payload.data.identifier.toLowerCase()
  const user = await prisma.user.findFirst({ where: { OR: [{ email: identifier }, { alias: identifier }] } })
  if (!user || !user.isActive || !(await bcrypt.compare(payload.data.password, user.passwordHash))) return NextResponse.json({ error: 'Correo o contraseña incorrectos.' }, { status: 401 })
  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await logAudit({
      request,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'LOGIN',
      moduleName: 'Autenticación',
      entity: 'User',
      entityId: user.id,
      details: `${user.name} inició sesión en el sistema.`,
    }, transaction)
  })
  const token = await createSessionToken(user.id, user.role)
  const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } })
  response.cookies.set(sessionCookie(token))
  return response
}

export async function GET(request: Request) {
  const token = request.headers.get('cookie')?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${SESSION_COOKIE}=`))?.split('=')[1]
  if (!token) return NextResponse.json({ user: null }, { status: 401 })
  try {
    const session = await verifySessionToken(token)
    const user = session.userId ? await prisma.user.findFirst({ where: { id: session.userId, isActive: true }, select: { id: true, name: true, alias: true, email: true, role: true } }) : null
    return user
      ? NextResponse.json({ user, permissions: rolePermissions(user.role) })
      : NextResponse.json({ user: null }, { status: 401 })
  } catch {
    return NextResponse.json({ user: null }, { status: 401 })
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set({ name: SESSION_COOKIE, value: '', expires: new Date(0), path: '/' })
  return response
}
