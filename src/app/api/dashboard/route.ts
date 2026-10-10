import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const items = await db.calidadItem.findMany()

  const total = items.length
  const entregado = items.filter(i => i.estado === 'Entregado').length
  const atrasado = items.filter(i => i.estado === 'ATRASADO').length
  const porVencer = items.filter(i => i.estado === 'POR VENCER').length
  const enTiempo = items.filter(i => i.estado === 'EN TIEMPO').length
  const revisar = items.filter(i => i.estado === 'REVISAR' || i.estado === 'REVISAR TE').length

  const shippedOnTime = items.filter(i => i.shippingStatus === 'a_tiempo').length
  const shippedLate = items.filter(i => i.shippingStatus === 'tarde').length
  const notShipped = items.filter(i => !i.shippingStatus).length

  const bySource = {
    manual: items.filter(i => i.source === 'manual').length,
    almacen: items.filter(i => i.source === 'almacen').length,
    excel: items.filter(i => i.source === 'excel').length,
  }

  // Top clientes
  const clienteMap = new Map<string, number>()
  for (const it of items) {
    if (it.cliente) {
      clienteMap.set(it.cliente, (clienteMap.get(it.cliente) || 0) + 1)
    }
  }
  const topClientes = Array.from(clienteMap.entries())
    .map(([cliente, count]) => ({ cliente, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Top PVs
  const pvMap = new Map<string, number>()
  for (const it of items) {
    pvMap.set(it.pvNumber, (pvMap.get(it.pvNumber) || 0) + 1)
  }
  const topPvs = Array.from(pvMap.entries())
    .map(([pv, count]) => ({ pv, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const totalShipped = shippedOnTime + shippedLate
  const onTimeRate = totalShipped > 0 ? Math.round((shippedOnTime / totalShipped) * 100) : 0

  // Distribution by estado (donut)
  const statusDistribution = [
    { name: 'Entregado', value: entregado, color: '#10b981' },
    { name: 'Atrasado', value: atrasado, color: '#ef4444' },
    { name: 'Por vencer', value: porVencer, color: '#f59e0b' },
    { name: 'En tiempo', value: enTiempo, color: '#3b82f6' },
    { name: 'Revisar', value: revisar, color: '#8b5cf6' },
  ].filter(s => s.value > 0)

  // On-time rate trend (last 14 days)
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
    entregado,
    atrasado,
    porVencer,
    enTiempo,
    revisar,
    shippedOnTime,
    shippedLate,
    notShipped,
    bySource,
    topClientes,
    topPvs,
    onTimeRate,
    statusDistribution,
    onTimeTrend: days,
  })
}
