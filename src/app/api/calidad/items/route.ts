import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

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
    orderBy: [{ estado: 'asc' }, { pvNumber: 'asc' }, { itemLine: 'asc' }],
  })

  return NextResponse.json({ data: items })
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
