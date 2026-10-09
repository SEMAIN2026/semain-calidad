import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const info: any = {
    timestamp: new Date().toISOString(),
    env: {
      DATABASE_URL: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 50) + '...' : 'NOT SET',
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN ? `[${process.env.TURSO_AUTH_TOKEN.length} chars]` : 'NOT SET',
      NODE_ENV: process.env.NODE_ENV,
    },
    checks: {} as any,
  }

  try {
    const { db } = await import('@/lib/db')
    info.checks.dbModuleImport = 'OK'
    const count = await db.calidadItem.count()
    info.checks.calidadItemCount = count
    const items = await db.calidadItem.findMany({ take: 3 })
    info.checks.sampleItems = items.map(i => ({ pv: i.pvNumber, item: i.itemNumber, desc: i.description.slice(0, 40) }))
  } catch (e: any) {
    info.checks.error = e.message
    info.checks.errorStack = e.stack?.split('\n').slice(0, 5)
  }

  return NextResponse.json(info, { status: 200 })
}
