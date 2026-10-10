import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
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
