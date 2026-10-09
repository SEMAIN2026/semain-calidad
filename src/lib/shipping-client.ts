/**
 * Shipping Notice API client (read-only).
 * Source: https://semain-shipping-notice.vercel.app
 * Auth: POST /api/auth/login -> { token, user } -> use as Bearer
 * Data: GET /api/shippings (list of shipments, includes fecha, producto, guia, status, cliente, carrier)
 *       GET /api/registros (records / "Control de Envíos" entries)
 *
 * IMPORTANT: We ONLY read from this API. We never modify any data on the Shipping Notice site.
 *
 * Matching strategy:
 *   The "producto" / "descripcion" field on a shipment record contains a reference to the
 *   PV number or the item description. We use it to link back to CalidadItems.
 */

const SHIPPING_BASE = process.env.SHIPPING_BASE_URL || 'https://semain-shipping-notice.vercel.app'
const SHIPPING_USER = process.env.SHIPPING_USERNAME
const SHIPPING_PASS = process.env.SHIPPING_PASSWORD

let cachedToken: { token: string; expires: number } | null = null

export interface ShippingRecord {
  id?: string | number
  fecha?: string
  fechaEnvio?: string
  producto?: string
  descripcion?: string
  detalle?: string
  guia?: string
  cliente?: string
  client?: string
  carrier?: string
  transportista?: string
  status?: string
  estado?: string
  onTime?: boolean
  invoiceNumber?: string
  factura?: string
  po?: string
  [k: string]: unknown
}

async function login(): Promise<string> {
  if (!SHIPPING_USER || !SHIPPING_PASS) {
    throw new Error('Shipping credentials not configured (SHIPPING_USERNAME / SHIPPING_PASSWORD)')
  }
  const res = await fetch(`${SHIPPING_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: SHIPPING_USER, password: SHIPPING_PASS }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Shipping login failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  const token = data.token || data.accessToken || data.authToken
  if (!token) throw new Error('Shipping login: no token in response')
  cachedToken = { token, expires: Date.now() + 50 * 60 * 1000 }
  return token
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token
  return login()
}

async function authedGet(path: string): Promise<any> {
  const token = await getToken()
  const res = await fetch(`${SHIPPING_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (res.status === 401) {
    cachedToken = null
    const newToken = await getToken()
    const retry = await fetch(`${SHIPPING_BASE}${path}`, {
      headers: { Authorization: `Bearer ${newToken}` },
      cache: 'no-store',
    })
    if (!retry.ok) throw new Error(`Shipping GET ${path} failed after retry: ${retry.status}`)
    return retry.json()
  }
  if (!res.ok) throw new Error(`Shipping GET ${path} failed: ${res.status}`)
  return res.json()
}

/** Get all shipping records (Control de Envíos). */
export async function fetchShippings(): Promise<ShippingRecord[]> {
  // Try /api/shippings first, fall back to /api/registros
  let data: any
  try {
    data = await authedGet('/api/shippings')
  } catch {
    data = await authedGet('/api/registros')
  }
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data?.shippings)) return data.shippings
  if (Array.isArray(data?.registros)) return data.registros
  return []
}

/** Normalize a shipping record into a matchable text blob. */
export function getMatchingText(rec: ShippingRecord): string {
  const parts = [
    rec.producto,
    rec.descripcion,
    rec.detalle,
    rec.po,
    rec.factura,
    rec.invoiceNumber,
  ].filter(Boolean).map(s => String(s).toLowerCase())
  return parts.join(' | ')
}

/** Extract a PV number reference from a shipping record text, e.g. "PV-1234", "PV1234", "P.V. 1234". */
export function extractPVReferences(text: string): string[] {
  if (!text) return []
  const matches = text.match(/p\.?\s*v\.?\s*\d+/gi) || []
  return matches.map(m => m.replace(/\s+/g, '').replace(/\./g, '').toUpperCase())
}

/** Determine if a shipping record indicates a successful / on-time delivery. */
export function getShippingOutcome(rec: ShippingRecord): {
  shipped: boolean
  onTime: boolean
  date: Date | null
} {
  const statusRaw = String(rec.status || rec.estado || '').toLowerCase()
  const hasShipDate = !!(rec.fecha || rec.fechaEnvio)
  const date = rec.fecha ? new Date(rec.fecha) : rec.fechaEnvio ? new Date(rec.fechaEnvio) : null

  // Statuses that indicate the shipment actually went out
  const shippedKeywords = ['enviado', 'entregado', 'transito', 'tránsito', 'despachado', 'shipped', 'delivered', 'completado', 'completed']
  const failedKeywords = ['fallido', 'rechazado', 'cancelado', 'failed', 'cancelled', 'no enviado', 'pendiente']

  const isShipped = hasShipDate || shippedKeywords.some(k => statusRaw.includes(k))
  const isFailed = failedKeywords.some(k => statusRaw.includes(k)) && !isShipped

  // onTime flag
  let onTime = true
  if (typeof rec.onTime === 'boolean') onTime = rec.onTime
  else if (statusRaw.includes('tarde') || statusRaw.includes('retrasado') || statusRaw.includes('atrasado')) onTime = false
  else if (statusRaw.includes('tiempo') || statusRaw.includes('a_tiempo') || statusRaw.includes('puntual')) onTime = true

  return {
    shipped: isShipped && !isFailed,
    onTime,
    date: date && !isNaN(date.getTime()) ? date : null,
  }
}
