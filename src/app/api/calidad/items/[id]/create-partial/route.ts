import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Create a partial child item from a parent item.
 *
 * Use case: When a partial shipment is made (e.g. 5 of 10 pieces sent),
 * create a child item with the remaining quantity (5) so we can track
 * the remaining pieces separately.
 *
 * The child item:
 *   - Has the same pvNumber, concepto, cliente, clave
 *   - Gets a new itemLine (max + 1 for that PV)
 *   - parentId = parent.id (linked)
 *   - cantidad = remaining quantity (parent.cantidad - shippedQty)
 *   - esParcial = true
 *   - partialOf = parent.id (for UI display)
 *   - source = "partial"
 *   - Inherits fechaEntregaEstimada, teTexto, teDias from parent
 *
 * Body: { shippedQty: number }  // how many pieces were sent in this partial
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const shippedQty = Number(body.shippedQty)

  if (!shippedQty || shippedQty <= 0) {
    return NextResponse.json({ error: 'shippedQty debe ser un número positivo' }, { status: 400 })
  }

  const parent = await db.calidadItem.findUnique({ where: { id } })
  if (!parent) return NextResponse.json({ error: 'Item no encontrado' }, { status: 404 })

  // Calculate remaining: parent's total - already shipped (cantidadEnviada) - this partial
  const alreadyShipped = parent.cantidadEnviada || 0
  const remaining = parent.cantidad - alreadyShipped - shippedQty

  if (remaining <= 0) {
    return NextResponse.json(
      { error: `No hay piezas suficientes para crear parcial. Total: ${parent.cantidad}, ya enviadas: ${alreadyShipped}, este envío: ${shippedQty}` },
      { status: 400 }
    )
  }

  // Find the max itemLine for this PV to assign a new one
  const maxLineItem = await db.calidadItem.findFirst({
    where: { pvNumber: parent.pvNumber },
    orderBy: { itemLine: 'desc' },
  })
  const newItemLine = (maxLineItem?.itemLine || 0) + 1

  // Update parent: mark as shipped with this partial
  await db.calidadItem.update({
    where: { id },
    data: {
      cantidadEnviada: alreadyShipped + shippedQty,
      embarque: 'x',
      shippingStatus: parent.shippingStatus || 'a_tiempo',
      estado: 'Entregado',
    },
  })

  // Create the child item with the remaining quantity
  const child = await db.calidadItem.create({
    data: {
      pvNumber: parent.pvNumber,
      itemLine: newItemLine,
      cliente: parent.cliente,
      concepto: parent.concepto,
      clave: parent.clave,
      cantidad: remaining,
      fechaPv: parent.fechaPv,
      fechaInicio: parent.fechaInicio,
      teTexto: parent.teTexto,
      teDias: parent.teDias,
      fechaEntregaEstimada: parent.fechaEntregaEstimada,
      fechaReprogramada: parent.fechaReprogramada,
      estado: 'EN TIEMPO',
      source: 'partial',
      isManual: false,
      parentId: parent.id,
      partialOf: parent.id,
      esParcial: true,
      notes: `Restante de envío parcial (${shippedQty} de ${parent.cantidad} enviadas)`,
      archivo: parent.archivo,
    },
  })

  return NextResponse.json({
    ok: true,
    parent: { id: parent.id, cantidadEnviada: alreadyShipped + shippedQty },
    child: { id: child.id, cantidad: remaining },
  })
}
