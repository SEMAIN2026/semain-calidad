import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

/**
 * Import items from the "SEGUIMIENTO A PV" Excel file.
 * The Excel has a sheet "Lista PV" with columns:
 *   PV | Cliente | Concepto | Fecha PV | Cantidad | Fecha inicio |
 *   TE (texto del PDF) | TE (días) | Fecha entrega estimada |
 *   Dias para la entrega estimada | días de atraso | Embarque | Estado |
 *   Clave | (col vacía) | Archivo | fecha reprogramada de entrega
 *
 * Each row becomes one CalidadItem. Key: pvNumber + itemLine (sequential within PV).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.formData()
    const file = body.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
    }

    // Parse XLSX
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(Buffer.from(buf), { type: 'buffer', cellDates: true })
    const ws = wb.Sheets['Lista PV'] || wb.Sheets[wb.SheetNames[0]]
    if (!ws) {
      return NextResponse.json({ error: 'No se encontró la hoja "Lista PV"' }, { status: 400 })
    }
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })

    if (rows.length < 2) {
      return NextResponse.json({ error: 'El archivo no tiene datos' }, { status: 400 })
    }

    // First row is header
    const header = rows[0]
    // Expected columns (0-indexed):
    // 0=PV, 1=Cliente, 2=Concepto, 3=Fecha PV, 4=Cantidad, 5=Fecha inicio,
    // 6=TE texto, 7=TE días, 8=Fecha entrega estimada, 9=Días para entrega,
    // 10=Días atraso, 11=Embarque, 12=Estado, 13=Clave, 14=(vacía), 15=Archivo, 16=Fecha reprogramada

    let imported = 0
    let updated = 0
    let skipped = 0
    const pvLineCounter = new Map<string, number>()

    // First pass: count lines per PV to assign itemLine
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const pv = String(row[0] ?? '').trim()
      if (!pv) continue
      pvLineCounter.set(pv, (pvLineCounter.get(pv) || 0) + 1)
    }

    // Reset counters for actual insert
    const lineTracker = new Map<string, number>()

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const pvNumber = String(row[0] ?? '').trim()
      if (!pvNumber) { skipped++; continue }

      const concepto = String(row[2] ?? '').trim()
      if (!concepto) { skipped++; continue }

      // Assign sequential itemLine per PV
      const currentLine = (lineTracker.get(pvNumber) || 0) + 1
      lineTracker.set(pvNumber, currentLine)

      const cliente = row[1] ? String(row[1]).trim() : null
      const cantidad = Number(row[4]) || 1
      const fechaPv = parseDate(row[3])
      const fechaInicio = parseDate(row[5])
      const teTexto = row[6] ? String(row[6]).trim() : null
      const teDias = row[7] != null ? Number(row[7]) || null : null
      const fechaEntregaEstimada = parseDate(row[8])
      const estado = row[12] ? String(row[12]).trim() : 'EN TIEMPO'
      const embarque = row[11] ? String(row[11]).trim() : null
      const clave = row[13] ? String(row[13]).trim() : null
      const archivo = row[15] ? String(row[15]).trim() : null
      const fechaReprogramada = parseDate(row[16])

      try {
        const existing = await db.calidadItem.findUnique({
          where: { pvNumber_itemLine: { pvNumber, itemLine: currentLine } },
        })
        if (existing) {
          await db.calidadItem.update({
            where: { id: existing.id },
            data: {
              cliente, concepto, clave, cantidad,
              fechaPv, fechaInicio, teTexto, teDias,
              fechaEntregaEstimada, fechaReprogramada,
              estado, embarque, archivo,
              source: 'excel',
              isManual: false,
            },
          })
          updated++
        } else {
          await db.calidadItem.create({
            data: {
              pvNumber, itemLine: currentLine,
              cliente, concepto, clave, cantidad,
              fechaPv, fechaInicio, teTexto, teDias,
              fechaEntregaEstimada, fechaReprogramada,
              estado, embarque, archivo,
              source: 'excel',
              isManual: false,
            },
          })
          imported++
        }
      } catch (e: any) {
        skipped++
      }
    }

    await db.syncLog.create({
      data: {
        source: 'excel',
        status: 'success',
        message: `Import Excel: ${imported} nuevos, ${updated} actualizados, ${skipped} omitidos`,
        itemsCount: imported + updated,
      },
    })

    return NextResponse.json({
      ok: true,
      imported,
      updated,
      skipped,
      total: imported + updated,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}

function parseDate(v: any): Date | null {
  if (!v) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') {
    // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof v === 'string') {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}
