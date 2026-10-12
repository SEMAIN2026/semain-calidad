import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchPVs } from '@/lib/almacen-client'
import { parsePvBody } from '@/lib/pv-parser'
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

const BATCH_SIZE = 50

/** Execute async operations in batches of 50. */
async function batchProcess<T>(items: T[], fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(fn))
  }
}

/**
 * Unified sync with batch processing (50 at a time).
 *
 * Anti-cascade rules:
 * - Track processed items within a run (skip if already queued)
 * - Only create children for ORIGINAL items (not for other children)
 * - Children (esParcial=true) can be matched but don't create grandchildren
 */
export async function POST() {
  const startedAt = Date.now()

  // ---------- ALMACEN SYNC ----------
  let almacenResult = {
    ok: false,
    error: null as string | null,
    pvsFound: 0,
    updated: 0,
    created: 0,
  }

  try {
    const pvs = await fetchPVs()
    almacenResult.pvsFound = pvs.length

    // Load ALL items (to check which PVs already exist)
    const allItemsForAlmacen = await db.calidadItem.findMany({
      where: { parentId: null },
      select: { id: true, pvNumber: true, embarque: true },
    })

    // Build set of existing PV digits
    const existingDigitsSet = new Set<string>()
    for (const it of allItemsForAlmacen) {
      const d = String(it.pvNumber).replace(/\D/g, '')
      if (d) existingDigitsSet.add(d)
    }

    // Build set of Almacen PV digits
    const almacenDigitsSet = new Set<string>()
    for (const pv of pvs) {
      const d = String(pv.pvNumber).replace(/\D/g, '')
      if (d) almacenDigitsSet.add(d)
    }

    // Find items to mark as embarque
    const itemsToUpdate: string[] = []
    for (const it of allItemsForAlmacen) {
      if (it.embarque) continue
      const digits = String(it.pvNumber).replace(/\D/g, '')
      if (almacenDigitsSet.has(digits)) {
        itemsToUpdate.push(it.id)
      }
    }

    // Batch update
    await batchProcess(itemsToUpdate, async (id) => {
      await db.calidadItem.update({ where: { id }, data: { embarque: 'x' } })
    })
    almacenResult.updated = itemsToUpdate.length

    // Also UPDATE existing Almacén items that are missing TE/fechaEntregaEstimada
    // (for items created before the parser was added)
    const itemsNeedingTeUpdate: { id: string; teTexto: string | null; teDias: number | null; fechaEntregaEstimada: Date | null; cliente: string | null; concepto: string | null }[] = []
    for (const pv of pvs) {
      const digits = String(pv.pvNumber).replace(/\D/g, '')
      if (!digits) continue
      // Find existing items for this PV that are from almacen and missing TE
      const existing = allItemsForAlmacen.find(it => {
        const itDigits = String(it.pvNumber).replace(/\D/g, '')
        return itDigits === digits
      })
      if (existing && existing.source === 'almacen') {
        // Check if this item is missing TE info
        // We need to fetch the full item to check teTexto
        const fullItem = await db.calidadItem.findUnique({ where: { id: existing.id } })
        if (fullItem && !fullItem.teTexto) {
          const parsed = parsePvBody(pv.body, pv.subject)
          if (parsed.teTexto) {
            const fechaPv = fullItem.fechaPv || new Date()
            let fechaEntregaEstimada: Date | null = null
            if (parsed.teDias !== null && parsed.teDias !== undefined) {
              fechaEntregaEstimada = new Date(fechaPv)
              fechaEntregaEstimada.setDate(fechaEntregaEstimada.getDate() + parsed.teDias)
            }
            itemsNeedingTeUpdate.push({
              id: existing.id,
              teTexto: parsed.teTexto,
              teDias: parsed.teDias,
              fechaEntregaEstimada,
              cliente: parsed.cliente,
              concepto: parsed.concepto,
            })
          }
        }
      }
    }

    // Batch update TE info
    await batchProcess(itemsNeedingTeUpdate, async (u) => {
      await db.calidadItem.update({
        where: { id: u.id },
        data: {
          teTexto: u.teTexto,
          teDias: u.teDias,
          fechaEntregaEstimada: u.fechaEntregaEstimada,
          ...(u.cliente ? { cliente: u.cliente } : {}),
          ...(u.concepto ? { concepto: u.concepto } : {}),
        },
      })
    })

    // CREATE new items for PVs that don't exist in DB yet
    const newPvsToCreate: any[] = []
    for (const pv of pvs) {
      const digits = String(pv.pvNumber).replace(/\D/g, '')
      if (!digits) continue
      // If this PV doesn't exist in our DB, create an item for it
      if (!existingDigitsSet.has(digits)) {
        // Parse the body to extract structured data
        const parsed = parsePvBody(pv.body, pv.subject)

        // Calculate fechaEntregaEstimada = fechaPv + teDias
        const fechaPv = pv.receivedAt ? new Date(pv.receivedAt) : (pv.createdAt ? new Date(pv.createdAt) : new Date())
        let fechaEntregaEstimada: Date | null = null
        if (parsed.teDias !== null && parsed.teDias !== undefined) {
          fechaEntregaEstimada = new Date(fechaPv)
          fechaEntregaEstimada.setDate(fechaEntregaEstimada.getDate() + parsed.teDias)
        }

        newPvsToCreate.push({
          pvNumber: pv.pvNumber,
          itemLine: 1,
          cliente: parsed.cliente,
          concepto: parsed.concepto || pv.subject || `(PV ${pv.pvNumber})`,
          cantidad: 1,
          fechaPv,
          fechaInicio: fechaPv,
          teTexto: parsed.teTexto,
          teDias: parsed.teDias,
          fechaEntregaEstimada,
          estado: 'EN TIEMPO',
          source: 'almacen',
          isManual: false,
          notes: pv.body || null,
          embarque: 'x',
        })
        // Add to existing set so we don't create duplicates
        existingDigitsSet.add(digits)
      }
    }

    // Batch create
    await batchProcess(newPvsToCreate, async (data) => {
      await db.calidadItem.create({ data })
    })
    almacenResult.created = newPvsToCreate.length

    almacenResult.ok = true
  } catch (e: any) {
    almacenResult.error = e?.message || String(e)
  }

  await db.syncLog.create({
    data: {
      source: 'almacen',
      status: almacenResult.error ? 'error' : 'success',
      message: almacenResult.error
        || `Sync OK: ${almacenResult.pvsFound} PVs, ${almacenResult.updated} marcados, ${almacenResult.created} nuevos`,
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
    partialsCreated: 0,
  }

  try {
    const records = await fetchShippings()
    shippingResult.totalRecords = records.length

    // Load all CalidadItems once
    const allItems = await db.calidadItem.findMany()

    // Build map: pvDigits -> items (for fast lookup)
    const pvDigitsMap = new Map<string, typeof allItems>()
    for (const it of allItems) {
      const digits = String(it.pvNumber).replace(/\D/g, '')
      if (!digits) continue
      const arr = pvDigitsMap.get(digits) || []
      arr.push(it)
      pvDigitsMap.set(digits, arr)
    }

    // Track which items have been processed in THIS run (anti-cascade)
    const processedIds = new Set<string>()

    // Track max itemLine per PV (for creating children)
    const maxLineByPv = new Map<string, number>()
    for (const it of allItems) {
      const cur = maxLineByPv.get(it.pvNumber) || 0
      if (it.itemLine > cur) maxLineByPv.set(it.pvNumber, it.itemLine)
    }

    const updates: { id: string; data: any }[] = []
    const creates: { data: any }[] = []

    for (const rec of records) {
      const shipDate = getShippingDate(rec)
      const { guia, paqueteria } = getTrackingInfo(rec)
      const itemDescriptions = getItemDescriptions(rec)

      if (!shipDate) {
        shippingResult.notMatched++
        continue
      }

      // Extract PV number digits
      const pvDigitsSet = new Set<string>()
      for (const desc of itemDescriptions) {
        extractPVReferences(desc).forEach(d => pvDigitsSet.add(d))
      }
      const extraText = [rec.company_display, rec.notas, rec.file_number]
        .filter(Boolean).join(' ')
      extractPVReferences(extraText).forEach(d => pvDigitsSet.add(d))

      // Find matching items by PV digits (using Map)
      const matchedItems: typeof allItems = []
      const seenIds = new Set<string>()
      for (const digits of pvDigitsSet) {
        for (const it of (pvDigitsMap.get(digits) || [])) {
          if (!seenIds.has(it.id)) {
            matchedItems.push(it)
            seenIds.add(it.id)
          }
        }
      }

      // Fallback: score-based matching
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
          if (!seenIds.has(s.item.id)) {
            matchedItems.push(s.item)
            seenIds.add(s.item.id)
          }
        }
      }

      if (!matchedItems.length) {
        shippingResult.notMatched++
        continue
      }

      for (const it of matchedItems) {
        // ANTI-CASCADE: skip items already processed in this run
        if (processedIds.has(it.id)) continue

        const totalQty = it.cantidad || 1
        const alreadyShipped = it.cantidadEnviada || 0

        // ANTI-REPROCESS: if this item was already synced with THIS EXACT shipping record
        // (same date + same tracking), skip it. This prevents reprocessing the same
        // shipping record on every sync run, but ALLOWS new shipping records to update.
        if (it.shippingSynced && it.shippingDate && guia) {
          const existingDate = new Date(it.shippingDate).toISOString().slice(0, 10)
          const newDate = shipDate.toISOString().slice(0, 10)
          const existingGuia = it.guia || ''
          // Skip ONLY if both date AND tracking match (exact same shipment)
          if (existingDate === newDate && existingGuia === guia) {
            continue
          }
        }

        // If item is already fully shipped AND this is the same shipment (date+guia), skip
        if (alreadyShipped >= totalQty) {
          // But check if this might be a DIFFERENT shipment (new date or new guia)
          if (it.shippingSynced && it.shippingDate) {
            const existingDate = new Date(it.shippingDate).toISOString().slice(0, 10)
            const newDate = shipDate.toISOString().slice(0, 10)
            const existingGuia = it.guia || ''
            // Same shipment already recorded → skip
            if (existingDate === newDate && (existingGuia === guia || !guia)) {
              continue
            }
          }
          // Different shipment for an already-delivered item → this is a new shipment
          // for a restante/parcial, or a duplicate. Skip for now.
          continue
        }

        let onTime = true
        if (shipDate && it.fechaEntregaEstimada) {
          onTime = shipDate <= it.fechaEntregaEstimada
        }
        const newStatus = onTime ? 'a_tiempo' : 'tarde'

        // Find the specific shipping item for quantity
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

        let shippedQty = 0
        if (matchedShippingItem?.qty) {
          shippedQty = parseInt(String(matchedShippingItem.qty), 10) || 0
        }

        const isPartial = shippedQty > 0 && shippedQty < (totalQty - alreadyShipped)

        if (isPartial && !it.parentId) {
          // PARTIAL: only create child if this is an ORIGINAL item (not a child itself)
          const remaining = totalQty - alreadyShipped - shippedQty
          if (remaining > 0) {
            updates.push({
              id: it.id,
              data: {
                cantidadEnviada: alreadyShipped + shippedQty,
                shippingDate: shipDate,
                shippingStatus: newStatus,
                shippingSynced: true,
                guia, paqueteria,
                embarque: 'x',
                estado: alreadyShipped + shippedQty >= totalQty ? 'Entregado' : it.estado,
              },
            })

            const newLine = (maxLineByPv.get(it.pvNumber) || 0) + 1
            maxLineByPv.set(it.pvNumber, newLine)

            creates.push({
              data: {
                pvNumber: it.pvNumber,
                itemLine: newLine,
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
            shippingResult.partialsCreated++
          }
        } else {
          // FULL shipment (or child item receiving a shipment — no grandchildren)
          updates.push({
            id: it.id,
            data: {
              shippingDate: shipDate,
              shippingStatus: newStatus,
              shippingSynced: true,
              guia, paqueteria,
              estado: 'Entregado',
              embarque: 'x',
              cantidadEnviada: totalQty,
            },
          })
        }

        // Mark as processed (anti-cascade)
        processedIds.add(it.id)
        shippingResult.matched++
      }
    }

    // Execute updates in batches of 50
    await batchProcess(updates, async (u) => {
      await db.calidadItem.update({ where: { id: u.id }, data: u.data })
    })

    // Execute creates in batches of 50
    await batchProcess(creates, async (c) => {
      await db.calidadItem.create({ data: c.data })
    })

    shippingResult.ok = true
  } catch (e: any) {
    shippingResult.error = e?.message || String(e)
  }

  await db.syncLog.create({
    data: {
      source: 'shipping',
      status: shippingResult.error ? 'error' : 'success',
      message: shippingResult.error
        || `Sync OK: ${shippingResult.totalRecords} registros, ${shippingResult.matched} matcheados, ${shippingResult.partialsCreated} parciales creados, ${shippingResult.notMatched} sin match`,
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
