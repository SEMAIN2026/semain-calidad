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
 * Unified sync: runs Almacén sync first, then Shipping sync, in one request.
 *
 * Almacén sync: fetches PVs and marks items as "embarque=x" if the PV appears
 * in Almacén's records (light touch — the main data source is the Excel import).
 *
 * Shipping sync: fetches shipping records and matches them to CalidadItems
 * by PV number (extracted from the "producto" field) or by concepto substring.
 * Updates shippingDate, shippingStatus, guia, paqueteria.
 */
export async function POST() {
  const startedAt = Date.now()

  // ---------- ALMACEN SYNC ----------
  let almacenResult = {
    ok: false,
    error: null as string | null,
    pvsFound: 0,
    updated: 0,
  }

  try {
    const pvs = await fetchPVs()
    almacenResult.pvsFound = pvs.length

    // For each PV in Almacén, mark the corresponding CalidadItems as embarque="x"
    // (the PV exists in Almacén means it was received/processed)
    for (const pv of pvs) {
      // Normalize PV number: Almacén uses "PV-1598" or "PV1598", Excel uses "PV 1290"
      const pvDigits = String(pv.pvNumber).replace(/\D/g, '')
      if (!pvDigits) continue

      // Find CalidadItems whose pvNumber contains these digits
      const items = await db.calidadItem.findMany({
        where: { pvNumber: { contains: pvDigits } },
      })
      for (const item of items) {
        if (!item.embarque) {
          await db.calidadItem.update({
            where: { id: item.id },
            data: { embarque: 'x' },
          })
          almacenResult.updated++
        }
      }
    }
    almacenResult.ok = true
  } catch (e: any) {
    almacenResult.error = e?.message || String(e)
  }

  await db.syncLog.create({
    data: {
      source: 'almacen',
      status: almacenResult.error ? 'error' : 'success',
      message: almacenResult.error
        || `Sync OK: ${almacenResult.pvsFound} PVs en Almacén, ${almacenResult.updated} items marcados como embarcados`,
      itemsCount: almacenResult.updated,
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

    for (const rec of records) {
      const text = getMatchingText(rec)
      const pvDigitsList = extractPVReferences(text)
      const outcome = getShippingOutcome(rec)

      if (!outcome.shipped) {
        shippingResult.notMatched++
        continue
      }

      // Find matching CalidadItems by PV number digits
      const matchedItems: typeof allItems = []
      for (const digits of pvDigitsList) {
        for (const it of allItems) {
          const itemDigits = String(it.pvNumber).replace(/\D/g, '')
          if (itemDigits === digits && !matchedItems.find(m => m.id === it.id)) {
            matchedItems.push(it)
          }
        }
      }

      // Fallback: match by concepto substring
      if (!matchedItems.length) {
        const productoText = String(rec.producto || '').toLowerCase()
        if (productoText.length > 5) {
          for (const it of allItems) {
            const concepto = it.concepto.toLowerCase()
            if (concepto && (concepto.includes(productoText) || productoText.includes(concepto))) {
              matchedItems.push(it)
            }
          }
        }
      }

      if (!matchedItems.length) {
        shippingResult.notMatched++
        continue
      }

      // Determine onTime by comparing shipping date with estimated delivery
      for (const it of matchedItems) {
        let onTime = true
        if (outcome.date && it.fechaEntregaEstimada) {
          onTime = outcome.date <= it.fechaEntregaEstimada
        }
        const newStatus = onTime ? 'a_tiempo' : 'tarde'

        await db.calidadItem.update({
          where: { id: it.id },
          data: {
            shippingDate: outcome.date,
            shippingStatus: newStatus,
            shippingSynced: true,
            guia: outcome.guia,
            paqueteria: outcome.paqueteria,
            // If shipped, also update estado to "Entregado"
            estado: 'Entregado',
            embarque: 'x',
          },
        })
        shippingResult.matched++
      }
    }
    shippingResult.ok = true
  } catch (e: any) {
    shippingResult.error = e?.message || String(e)
  }

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
