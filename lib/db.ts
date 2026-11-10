import 'server-only'

import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '@/lib/generated/prisma/client'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL no está configurada')
}

const adapter = new PrismaPg({ connectionString })

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })

export async function serializableTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: 'Serializable' })
    } catch (error) {
      const isSerializationConflict = typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034'
      if (!isSerializationConflict || attempt === 2) throw error
    }
  }

  throw new Error('No se pudo completar la transacción.')
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}