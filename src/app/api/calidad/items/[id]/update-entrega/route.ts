import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Update delivery dates for an item.
 * Body: {
 *   fechaEntregaEstimada?: string (ISO) | null,
 *   fechaReprogramada?: string (ISO) | null,
 *   teTexto?: string | null,
 *   teDias?: number | null,
 * }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const existing = await db.calidadItem.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const data: any = {}

  if ('fechaEntregaEstimada' in body) {
    data.fechaEntregaEstimada = body.fechaEntregaEstimada ? new Date(body.fechaEntregaEstimada) : null
  }
  if ('fechaReprogramada' in body) {
    data.fechaReprogramada = body.fechaReprogramada ? new Date(body.fechaReprogramada) : null
  }
  if ('teTexto' in body) {
    data.teTexto = body.teTexto || null
  }
  if ('teDias' in body) {
    data.teDias = body.teDias ? Number(body.teDias) : null
  }

  const updated = await db.calidadItem.update({ where: { id }, data })
  return NextResponse.json({ data: updated })
}
