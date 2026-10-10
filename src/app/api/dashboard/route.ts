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
  const completed = items.filter(i => i.status === 'completado').length
  const enviado = items.filter(i => i.status === 'enviado').length

  const bySource = {
    manual: items.filter(i => i.source === 'manual').length,
    almacen: items.filter(i => i.source === 'almacen').length,
    excel: items.filter(i => i.source === 'excel').length,
  }

  const byPvMap = new Map<string, number>()
  for (const it of items) {
    byPvMap.set(it.pvNumber, (byPvMap.get(it.pvNumber) || 0) + 1)
  }
  const byPv = Array.from(byPvMap.entries())
    .map(([pv, count]) => ({ pv, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const totalShipped = shippedOnTime + shippedLate
  const onTimeRate = totalShipped > 0 ? Math.round((shippedOnTime / totalShipped) * 100) : 0

  // ---------- CHART: Distribution by status (donut) ----------
  const statusDistribution = [
    { name: 'Pendiente', value: pending, color: '#94a3b8' },
    { name: 'En proceso', value: inProcess, color: '#3b82f6' },
    { name: 'Completado', value: completed, color: '#6366f1' },
    { name: 'Enviado', value: enviado, color: '#10b981' },
  ].filter(s => s.value > 0)

  // ---------- CHART: On-time rate over time (line, last 14 days) ----------
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days: { date: string; label: string; onTime: number; late: number; total: number; rate: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dayStart = new Date(d)
    const dayEnd = new Date(d)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const dayItems = items.filter(it => {
      if (!it.shippingDate) return false
      const sd = new Date(it.shippingDate)
      return sd >= dayStart && sd < dayEnd
    })
    const dayOnTime = dayItems.filter(i => i.shippingStatus === 'a_tiempo').length
    const dayLate = dayItems.filter(i => i.shippingStatus === 'tarde').length
    const dayTotal = dayOnTime + dayLate
    days.push({
      date: dayStart.toISOString().slice(0, 10),
      label: dayStart.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' }),
      onTime: dayOnTime,
      late: dayLate,
      total: dayTotal,
      rate: dayTotal > 0 ? Math.round((dayOnTime / dayTotal) * 100) : 0,
    })
  }

  return NextResponse.json({
    total,
    shippedOnTime,
    shippedLate,
    notShipped,
    warning,
    overdue,
    pending,
    inProcess,
    completed,
    enviado,
    bySource,
    byPv,
    onTimeRate,
    statusDistribution,
    onTimeTrend: days,
  })
}
