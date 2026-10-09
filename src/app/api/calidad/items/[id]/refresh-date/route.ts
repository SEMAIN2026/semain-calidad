import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Refresh shipping date for an item.
 * Used when the user clicks "Actualizar fecha" because the date sometimes changes
 * after the initial sync.
 *
 * Body: { shippingDate?: string (ISO), shippingStatus?: 'a_tiempo' | 'tarde' | 'no_enviado' | null }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const existing = await db.calidadItem.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const data: any = {}

  if ('shippingDate' in body) {
    if (body.shippingDate === null || body.shippingDate === '') {
      data.shippingDate = null
    } else {
      const d = new Date(body.shippingDate)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: 'shippingDate inválida' }, { status: 400 })
      }
      data.shippingDate = d
    }
  }

  if ('shippingStatus' in body) {
    data.shippingStatus = body.shippingStatus || null
  }

  // Mark as manually updated (not from sync)
  data.shippingSynced = false

  const updated = await db.calidadItem.update({ where: { id }, data })
  return NextResponse.json({ data: updated })
}
