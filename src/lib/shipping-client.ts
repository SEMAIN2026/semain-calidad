/**
 * Shipping Notice API client (read-only).
 * Source: https://semain-shipping-notice.vercel.app
 *
 * Auth: cookie-based (semain_session HttpOnly cookie).
 *
 * Record structure:
 * { id, file_number, ship_date, company, company_display,
 *   receiver_names, plant, courier, tracking, tracking_url,
 *   items: [{ qty, um, pkg, po, invoice }],  // pkg = product description
 *   guides: [{ paqueteria, guia, url_rastreo }], ... }
 *
 * Product format examples (from real data):
 *   "MANDRIL SIN TAPON M-68777046AB-A SS17-4PH"
 *   "MANDREL GH319-89180 (17-4PH) rezago"
 *   "NEW GAUGE FINAL 68777848AA SENSORES"
 *   "Retrabajo a Gage NP 5A69FE3"
 *
 * Excel concepto format: "MANDRIL SIN TAPAS | 18-715A"
 *   -> the part after " | " is the part number to match against.
 */

const SHIPPING_BASE = process.env.SHIPPING_BASE_URL || 'https://semain-shipping-notice.vercel.app'
const SHIPPING_USER = process.env.SHIPPING_USERNAME
const SHIPPING_PASS = process.env.SHIPPING_PASSWORD

let cachedCookie: { cookie: string; expires: number } | null = null

export interface ShippingItem {
  qty?: string | number
  um?: string
  pkg?: string
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
  const setCookie = res.headers.get('set-cookie') || ''
  const match = setCookie.match(/semain_session=([^;]+)/)
  if (!match) {
    throw new Error('Shipping login: no semain_session cookie in response')
  }
  const cookie = `semain_session=${match[1]}`
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

/** Extract PV number digits from text. Matches "PV 1290", "PV1290", "P.V. 1290". */
export function extractPVReferences(text: string): string[] {
  if (!text) return []
  const matches = text.match(/p\.?\s*v\.?\s*[-]?\s*\d+/gi) || []
  return matches.map(m => m.match(/\d+/)?.[0] || '').filter(Boolean)
}

/** Extract the part number from an Excel concepto.
 *  Concepto format: "MANDRIL SIN TAPAS | 18-715A" -> returns "18-715A"
 *  If no " | " separator, returns the whole string. */
export function extractPartNumberFromConcepto(concepto: string): string {
  if (!concepto) return ''
  const parts = concepto.split('|').map(p => p.trim())
  // The part number is typically after the last " | "
  const afterPipe = parts[parts.length - 1] || concepto
  // Remove common prefixes like "NP ", "MANDREL ", etc to get the raw part number
  return afterPipe
}

/** Get all product descriptions (pkg) from a shipping record's items. */
export function getItemDescriptions(rec: ShippingRecord): string[] {
  if (!rec.items || !Array.isArray(rec.items)) return []
  return rec.items
    .map(it => it.pkg)
    .filter((s): s is string => !!s && typeof s === 'string')
}

export function getShippingDate(rec: ShippingRecord): Date | null {
  const dateStr = rec.ship_date || rec.saved_at
  if (!dateStr) return null
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

export function getTrackingInfo(rec: ShippingRecord): { guia: string | null; paqueteria: string | null } {
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

/**
 * Score-based matching between a CalidadItem concepto and a shipping product description.
 * Returns a score (0 = no match, higher = better match).
 *
 * Strategy:
 * 1. Extract part number from concepto (after " | ")
 * 2. Check if that part number appears in the shipping pkg
 * 3. Also check keyword overlap (mandril, fixtura, gauge, etc.)
 */
export function matchScore(concepto: string, shippingPkg: string): number {
  if (!concepto || !shippingPkg) return 0
  const c = concepto.toLowerCase().trim()
  const p = shippingPkg.toLowerCase().trim()
  if (!c || !p) return 0

  let score = 0

  // 1. Part number match (strongest signal)
  const partNum = extractPartNumberFromConcepto(concepto).toLowerCase()
  if (partNum && partNum.length >= 3) {
    // Clean the part number of common words
    const cleanPart = partNum.replace(/^(np|mandrel|mandril|new|gage|fixtura)\s+/gi, '').trim()
    if (cleanPart.length >= 3 && p.includes(cleanPart)) {
      score += 100
    }
    // Also try the raw part number
    if (p.includes(partNum)) {
      score += 80
    }
  }

  // 2. Keyword overlap
  const keywords = ['mandril', 'mandrel', 'fixtura', 'gage', 'gauge', 'ventana', 'horquilla', 'pokayoke', 'retrabajo']
  for (const kw of keywords) {
    if (c.includes(kw) && p.includes(kw)) {
      score += 10
    }
  }

  // 3. Direct substring match (either direction, min 8 chars to avoid false positives)
  if (c.length >= 8 && p.includes(c)) score += 50
  if (p.length >= 8 && c.includes(p)) score += 50

  return score
}
