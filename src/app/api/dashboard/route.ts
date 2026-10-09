import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeTimeInfo } from '@/lib/time-tracking'

export const dynamic = 'force-dynamic'

export async function GET() {
  const items = await db.calidadItem.findMany()

  const enriched = items.map(it => ({
    ...it,
    time: computeTimeInfo({
      createdAt: it.createdAt,
      estimatedDays: it.estimatedDays,
      status: it.status,
      shippingStatus: it.shippingStatus,
      shippingSynced: it.shippingSynced,
    }),
  }))

  const total = items.length
  const shippedOnTime = items.filter(i => i.shippingStatus === 'a_tiempo').length
  const shippedLate = items.filter(i => i.shippingStatus === 'tarde').length
  const notShipped = items.filter(i => !i.shippingStatus || i.shippingStatus === 'no_enviado').length
  const warning = enriched.filter(i => i.time.state === 'warning').length
  const overdue = enriched.filter(i => i.time.state === 'overdue').length
  const pending = items.filter(i => i.status === 'pendiente').length
  const inProcess = items.filter(i => i.status === 'en_proceso').length
  const bySource = {
    manual: items.filter(i => i.source === 'manual').length,
    almacen: items.filter(i => i.source === 'almacen').length,
    excel: items.filter(i => i.source === 'excel').length,
  }

  // Group by PV
  const byPvMap = new Map<string, number>()
  for (const it of items) {
    byPvMap.set(it.pvNumber, (byPvMap.get(it.pvNumber) || 0) + 1)
  }
  const byPv = Array.from(byPvMap.entries())
    .map(([pv, count]) => ({ pv, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // On-time rate
  const totalShipped = shippedOnTime + shippedLate
  const onTimeRate = totalShipped > 0 ? Math.round((shippedOnTime / totalShipped) * 100) : 0

  return NextResponse.json({
    total,
    shippedOnTime,
    shippedLate,
    notShipped,
    warning,
    overdue,
    pending,
    inProcess,
    bySource,
    byPv,
    onTimeRate,
  })
}
