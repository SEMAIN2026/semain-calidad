import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchPVs } from '@/lib/almacen-client'
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
        // Sort by score descending and take the best matches
        scored.sort((a, b) => b.score - a.score)
        for (const s of scored) {
          if (!matchedItems.find(m => m.id === s.item.id)) {
            matchedItems.push(s.item)
          }
        }
      }

      if (!matchedItems.length) {
        shippingResult.notMatched++
        continue
      }

      // Update each matched item, handling partials
      for (const it of matchedItems) {
        // Determine onTime: compare ship date with estimated delivery date
        let onTime = true
        if (shipDate && it.fechaEntregaEstimada) {
          onTime = shipDate <= it.fechaEntregaEstimada
        }
        const newStatus = onTime ? 'a_tiempo' : 'tarde'

        // Try to find the specific shipping item that matched this calidadItem
        // by re-scoring each shipping item description against this item's concepto
        let matchedShippingItem: { qty?: string | number; pkg?: string } | null = null
        let bestItemScore = 0
        for (const sItem of (rec.items || [])) {
          const pkg = sItem.pkg || ''
          const s = matchScore(it.concepto, pkg)
          if (s > bestItemScore) {
            bestItemScore = s
            matchedShippingItem = sItem
          }
        }

        // Parse the shipped quantity from the matched shipping item
        let shippedQty = 0
        if (matchedShippingItem?.qty) {
          shippedQty = parseInt(String(matchedShippingItem.qty), 10) || 0
        }

        const totalQty = it.cantidad || 1
        const alreadyShipped = it.cantidadEnviada || 0

        // Skip if this item was already fully shipped (avoid re-matching)
        if (alreadyShipped >= totalQty) {
          continue
        }

        // Determine if this is a partial shipment
        const isPartial = shippedQty > 0 && shippedQty < (totalQty - alreadyShipped)

        if (isPartial) {
          // PARTIAL: update parent with shippedQty, create child with remaining
          const remaining = totalQty - alreadyShipped - shippedQty
          if (remaining > 0) {
            // Update parent: accumulate shipped quantity
            await db.calidadItem.update({
              where: { id: it.id },
              data: {
                cantidadEnviada: alreadyShipped + shippedQty,
                shippingDate: shipDate,
                shippingStatus: newStatus,
                shippingSynced: true,
                guia: guia,
                paqueteria: paqueteria,
                embarque: 'x',
                // Keep estado as EN TIEMPO/ATRASADO since there's remaining
                estado: alreadyShipped + shippedQty >= totalQty ? 'Entregado' : it.estado,
              },
            })

            // Create child item with remaining quantity
            // Check if a child already exists for this parent with similar characteristics
            const existingChild = await db.calidadItem.findFirst({
              where: {
                parentId: it.id,
                cantidad: remaining,
                esParcial: true,
              },
            })

            if (!existingChild) {
              const maxLineItem = await db.calidadItem.findFirst({
                where: { pvNumber: it.pvNumber },
                orderBy: { itemLine: 'desc' },
              })
              const newItemLine = (maxLineItem?.itemLine || 0) + 1

              await db.calidadItem.create({
                data: {
                  pvNumber: it.pvNumber,
                  itemLine: newItemLine,
                  cliente: it.cliente,
                  concepto: it.concepto,
                  clave: it.clave,
                  cantidad: remaining,
                  fechaPv: it.fechaPv,
                  fechaInicio: it.fechaInicio,
                  teTexto: it.teTexto,
                  teDias: it.teDias,
                  fechaEntregaEstimada: it.fechaEntregaEstimada,
                  fechaReprogramada: it.fechaReprogramada,
                  estado: 'EN TIEMPO',
                  source: 'partial',
                  isManual: false,
                  parentId: it.id,
                  partialOf: it.id,
                  esParcial: true,
                  notes: `Restante de envío parcial (${shippedQty} de ${totalQty} enviadas, guía ${guia || 'N/A'})`,
                  archivo: it.archivo,
                },
              })
            }
          }
        } else {
          // FULL shipment (or qty not specified): mark as fully delivered
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
              cantidadEnviada: totalQty,
            },
          })
        }
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
