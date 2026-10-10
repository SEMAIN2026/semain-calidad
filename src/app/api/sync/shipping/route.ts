import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  fetchShippings,
  extractPVReferences,
  getItemDescriptions,
  getShippingDate,
  getTrackingInfo,
  matchScore,
} from '@/lib/shipping-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

/**
 * Sync from Shipping Notice (individual endpoint).
 * The unified endpoint /api/sync/all is preferred.
 */
export async function POST() {
  const startedAt = Date.now()
  let matched = 0
  let notMatched = 0
  let totalRecords = 0
  let error: string | null = null

  try {
    const records = await fetchShippings()
    totalRecords = records.length

    const allItems = await db.calidadItem.findMany()

    for (const rec of records) {
      const shipDate = getShippingDate(rec)
      const { guia, paqueteria } = getTrackingInfo(rec)
      const itemDescriptions = getItemDescriptions(rec)

      if (!shipDate) {
        notMatched++
        continue
      }

      const pvDigitsSet = new Set<string>()
      for (const desc of itemDescriptions) {
        const refs = extractPVReferences(desc)
        refs.forEach(d => pvDigitsSet.add(d))
      }

      const matchedItems: typeof allItems = []
      for (const digits of pvDigitsSet) {
        for (const it of allItems) {
          const itemDigits = String(it.pvNumber).replace(/\D/g, '')
          if (itemDigits === digits && !matchedItems.find(m => m.id === it.id)) {
            matchedItems.push(it)
          }
        }
      }

      // Fallback: score-based matching by concepto vs item descriptions
      if (!matchedItems.length && itemDescriptions.length > 0) {
        const scored: { item: typeof allItems[0]; score: number }[] = []
        for (const it of allItems) {
          if (!it.concepto) continue
          let bestScore = 0
          for (const desc of itemDescriptions) {
            const s = matchScore(it.concepto, desc)
            if (s > bestScore) bestScore = s
          }
          if (bestScore >= 50) {
            scored.push({ item: it, score: bestScore })
          }
        }
        scored.sort((a, b) => b.score - a.score)
        for (const s of scored) {
          if (!matchedItems.find(m => m.id === s.item.id)) {
            matchedItems.push(s.item)
          }
        }
      }

      if (!matchedItems.length) {
        notMatched++
        continue
      }

      for (const it of matchedItems) {
        let onTime = true
        if (shipDate && it.fechaEntregaEstimada) {
          onTime = shipDate <= it.fechaEntregaEstimada
        }
        const newStatus = onTime ? 'a_tiempo' : 'tarde'

        await db.calidadItem.update({
          where: { id: it.id },
          data: {
            shippingDate: shipDate,
            shippingStatus: newStatus,
            shippingSynced: true,
            guia,
            paqueteria,
            estado: 'Entregado',
            embarque: 'x',
          },
        })
        matched++
      }
    }
  } catch (e: any) {
    error = e?.message || String(e)
  }

  const durationMs = Date.now() - startedAt

  await db.syncLog.create({
    data: {
      source: 'shipping',
      status: error ? 'error' : 'success',
      message: error || `Sync OK: ${totalRecords} registros, ${matched} matcheados, ${notMatched} sin match`,
      itemsCount: matched,
    },
  })

  return NextResponse.json({
    ok: !error,
    error,
    stats: { totalRecords, matched, notMatched, durationMs },
  })
}
