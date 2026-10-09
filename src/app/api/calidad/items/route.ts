import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeTimeInfo } from '@/lib/time-tracking'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const shippingStatus = searchParams.get('shippingStatus')
  const pv = searchParams.get('pv')
  const q = searchParams.get('q')

  const where: any = {}
  if (status) where.status = status
  if (shippingStatus) where.shippingStatus = shippingStatus
  if (pv) where.pvNumber = { contains: pv }
  if (q) {
    where.OR = [
      { pvNumber: { contains: q } },
      { description: { contains: q } },
      { itemNumber: { contains: q } },
      { notes: { contains: q } },
    ]
  }

  const items = await db.calidadItem.findMany({
    where,
    orderBy: [{ shippingStatus: 'asc' }, { createdAt: 'desc' }],
  })

  const withTime = items.map(it => ({
    ...it,
    time: computeTimeInfo({
      createdAt: it.createdAt,
      estimatedDays: it.estimatedDays,
      status: it.status,
      shippingStatus: it.shippingStatus,
      shippingSynced: it.shippingSynced,
    }),
  }))

  return NextResponse.json({ data: withTime })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const {
    pvNumber,
    itemNumber,
    description,
    quantity,
    estimatedDays,
    notes,
    status,
    shippingDate,
    shippingStatus,
  } = body

  if (!pvNumber || !itemNumber || !description) {
    return NextResponse.json(
      { error: 'pvNumber, itemNumber y description son obligatorios' },
      { status: 400 }
    )
  }

  const existing = await db.calidadItem.findUnique({
    where: { pvNumber_itemNumber: { pvNumber: String(pvNumber), itemNumber: String(itemNumber) } },
  })
  if (existing) {
    return NextResponse.json(
      { error: `Ya existe un item con PV ${pvNumber} e item ${itemNumber}` },
      { status: 409 }
    )
  }

  const created = await db.calidadItem.create({
    data: {
      pvNumber: String(pvNumber),
      itemNumber: String(itemNumber),
      description: String(description),
      quantity: Number(quantity) || 1,
      estimatedDays: Number(estimatedDays) || 7,
      notes: notes ? String(notes) : null,
      status: status || 'pendiente',
      shippingDate: shippingDate ? new Date(shippingDate) : null,
      shippingStatus: shippingStatus || null,
      isManual: true,
      source: 'manual',
    },
  })

  return NextResponse.json({ data: created }, { status: 201 })
}
