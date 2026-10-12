// Prisma 7+ configuration file
// See: https://pris.ly/d/config-datasource

import path from 'node:path'
import { defineConfig } from 'prisma/config'
import { PrismaLibSQL } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'

function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ||
    'file:./db/custom.db'
  )
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  // For prisma db push / migrate
  datasource: {
    url: getDatabaseUrl(),
  },
  // Prisma 7 uses an adapter for migrate/push operations when using libsql
  async adapter() {
    const url = getDatabaseUrl()
    if (url.startsWith('libsql://') || url.startsWith('http://') || url.startsWith('https://')) {
      const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
      return new PrismaLibSQL(client)
    }
    return undefined
  },
})
