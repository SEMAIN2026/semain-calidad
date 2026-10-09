import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  fetchShippings,
  getMatchingText,
  extractPVReferences,
  getShippingOutcome,
} from '@/lib/shipping-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Sync from Shipping Notice:
 *   1. Login to https://semain-shipping-notice.vercel.app
 *   2. GET /api/shippings (Control de Envíos records)
 *   3. For each shipping record, build a matching text and try to find CalidadItems
 *      whose pvNumber appears in the text or whose description matches.
 *   4. Update matched CalidadItems with shippingDate + shippingStatus.
 *
 * We only UPDATE shipping fields; we never touch Almacen-managed description/quantity.
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

    // Load all CalidadItems once for matching
    const allItems = await db.calidadItem.findMany()
    const byPv = new Map<string, typeof allItems>()
    for (const it of allItems) {
      const arr = byPv.get(it.pvNumber) || []
      arr.push(it)
      byPv.set(it.pvNumber, arr)
    }

    for (const rec of records) {
      const text = getMatchingText(rec)
      const pvRefs = extractPVReferences(text)
      const outcome = getShippingOutcome(rec)

      const candidateItems: typeof allItems = []
      // Match by PV reference first
      for (const ref of pvRefs) {
        const norm = ref.replace(/^PV/i, '')
        for (const [pvNum, arr] of byPv.entries()) {
          if (pvNumberMatches(pvNum, norm)) candidateItems.push(...arr)
        }
      }
      // Fallback: match by description substring
      if (!candidateItems.length) {
        const productText = String(rec.producto || rec.descripcion || '').toLowerCase()
        if (productText.length > 3) {
          for (const it of allItems) {
            const desc = it.description.toLowerCase()
            if (desc && (desc.includes(productText) || productText.includes(desc))) {
              candidateItems.push(it)
            }
          }
        }
      }

      if (!candidateItems.length) {
        notMatched++
        continue
      }

      // Deduplicate
      const seen = new Set<string>()
      for (const it of candidateItems) {
        if (seen.has(it.id)) continue
        seen.add(it.id)

        const newStatus = !outcome.shipped
          ? 'no_enviado'
          : outcome.onTime ? 'a_tiempo' : 'tarde'

        await db.calidadItem.update({
          where: { id: it.id },
          data: {
            shippingDate: outcome.date,
            shippingStatus: newStatus,
            shippingSynced: true,
            // If shipped, also flip the workflow status
            status: outcome.shipped ? 'enviado' : it.status,
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
      message: error || `Sync OK: ${totalRecords} registros, ${matched} items matcheados, ${notMatched} sin match`,
      itemsCount: matched,
    },
  })

  return NextResponse.json({
    ok: !error,
    error,
    stats: { totalRecords, matched, notMatched, durationMs },
  })
}

function pvNumberMatches(a: string, b: string): boolean {
  const na = String(a).replace(/\D/g, '')
  const nb = String(b).replace(/\D/g, '')
  if (!na || !nb) return false
  return na === nb
}
