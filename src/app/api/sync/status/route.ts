import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const lastAlmacen = await db.syncLog.findFirst({
    where: { source: 'almacen' },
    orderBy: { createdAt: 'desc' },
  })
  const lastShipping = await db.syncLog.findFirst({
    where: { source: 'shipping' },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    almacen: lastAlmacen
      ? { status: lastAlmacen.status, message: lastAlmacen.message, createdAt: lastAlmacen.createdAt }
      : null,
    shipping: lastShipping
      ? { status: lastShipping.status, message: lastShipping.message, createdAt: lastShipping.createdAt }
      : null,
  })
}
