import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL || 'file:./db/custom.db'

  // Use PrismaLibSql adapter for both local file: and remote libsql:// URLs.
  // Prisma 7 requires a driver adapter for all connections.
  const adapter = new PrismaLibSql({
    url: databaseUrl,
    authToken: databaseUrl.startsWith('libsql://') || databaseUrl.startsWith('http')
      ? process.env.TURSO_AUTH_TOKEN
      : undefined,
  })
  return new PrismaClient({ adapter })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
