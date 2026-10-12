import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchShippings, extractPVReferences, getItemDescriptions, getShippingDate, getTrackingInfo, matchScore } from '@/lib/shipping-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * Batch sync endpoint: process shipping records in batches of 50.
 * Query params: ?offset=0&limit=50
 * Returns progress info so the UI can call again for the next batch.
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const offset = parseInt(searchParams.get('offset') || '0', 10)
  const limit = parseInt(searchParams.get('limit') || '50', 10)

  const startedAt = Date.now()

  try {
    const records = await fetchShippings()
    const totalRecords = records.length
    const batch = records.slice(offset, offset + limit)

    // Load all CalidadItems for matching
    const allItems = await db.calidadItem.findMany()
    const pvDigitsMap = new Map<string, typeof allItems>()
    for (const it of allItems) {
      const digits = String(it.pvNumber).replace(/\D/g, '')
      if (!digits) continue
      const arr = pvDigitsMap.get(digits) || []
      arr.push(it)
      pvDigitsMap.set(digits, arr)
    }

    let matched = 0
    const updates: { id: string; data: any }[] = []

    for (const rec of batch) {
      const shipDate = getShippingDate(rec)
      const { guia, paqueteria } = getTrackingInfo(rec)
      const itemDescriptions = getItemDescriptions(rec)
      if (!shipDate) continue

      const pvDigitsSet = new Set<string>()
      for (const desc of itemDescriptions) {
        extractPVReferences(desc).forEach(d => pvDigitsSet.add(d))
      }
      const extraText = [rec.company_display, rec.notas, rec.file_number].filter(Boolean).join(' ')
      extractPVReferences(extraText).forEach(d => pvDigitsSet.add(d))

      const matchedItems: typeof allItems = []
      const seenIds = new Set<string>()
      for (const digits of pvDigitsSet) {
        for (const it of (pvDigitsMap.get(digits) || [])) {
          if (!seenIds.has(it.id)) { matchedItems.push(it); seenIds.add(it.id) }
        }
      }

      if (!matchedItems.length && itemDescriptions.length > 0) {
        for (const it of allItems) {
          if (!it.concepto) continue
          for (const desc of itemDescriptions) {
            if (matchScore(it.concepto, desc) >= 50) {
              if (!seenIds.has(it.id)) { matchedItems.push(it); seenIds.add(it.id) }
              break
            }
          }
        }
      }

      for (const it of matchedItems) {
        const onTime = !(shipDate && it.fechaEntregaEstimada && shipDate > it.fechaEntregaEstimada)
        updates.push({
          id: it.id,
          data: {
            shippingDate: shipDate,
            shippingStatus: onTime ? 'a_tiempo' : 'tarde',
            shippingSynced: true,
            guia, paqueteria,
            estado: 'Entregado',
            embarque: 'x',
            cantidadEnviada: it.cantidad,
          },
        })
        matched++
      }
    }

    // Execute updates in parallel (batch is already limited to 50)
    await Promise.all(updates.map(u => db.calidadItem.update({ where: { id: u.id }, data: u.data })))

    const nextOffset = offset + limit
    const hasMore = nextOffset < totalRecords

    return NextResponse.json({
      ok: true,
      offset,
      limit,
      processed: batch.length,
      matched,
      totalRecords,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
      durationMs: Date.now() - startedAt,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}
