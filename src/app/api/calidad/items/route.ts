import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

function computeDaysInfo(item: {
  fechaEntregaEstimada: Date | string | null
  fechaReprogramada: Date | string | null
  shippingDate: Date | string | null
  estado: string
}) {
  const now = new Date()
  // Use reprogramada if available, else estimated
  const target = item.fechaReprogramada
    ? new Date(item.fechaReprogramada)
    : item.fechaEntregaEstimada
      ? new Date(item.fechaEntregaEstimada)
      : null

  if (!target) {
    return { daysRemaining: null, isRetrasado: false }
  }

  const msDiff = target.getTime() - now.getTime()
  const daysRemaining = Math.ceil(msDiff / (1000 * 60 * 60 * 24))

  // If past the date and not shipped (no shippingDate), it's retrasado
  const shipped = !!item.shippingDate
  const isRetrasado = daysRemaining < 0 && !shipped

  return { daysRemaining, isRetrasado }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const estado = searchParams.get('estado')
  const shippingStatus = searchParams.get('shippingStatus')
  const pv = searchParams.get('pv')
  const cliente = searchParams.get('cliente')
  const q = searchParams.get('q')

  const where: any = {}
  if (estado) where.estado = estado
  if (shippingStatus) where.shippingStatus = shippingStatus
  if (pv) where.pvNumber = { contains: pv }
  if (cliente) where.cliente = { contains: cliente }
  if (q) {
    where.OR = [
      { pvNumber: { contains: q } },
      { concepto: { contains: q } },
      { cliente: { contains: q } },
      { clave: { contains: q } },
      { notes: { contains: q } },
    ]
  }

  const items = await db.calidadItem.findMany({
    where,
    orderBy: [
      // Most recent PVs first (by fechaPv desc, fallback to createdAt)
      { fechaPv: 'desc' },
      { createdAt: 'desc' },
      // Within a PV, keep itemLine order
      { pvNumber: 'asc' },
      { itemLine: 'asc' },
    ],
  })

  // Get all child items for the items in this query (to show partial info)
  const parentIds = items.filter(it => !it.parentId).map(it => it.id)
  const children = parentIds.length > 0
    ? await db.calidadItem.findMany({
        where: { parentId: { in: parentIds } },
        orderBy: { itemLine: 'asc' },
      })
    : []
  const childrenByParent = new Map<string, typeof children>()
  for (const c of children) {
    const arr = childrenByParent.get(c.parentId!) || []
    arr.push(c)
    childrenByParent.set(c.parentId!, arr)
  }

  // Enrich with days info, auto-mark retrasados, and partial info
  const enriched = items.map(it => {
    const { daysRemaining, isRetrasado } = computeDaysInfo(it)
    let autoEstado = it.estado
    if (isRetrasado && it.estado !== 'Entregado' && it.estado !== 'ATRASADO') {
      autoEstado = 'ATRASADO'
    }
    const childItems = childrenByParent.get(it.id) || []
    return {
      ...it,
      estado: autoEstado,
      daysRemaining,
      isRetrasado,
      childItems: childItems.map(c => ({
        id: c.id,
        cantidad: c.cantidad,
        estado: c.estado,
        itemLine: c.itemLine,
      })),
      cantidadPendiente: Math.max(0, (it.cantidad || 0) - (it.cantidadEnviada || 0)),
    }
  })

  return NextResponse.json({ data: enriched })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const {
    pvNumber, itemLine, cliente, concepto, clave, cantidad,
    fechaPv, fechaInicio, teTexto, teDias,
    fechaEntregaEstimada, fechaReprogramada,
    estado, embarque, notes, archivo,
  } = body

  if (!pvNumber || !concepto) {
    return NextResponse.json(
      { error: 'pvNumber y concepto son obligatorios' },
      { status: 400 }
    )
  }

  const line = Number(itemLine) || 1

  const existing = await db.calidadItem.findUnique({
    where: { pvNumber_itemLine: { pvNumber: String(pvNumber), itemLine: line } },
  })
  if (existing) {
    return NextResponse.json(
      { error: `Ya existe un item con PV ${pvNumber} línea ${line}` },
      { status: 409 }
    )
  }

  const created = await db.calidadItem.create({
    data: {
      pvNumber: String(pvNumber),
      itemLine: line,
      cliente: cliente || null,
      concepto: String(concepto),
      clave: clave || null,
      cantidad: Number(cantidad) || 1,
      fechaPv: fechaPv ? new Date(fechaPv) : null,
      fechaInicio: fechaInicio ? new Date(fechaInicio) : null,
      teTexto: teTexto || null,
      teDias: teDias ? Number(teDias) : null,
      fechaEntregaEstimada: fechaEntregaEstimada ? new Date(fechaEntregaEstimada) : null,
      fechaReprogramada: fechaReprogramada ? new Date(fechaReprogramada) : null,
      estado: estado || 'EN TIEMPO',
      embarque: embarque || null,
      notes: notes || null,
      archivo: archivo || null,
      isManual: true,
      source: 'manual',
    },
  })

  return NextResponse.json({ data: created }, { status: 201 })
}
