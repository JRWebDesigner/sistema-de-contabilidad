import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db'

export type BranchSession = { userId: string; role: string }
export type BranchContext = { branchId: string | null; isAll: boolean }

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const entry = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  if (!entry) return null
  try {
    return decodeURIComponent(entry.slice(name.length + 1))
  } catch {
    return null
  }
}

export async function resolveBranchContext(request: Request, session: BranchSession): Promise<BranchContext> {
  if (session.role === 'ADMIN') {
    const selectedBranch = cookieValue(request, 'superlab-branch')
    if (selectedBranch === 'all') return { branchId: null, isAll: true }
    if (selectedBranch) {
      const branch = await prisma.branch.findFirst({
        where: { id: selectedBranch, isActive: true },
        select: { id: true },
      })
      if (!branch) {
        return { branchId: null, isAll: true }
      }
      return { branchId: branch.id, isAll: false }
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { branchId: true, branch: { select: { isActive: true } } },
    })
    if (!user?.branchId || !user.branch?.isActive) {
      return { branchId: null, isAll: true }
    }
    return { branchId: user.branchId, isAll: false }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { branchId: true, branch: { select: { isActive: true } } },
  })
  return {
    branchId: user?.branch?.isActive ? user.branchId : null,
    isAll: false,
  }
}

export function requireSingleBranch(context: BranchContext) {
  if (context.branchId) return null
  return NextResponse.json(
    { error: context.isAll ? 'Selecciona una sucursal para realizar esta operación.' : 'Tu usuario aún no tiene una sucursal asignada.' },
    { status: 409 },
  )
}

export function branchContextError(context: BranchContext) {
  if (context.branchId || context.isAll) return null
  return NextResponse.json(
    { error: 'Tu usuario aún no tiene una sucursal asignada.' },
    { status: 409 },
  )
}

export function branchWhere(context: BranchContext) {
  if (context.isAll) return {}
  return { branchId: context.branchId }
}

export function setBranchCookie(value: string) {
  return `superlab-branch=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
}
