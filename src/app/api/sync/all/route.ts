import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchPVs } from '@/lib/almacen-client'
import {
  fetchShippings,
  extractPVReferences,
  getItemDescriptions,
  getShippingDate,
  getTrackingInfo,
} from '@/lib/shipping-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

/**
 * Unified sync: runs Almacén sync first, then Shipping sync.
 *
 * Almacén sync: fetches PVs and marks items as "embarque=x" if their PV
 * appears in Almacén's records.
 *
 * Shipping sync: fetches shipping records, extracts product descriptions
 * from items[].pkg, finds PV number references, and matches against
 * CalidadItems. Updates shippingDate, shippingStatus, guia, paqueteria.
 * Determines a_tiempo/tarde by comparing ship_date with fechaEntregaEstimada.
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

    for (const pv of pvs) {
      const pvDigits = String(pv.pvNumber).replace(/\D/g, '')
      if (!pvDigits) continue

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
        || `Sync OK: ${almacenResult.pvsFound} PVs en Almacén, ${almacenResult.updated} items marcados`,
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
      const shipDate = getShippingDate(rec)
      const { guia, paqueteria } = getTrackingInfo(rec)
      const itemDescriptions = getItemDescriptions(rec)

      if (!shipDate) {
        shippingResult.notMatched++
        continue
      }

      // Extract PV number digits from all item descriptions
      const pvDigitsSet = new Set<string>()
      for (const desc of itemDescriptions) {
        const refs = extractPVReferences(desc)
        refs.forEach(d => pvDigitsSet.add(d))
      }

      // Also try the company_display and notas fields
      const extraText = [rec.company_display, rec.notas, rec.file_number]
        .filter(Boolean).join(' ')
      const extraRefs = extractPVReferences(extraText)
      extraRefs.forEach(d => pvDigitsSet.add(d))

      // Find matching CalidadItems by PV number digits
      const matchedItems: typeof allItems = []
      for (const digits of pvDigitsSet) {
        for (const it of allItems) {
          const itemDigits = String(it.pvNumber).replace(/\D/g, '')
          if (itemDigits === digits && !matchedItems.find(m => m.id === it.id)) {
            matchedItems.push(it)
          }
        }
      }

      // Fallback: match by concepto substring against item descriptions
      if (!matchedItems.length && itemDescriptions.length > 0) {
        for (const it of allItems) {
          const concepto = it.concepto.toLowerCase()
          if (!concepto) continue
          for (const desc of itemDescriptions) {
            const descLower = desc.toLowerCase()
            if (concepto.includes(descLower) || descLower.includes(concepto)) {
              if (!matchedItems.find(m => m.id === it.id)) {
                matchedItems.push(it)
              }
              break
            }
          }
        }
      }

      if (!matchedItems.length) {
        shippingResult.notMatched++
        continue
      }

      // Update each matched item
      for (const it of matchedItems) {
        // Determine onTime: compare ship date with estimated delivery date
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
            guia: guia,
            paqueteria: paqueteria,
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
        || `Sync OK: ${shippingResult.totalRecords} registros, ${shippingResult.matched} matcheados, ${shippingResult.notMatched} sin match`,
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
