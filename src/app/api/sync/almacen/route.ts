import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchAllItemsByPV, type AlmacenItem } from '@/lib/almacen-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Sync from Almacen:
 *   1. Login to https://semain-almacen.vercel.app
 *   2. GET /api/pv-entries -> list of PVs
 *   3. For each PV, GET /api/items?pvNumber=XXX -> items
 *   4. Upsert one CalidadItem per item (key: pvNumber + itemNumber)
 *
 * We only INSERT new items; we do not overwrite manual edits on existing rows
 * (except to mark them as still-present in Almacen).
 */
export async function POST() {
  const startedAt = Date.now()
  let created = 0
  let updated = 0
  let skipped = 0
  let pvsFound = 0
  let itemsFound = 0
  let error: string | null = null

  try {
    const pvData = await fetchAllItemsByPV()
    pvsFound = pvData.length

    for (const { pv, items } of pvData) {
      itemsFound += items.length
      if (!items.length) {
        // Even if no items, register the PV as a single placeholder so the user can see it
        const itemNumber = '0'
        try {
          await db.calidadItem.upsert({
            where: {
              pvNumber_itemNumber: { pvNumber: pv.pvNumber, itemNumber },
            },
            update: {
              description: pv.subject || pv.body || `(PV sin items)`,
              source: 'almacen',
            },
            create: {
              pvNumber: pv.pvNumber,
              itemNumber,
              description: pv.subject || pv.body || `(PV sin items)`,
              quantity: 1,
              estimatedDays: 7,
              source: 'almacen',
              isManual: false,
              status: 'pendiente',
              notes: pv.notes || null,
            },
          })
          created++
        } catch (e) {
          skipped++
        }
        continue
      }

      for (const item of items) {
        const itemNumber = String(item.itemId || item.id || items.indexOf(item) + 1)
        const description = String(item.description || '(sin descripción)')
        const quantity = Number(item.quantity ?? item.cantidad ?? 1) || 1

        try {
          const existing = await db.calidadItem.findUnique({
            where: {
              pvNumber_itemNumber: { pvNumber: pv.pvNumber, itemNumber },
            },
          })
          if (existing) {
            // Only update non-manual fields. Don't clobber user edits.
            await db.calidadItem.update({
              where: { id: existing.id },
              data: {
                description: existing.isManual ? existing.description : description,
                quantity: existing.isManual ? existing.quantity : quantity,
                source: 'almacen',
                notes: existing.notes || (pv.notes ? String(pv.notes) : null) || null,
              },
            })
            updated++
          } else {
            await db.calidadItem.create({
              data: {
                pvNumber: pv.pvNumber,
                itemNumber,
                description,
                quantity,
                estimatedDays: 7,
                source: 'almacen',
                isManual: false,
                status: 'pendiente',
                notes: pv.notes || null,
              },
            })
            created++
          }
        } catch (e) {
          skipped++
        }
      }
    }
  } catch (e: any) {
    error = e?.message || String(e)
  }

  const durationMs = Date.now() - startedAt

  await db.syncLog.create({
    data: {
      source: 'almacen',
      status: error ? 'error' : 'success',
      message: error || `Sync OK: ${pvsFound} PVs, ${itemsFound} items (created ${created}, updated ${updated}, skipped ${skipped})`,
      itemsCount: created + updated,
    },
  })

  return NextResponse.json({
    ok: !error,
    error,
    stats: { pvsFound, itemsFound, created, updated, skipped, durationMs },
  })
}
