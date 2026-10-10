import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchPVs } from '@/lib/almacen-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * Sync from Almacen: get all PVs and create one CalidadItem per PV.
 * The PV body contains the full item description as free text.
 * Only INSERT new items; do not overwrite manual edits.
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
    const pvs = await fetchPVs()
    pvsFound = pvs.length

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
          updated++
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
          created++
          itemsFound++
        }
      } catch {
        skipped++
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
      message: error || `Sync OK: ${pvsFound} PVs (created ${created}, updated ${updated}, skipped ${skipped})`,
      itemsCount: created + updated,
    },
  })

  return NextResponse.json({
    ok: !error,
    error,
    stats: { pvsFound, itemsFound, created, updated, skipped, durationMs },
  })
}
