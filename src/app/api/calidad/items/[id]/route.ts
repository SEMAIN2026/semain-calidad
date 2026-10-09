import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await db.calidadItem.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  return NextResponse.json({ data: item })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const existing = await db.calidadItem.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const data: any = {}
  for (const k of [
    'pvNumber', 'itemNumber', 'description', 'notes', 'status',
  ]) {
    if (k in body) data[k] = body[k] === null ? null : String(body[k])
  }
  if ('quantity' in body) data.quantity = Number(body.quantity) || 1
  if ('estimatedDays' in body) data.estimatedDays = Number(body.estimatedDays) || 7
  if ('shippingDate' in body) {
    data.shippingDate = body.shippingDate ? new Date(body.shippingDate) : null
  }
  if ('shippingStatus' in body) {
    data.shippingStatus = body.shippingStatus || null
  }
  if ('shippingSynced' in body) data.shippingSynced = !!body.shippingSynced

  // If key fields changed, check uniqueness against other rows
  if (data.pvNumber || data.itemNumber) {
    const pv = data.pvNumber ?? existing.pvNumber
    const it = data.itemNumber ?? existing.itemNumber
    const dup = await db.calidadItem.findUnique({
      where: { pvNumber_itemNumber: { pvNumber: pv, itemNumber: it } },
    })
    if (dup && dup.id !== id) {
      return NextResponse.json(
        { error: `Ya existe otro item con PV ${pv} e item ${it}` },
        { status: 409 }
      )
    }
  }

  const updated = await db.calidadItem.update({ where: { id }, data })
  return NextResponse.json({ data: updated })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await db.calidadItem.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  }
}
