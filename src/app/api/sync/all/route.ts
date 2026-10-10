import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchPVs } from '@/lib/almacen-client'
import {
  fetchShippings,
  getMatchingText,
  extractPVReferences,
  getShippingOutcome,
} from '@/lib/shipping-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

/**
 * Unified sync: runs Almacen sync first, then Shipping sync, in one request.
 * Returns a combined summary.
 */
export async function POST() {
  const startedAt = Date.now()

  // ---------- ALMACEN SYNC ----------
  let almacenResult = {
    ok: false,
    error: null as string | null,
    pvsFound: 0,
    itemsFound: 0,
    created: 0,
    updated: 0,
    skipped: 0,
  }

  try {
    const pvs = await fetchPVs()
    almacenResult.pvsFound = pvs.length

    // Create one CalidadItem per PV (key: pvNumber + itemNumber "0")
    // The PV body contains the full item description as free text.
    for (const pv of pvs) {
      const itemNumber = '0'
      const description = pv.subject || pv.body?.slice(0, 200) || `(PV ${pv.pvNumber})`
      const fullNotes = pv.body || null

      try {
        const existing = await db.calidadItem.findUnique({
          where: { pvNumber_itemNumber: { pvNumber: pv.pvNumber, itemNumber } },
        })
        if (existing) {
          await db.calidadItem.update({
            where: { id: existing.id },
            data: {
              description: existing.isManual ? existing.description : description,
              source: 'almacen',
              notes: existing.isManual ? existing.notes : (fullNotes || pv.notes || null),
            },
          })
          almacenResult.updated++
        } else {
          await db.calidadItem.create({
            data: {
              pvNumber: pv.pvNumber,
              itemNumber,
              description,
              quantity: 1,
              estimatedDays: 7,
              source: 'almacen',
              isManual: false,
              status: 'pendiente',
              notes: fullNotes || pv.notes || null,
            },
          })
          almacenResult.created++
          almacenResult.itemsFound++
        }
      } catch {
        almacenResult.skipped++
      }
    }
    almacenResult.ok = true
  } catch (e: any) {
    almacenResult.error = e?.message || String(e)
  }

  // Log almacen sync
  await db.syncLog.create({
    data: {
      source: 'almacen',
      status: almacenResult.error ? 'error' : 'success',
      message: almacenResult.error
        || `Sync OK: ${almacenResult.pvsFound} PVs, ${almacenResult.itemsFound} items (created ${almacenResult.created}, updated ${almacenResult.updated}, skipped ${almacenResult.skipped})`,
      itemsCount: almacenResult.created + almacenResult.updated,
    },
  })

  // ---------- SHIPPING SYNC ----------
  let shippingResult = {
    ok: false,
    error: null as string | null,
    totalRecords: 0,
    matched: 0,
    notMatched: 0,
  }

  try {
    const records = await fetchShippings()
    shippingResult.totalRecords = records.length

    const allItems = await db.calidadItem.findMany()

    // Match by PV reference
    for (const rec of records) {
      const text = getMatchingText(rec)
      const pvRefs = extractPVReferences(text)
      const outcome = getShippingOutcome(rec)

      const candidateItems: typeof allItems = []
      for (const ref of pvRefs) {
        const norm = ref.replace(/^PV/i, '')
        for (const it of allItems) {
          if (pvNumberMatches(it.pvNumber, norm) && !candidateItems.find(c => c.id === it.id)) {
            candidateItems.push(it)
          }
        }
      }
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
        shippingResult.notMatched++
        continue
      }

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
            status: outcome.shipped ? 'enviado' : it.status,
          },
        })
        shippingResult.matched++
      }
    }
    shippingResult.ok = true
  } catch (e: any) {
    shippingResult.error = e?.message || String(e)
  }

  // Log shipping sync
  await db.syncLog.create({
    data: {
      source: 'shipping',
      status: shippingResult.error ? 'error' : 'success',
      message: shippingResult.error
        || `Sync OK: ${shippingResult.totalRecords} registros, ${shippingResult.matched} items matcheados, ${shippingResult.notMatched} sin match`,
      itemsCount: shippingResult.matched,
    },
  })

  const durationMs = Date.now() - startedAt

  return NextResponse.json({
    ok: almacenResult.ok && shippingResult.ok,
    durationMs,
    almacen: almacenResult,
    shipping: shippingResult,
  })
}

function pvNumberMatches(a: string, b: string): boolean {
  const na = String(a).replace(/\D/g, '')
  const nb = String(b).replace(/\D/g, '')
  if (!na || !nb) return false
  return na === nb
}
