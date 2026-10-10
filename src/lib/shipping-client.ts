/**
 * Shipping Notice API client (read-only).
 * Source: https://semain-shipping-notice.vercel.app
 * Auth: POST /api/auth/login -> { token, user } -> use as Bearer
 * Data: GET /api/shippings (Control de Envíos records)
 *
 * Record structure (from JS bundle analysis):
 * { id, fecha, empresa, codigo_cliente, cliente, qty, producto, factura,
 *   correo, guia, url_rastreo, shipping_num, link3d, mes, anio, um, po,
 *   paqueteria, shipping_id, shipping_na, client_id, costo }
 *
 * The "producto" field contains a description that may reference the PV number
 * or the item concept. We use it to match back to CalidadItems.
 *
 * IMPORTANT: We ONLY read from this API. We never modify any data on the Shipping Notice site.
 */

const SHIPPING_BASE = process.env.SHIPPING_BASE_URL || 'https://semain-shipping-notice.vercel.app'
const SHIPPING_USER = process.env.SHIPPING_USERNAME
const SHIPPING_PASS = process.env.SHIPPING_PASSWORD

let cachedToken: { token: string; expires: number } | null = null

export interface ShippingRecord {
  id?: string | number
  fecha?: string
  fechaEnvio?: string
  empresa?: string
  cliente?: string
  client?: string
  codigo_cliente?: string
  qty?: string | number
  producto?: string
  factura?: string
  invoiceNumber?: string
  correo?: string
  guia?: string
  url_rastreo?: string
  shipping_num?: string
  link3d?: string
  mes?: string
  anio?: string | number
  um?: string
  po?: string
  paqueteria?: string
  carrier?: string
  transportista?: string
  shipping_id?: string | number
  shipping_na?: number
  client_id?: string | number
  costo?: string | number
  status?: string
  estado?: string
  onTime?: boolean
  descripcion?: string
  detalle?: string
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

/** Build a lowercase text blob from a shipping record for matching. */
export function getMatchingText(rec: ShippingRecord): string {
  const parts = [
    rec.producto,
    rec.descripcion,
    rec.detalle,
    rec.po,
    rec.factura,
    rec.invoiceNumber,
    rec.empresa,
    rec.cliente,
    rec.client,
  ].filter(Boolean).map(s => String(s).toLowerCase())
  return parts.join(' | ')
}

/** Extract PV number references from text. Matches "PV 1290", "PV1290", "P.V. 1290", "PV-1290". */
export function extractPVReferences(text: string): string[] {
  if (!text) return []
  // Match "PV" followed by optional separator and digits
  const matches = text.match(/p\.?\s*v\.?\s*[-]?\s*\d+/gi) || []
  return matches.map(m => {
    // Normalize: extract digits
    const digits = m.match(/\d+/)?.[0] || ''
    return digits
  }).filter(Boolean)
}

/** Determine if a shipping record indicates a successful delivery. */
export function getShippingOutcome(rec: ShippingRecord): {
  shipped: boolean
  onTime: boolean
  date: Date | null
  guia: string | null
  paqueteria: string | null
} {
  const hasShipDate = !!(rec.fecha || rec.fechaEnvio)
  const date = rec.fecha ? new Date(rec.fecha) : rec.fechaEnvio ? new Date(rec.fechaEnvio) : null
  const validDate = date && !isNaN(date.getTime()) ? date : null

  // A record is "shipped" if it has a date and a guia, or a shipping_num
  const hasGuia = !!(rec.guia || rec.shipping_num)
  const shipped = hasShipDate && (hasGuia || rec.shipping_na !== undefined)

  // onTime: we can't determine this from the shipping record alone.
  // It's determined by comparing the shipping date with the estimated delivery date.
  // For now, default to true; the sync logic will refine this.
  let onTime = true
  if (typeof rec.onTime === 'boolean') onTime = rec.onTime

  return {
    shipped,
    onTime,
    date: validDate,
    guia: rec.guia ? String(rec.guia) : (rec.shipping_num ? String(rec.shipping_num) : null),
    paqueteria: rec.paqueteria ? String(rec.paqueteria) : (rec.carrier ? String(rec.carrier) : null),
  }
}
