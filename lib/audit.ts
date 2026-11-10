import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Prisma } from '@/lib/generated/prisma/client'
import type { PrismaClient } from '@/lib/generated/prisma/client'

export type AuditAction = 'LOGIN' | 'JOIN' | 'CREATE' | 'UPDATE' | 'DELETE' | 'ACCEPT' | 'REJECT' | 'PAYMENT' | 'EXPORT'

export type AuditLogInput = {
  request?: Request
  userId?: string | null
  userName?: string
  userEmail?: string | null
  action: AuditAction
  moduleName: string
  entity: string
  entityId?: string | null
  details: string
  oldValue?: Prisma.InputJsonValue
  newValue?: Prisma.InputJsonValue
}

type AuditClient = Prisma.TransactionClient | PrismaClient

export async function logAudit(input: AuditLogInput, database: AuditClient = prisma) {
  const resolvedRequest = input.request ?? null
  const session = resolvedRequest ? await getSession(resolvedRequest) : null
  const targetUserId = input.userId ?? session?.userId ?? null

  let resolvedUser = null as { id: string; name: string; email: string | null } | null
  if (targetUserId) {
    resolvedUser = await database.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, email: true },
    })
  }

  const userName = input.userName ?? resolvedUser?.name ?? 'Sistema'
  const userEmail = input.userEmail ?? resolvedUser?.email ?? null

  await database.auditLog.create({
    data: {
      userId: resolvedUser?.id ?? null,
      userName,
      userEmail,
      action: input.action,
      moduleName: input.moduleName,
      entity: input.entity,
      entityId: input.entityId ?? null,
      details: input.details,
      oldValue: input.oldValue ?? undefined,
      newValue: input.newValue ?? undefined,
    },
  })
}
