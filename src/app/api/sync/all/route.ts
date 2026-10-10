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

const BATCH_SIZE = 50

/** Execute async operations in batches to avoid overwhelming the DB. */
async function batchProcess<T>(items: T[], fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(fn))
  }
}

/**
 * Unified sync: runs Almacén sync first, then Shipping sync.
 * Processes DB operations in batches of 50 for speed.
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

    // OPTIMIZATION: Load all CalidadItems ONCE (instead of 160 separate queries)
    const allItems = await db.calidadItem.findMany({
      where: { parentId: null }, // Only parents (children inherit from parent)
      select: { id: true, pvNumber: true, embarque: true },
    })

    // Build a map of pvDigits -> item IDs (in memory, fast)
    const pvDigitsToItems = new Map<string, string[]>()
    for (const it of allItems) {
      const digits = String(it.pvNumber).replace(/\D/g, '')
      if (!digits) continue
      const arr = pvDigitsToItems.get(digits) || []
      arr.push(it.id)
      pvDigitsToItems.set(digits, arr)
    }

    // Collect all Almacen PV digit sets
    const almacenDigitsSet = new Set<string>()
    for (const pv of pvs) {
      const pvDigits = String(pv.pvNumber).replace(/\D/g, '')
      if (pvDigits) almacenDigitsSet.add(pvDigits)
    }

    // Find all items that need to be updated (embarque not set, PV exists in Almacen)
    const itemsToUpdate: string[] = []
    for (const it of allItems) {
      if (it.embarque) continue // already marked
      const digits = String(it.pvNumber).replace(/\D/g, '')
      if (almacenDigitsSet.has(digits)) {
        itemsToUpdate.push(it.id)
      }
    }

    // Batch update: mark all matching items as embarque=x in groups of 50
    await batchProcess(itemsToUpdate, async (id) => {
      await db.calidadItem.update({
        where: { id },
        data: { embarque: 'x' },
      })
    })
    almacenResult.updated = itemsToUpdate.length
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
    partialsCreated: 0,
  }

  try {
    const records = await fetchShippings()
    shippingResult.totalRecords = records.length

    // Load all CalidadItems ONCE (with all fields needed for matching + updates)
    const allItems = await db.calidadItem.findMany()
    // Build a map of pvDigits -> items for fast lookup
    const pvDigitsMap = new Map<string, typeof allItems>()
    for (const it of allItems) {
      const digits = String(it.pvNumber).replace(/\D/g, '')
      if (!digits) continue
      const arr = pvDigitsMap.get(digits) || []
      arr.push(it)
      pvDigitsMap.set(digits, arr)
    }

    // Collect all update operations and create operations
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

      // Find matching CalidadItems by PV number digits (using map, fast)
      const matchedItems: typeof allItems = []
      const seenIds = new Set<string>()
      for (const digits of pvDigitsSet) {
        const candidates = pvDigitsMap.get(digits) || []
        for (const it of candidates) {
          if (!seenIds.has(it.id)) {
            matchedItems.push(it)
            seenIds.add(it.id)
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

      // Process each matched item (collect operations, execute in batch later)
      for (const it of matchedItems) {
        let onTime = true
        if (shipDate && it.fechaEntregaEstimada) {
          onTime = shipDate <= it.fechaEntregaEstimada
        }
        const newStatus = onTime ? 'a_tiempo' : 'tarde'

        // Find the specific shipping item that matched this calidadItem
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

        const totalQty = it.cantidad || 1
        const alreadyShipped = it.cantidadEnviada || 0

        // Skip if this item was already fully shipped
        if (alreadyShipped >= totalQty) {
          continue
        }

        const isPartial = shippedQty > 0 && shippedQty < (totalQty - alreadyShipped)

        if (isPartial) {
          const remaining = totalQty - alreadyShipped - shippedQty
          if (remaining > 0) {
            // Queue parent update
            updates.push({
              id: it.id,
              data: {
                cantidadEnviada: alreadyShipped + shippedQty,
                shippingDate: shipDate,
                shippingStatus: newStatus,
                shippingSynced: true,
                guia,
                paqueteria,
                embarque: 'x',
                estado: alreadyShipped + shippedQty >= totalQty ? 'Entregado' : it.estado,
              },
            })

            // Check if child already exists (in memory, from allItems)
            const existingChild = allItems.find(
              c => c.parentId === it.id && c.cantidad === remaining && c.esParcial
            )

            if (!existingChild) {
              // Find max itemLine for this PV (in memory)
              const pvItems = allItems.filter(a => a.pvNumber === it.pvNumber)
              const maxLine = pvItems.reduce((max, a) => Math.max(max, a.itemLine), 0)
              const newItemLine = maxLine + 1

              creates.push({
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
              shippingResult.partialsCreated++
            }
          }
        } else {
          // FULL shipment: mark as fully delivered
          updates.push({
            id: it.id,
            data: {
              shippingDate: shipDate,
              shippingStatus: newStatus,
              shippingSynced: true,
              guia,
              paqueteria,
              estado: 'Entregado',
              embarque: 'x',
              cantidadEnviada: totalQty,
            },
          })
        }
        shippingResult.matched++
      }
    }

    // Execute all updates in batches of 50
    await batchProcess(updates, async (u) => {
      await db.calidadItem.update({ where: { id: u.id }, data: u.data })
    })

    // Execute all creates in batches of 50
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
