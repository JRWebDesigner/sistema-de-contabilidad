import { Prisma } from '@/lib/generated/prisma/client'

import type { Prisma as PrismaTypes } from '@/lib/generated/prisma/client'

type DocumentPrefix = 'V' | 'C' | 'P' | 'PED'

export async function nextDocumentNumber(
  transaction: PrismaTypes.TransactionClient,
  prefix: DocumentPrefix,
  actorId: string,
  branchId: string,
) {
  const branch = await transaction.branch.findUnique({
    where: { id: branchId },
    select: { code: true },
  })

  if (!branch?.code) throw new Error('DOCUMENT_BRANCH_NOT_FOUND')
  const branchCode = branch.code
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 1)
    .toUpperCase()

  if (!branchCode) throw new Error('DOCUMENT_BRANCH_CODE_INVALID')

  const actorAlias =
    actorId === 'SYS'
      ? 'SYS'
      : (await transaction.user.findUnique({
          where: { id: actorId },
          select: { alias: true },
        }))?.alias

  if (!actorAlias) throw new Error('DOCUMENT_ACTOR_NOT_FOUND')

  const actorCode =
    actorAlias === 'SYS'
      ? 'SYS'
      : actorAlias
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9]/g, '')
          .slice(0, 2)
          .toUpperCase()

  if (actorCode.length !== 2 && actorCode !== 'SYS') throw new Error('DOCUMENT_ACTOR_ALIAS_TOO_SHORT')

  const [sequence] = await transaction.$queryRaw<Array<{ value: number }>>(Prisma.sql`
    INSERT INTO "DocumentSequence" ("key", "value", "updatedAt")
    VALUES (${prefix}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("key")
    DO UPDATE SET "value" = "DocumentSequence"."value" + 1, "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "value"
  `)

  if (!sequence) throw new Error('DOCUMENT_SEQUENCE_NOT_CREATED')
  return `${prefix}-${branchCode}-${actorCode}${String(sequence.value).padStart(4, '0')}`
}
