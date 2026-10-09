import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const info: any = {
    timestamp: new Date().toISOString(),
    env: {
      DATABASE_URL: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 40) + '...' : 'NOT SET',
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN ? `[${process.env.TURSO_AUTH_TOKEN.length} chars]` : 'NOT SET',
      ALMACEN_BASE_URL: process.env.ALMACEN_BASE_URL || 'NOT SET',
      ALMACEN_USERNAME: process.env.ALMACEN_USERNAME ? 'SET' : 'NOT SET',
      SHIPPING_BASE_URL: process.env.SHIPPING_BASE_URL || 'NOT SET',
      SHIPPING_USERNAME: process.env.SHIPPING_USERNAME ? 'SET' : 'NOT SET',
      NODE_ENV: process.env.NODE_ENV,
    },
    checks: {} as any,
  }

  // Check 1: Can we import @prisma/client?
  try {
    const { PrismaClient } = await import('@prisma/client')
    info.checks.prismaImport = 'OK'
    info.checks.prismaClientType = typeof PrismaClient
  } catch (e: any) {
    info.checks.prismaImport = `FAIL: ${e.message}`
  }

  // Check 2: Can we import the adapter?
  try {
    const adapter = await import('@prisma/adapter-libsql')
    info.checks.adapterImport = 'OK'
    info.checks.adapterExports = Object.keys(adapter)
  } catch (e: any) {
    info.checks.adapterImport = `FAIL: ${e.message}`
  }

  // Check 3: Can we import @libsql/client?
  try {
    const libsql = await import('@libsql/client')
    info.checks.libsqlImport = 'OK'
    info.checks.libsqlExports = Object.keys(libsql)
  } catch (e: any) {
    info.checks.libsqlImport = `FAIL: ${e.message}`
  }

  // Check 4: Can we create a PrismaClient?
  try {
    const { PrismaClient } = await import('@prisma/client')
    const { PrismaLibSql } = await import('@prisma/adapter-libsql')
    const { createClient } = await import('@libsql/client')
    const url = process.env.DATABASE_URL || ''
    if (url.startsWith('libsql://') || url.startsWith('http')) {
      const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
      const adapter = new PrismaLibSql(client)
      const prisma = new PrismaClient({ adapter })
      info.checks.prismaClientCreated = 'OK'
      // Try a simple query
      try {
        const result = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table'`
        info.checks.queryRaw = `OK: ${JSON.stringify(result)}`
      } catch (e: any) {
        info.checks.queryRaw = `FAIL: ${e.message}`
      }
    } else {
      const prisma = new PrismaClient()
      info.checks.prismaClientCreated = 'OK (no adapter, file mode)'
      try {
        const result = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table'`
        info.checks.queryRaw = `OK: ${JSON.stringify(result)}`
      } catch (e: any) {
        info.checks.queryRaw = `FAIL: ${e.message}`
      }
    }
  } catch (e: any) {
    info.checks.prismaClientCreated = `FAIL: ${e.message}`
    info.checks.prismaClientStack = e.stack
  }

  // Check 5: Try our db module
  try {
    const { db } = await import('@/lib/db')
    info.checks.dbModuleImport = 'OK'
    const count = await (db as any).calidadItem.count()
    info.checks.calidadItemCount = count
  } catch (e: any) {
    info.checks.dbModuleImport = `FAIL: ${e.message}`
    info.checks.dbModuleStack = e.stack
  }

  return NextResponse.json(info, { status: 200 })
}
