/**
 * Shipping Notice API client (read-only).
 * Source: https://semain-shipping-notice.vercel.app
 *
 * Auth mechanism: POST /api/auth/login sets a `semain_session` HttpOnly cookie.
 * We capture and reuse that cookie for all subsequent requests.
 *
 * Record structure (from API):
 * {
 *   id, file_number, ship_date, company, company_display,
 *   receiver_names, plant, street, district, city, zip,
 *   courier, tracking, tracking_url,
 *   items: [{ qty, um, pkg, po, invoice }],  // pkg = product description
 *   link3d, links, product_image, saved_at,
 *   guides_json, client_id, ship_date_fin, notas, link3d_list,
 *   guides: [{ paqueteria, guia, url_rastreo }]
 * }
 *
 * IMPORTANT: We ONLY read from this API. We never modify any data.
 */

const SHIPPING_BASE = process.env.SHIPPING_BASE_URL || 'https://semain-shipping-notice.vercel.app'
const SHIPPING_USER = process.env.SHIPPING_USERNAME
const SHIPPING_PASS = process.env.SHIPPING_PASSWORD

let cachedCookie: { cookie: string; expires: number } | null = null

export interface ShippingItem {
  qty?: string | number
  um?: string
  pkg?: string  // Product description — this is what we match against
  po?: string
  invoice?: string
}

export interface ShippingGuide {
  paqueteria?: string
  guia?: string
  url_rastreo?: string
}

export interface ShippingRecord {
  id?: string | number
  file_number?: string
  ship_date?: string
  company?: string
  company_display?: string
  receiver_names?: string[]
  plant?: string
  city?: string
  courier?: string
  tracking?: string
  tracking_url?: string
  items?: ShippingItem[]
  guides?: ShippingGuide[]
  guides_json?: string
  notas?: string
  saved_at?: string
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
  // Extract the Set-Cookie header
  const setCookie = res.headers.get('set-cookie') || ''
  const match = setCookie.match(/semain_session=([^;]+)/)
  if (!match) {
    throw new Error('Shipping login: no semain_session cookie in response')
  }
  const cookie = `semain_session=${match[1]}`
  // Cache for 7 hours (cookie expires in 8h)
  cachedCookie = { cookie, expires: Date.now() + 7 * 60 * 60 * 1000 }
  return cookie
}

async function getCookie(): Promise<string> {
  if (cachedCookie && cachedCookie.expires > Date.now()) return cachedCookie.cookie
  return login()
}

async function authedGet(path: string): Promise<any> {
  const cookie = await getCookie()
  const res = await fetch(`${SHIPPING_BASE}${path}`, {
    headers: { Cookie: cookie },
    cache: 'no-store',
  })
  if (res.status === 401) {
    cachedCookie = null
    const newCookie = await getCookie()
    const retry = await fetch(`${SHIPPING_BASE}${path}`, {
      headers: { Cookie: newCookie },
      cache: 'no-store',
    })
    if (!retry.ok) throw new Error(`Shipping GET ${path} failed after retry: ${retry.status}`)
    return retry.json()
  }
  if (!res.ok) throw new Error(`Shipping GET ${path} failed: ${res.status}`)
  return res.json()
}

/** Get all shipping records. */
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

/** Extract PV number digits from a text string.
 *  Matches "PV 1290", "PV1290", "P.V. 1290", "PV-1290" etc. */
export function extractPVReferences(text: string): string[] {
  if (!text) return []
  const matches = text.match(/p\.?\s*v\.?\s*[-]?\s*\d+/gi) || []
  return matches.map(m => {
    const digits = m.match(/\d+/)?.[0] || ''
    return digits
  }).filter(Boolean)
}

/** Get all product descriptions (pkg) from a shipping record's items. */
export function getItemDescriptions(rec: ShippingRecord): string[] {
  if (!rec.items || !Array.isArray(rec.items)) return []
  return rec.items
    .map(it => it.pkg)
    .filter((s): s is string => !!s && typeof s === 'string')
}

/** Get the shipping date as a Date object. */
export function getShippingDate(rec: ShippingRecord): Date | null {
  const dateStr = rec.ship_date || rec.saved_at
  if (!dateStr) return null
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

/** Get the tracking number and courier from a shipping record. */
export function getTrackingInfo(rec: ShippingRecord): { guia: string | null; paqueteria: string | null } {
  // Try guides array first
  if (rec.guides && rec.guides.length > 0) {
    const g = rec.guides[0]
    return {
      guia: g.guia || rec.tracking || null,
      paqueteria: g.paqueteria || rec.courier || null,
    }
  }
  return {
    guia: rec.tracking || null,
    paqueteria: rec.courier || null,
  }
}
