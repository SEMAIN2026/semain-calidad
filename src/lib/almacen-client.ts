/**
 * Almacen API client (read-only).
 * Source: https://semain-almacen.vercel.app
 * Auth: POST /api/auth/login -> { token, user } -> use as Bearer
 * Data: GET /api/pv-entries (list of PVs), GET /api/items (items, can filter by pvNumber)
 *
 * IMPORTANT: We ONLY read from this API. We never modify any data on the Almacen site.
 */

const ALMACEN_BASE = process.env.ALMACEN_BASE_URL || 'https://semain-almacen.vercel.app'
const ALMACEN_USER = process.env.ALMACEN_USERNAME
const ALMACEN_PASS = process.env.ALMACEN_PASSWORD

let cachedToken: { token: string; expires: number } | null = null

export interface AlmacenPV {
  id?: string | number
  pvNumber: string
  subject?: string | null
  sender?: string | null
  body?: string | null
  notes?: string | null
  createdAt?: string
  [k: string]: unknown
}

export interface AlmacenItem {
  id?: string | number
  itemId?: string
  pvNumber?: string
  description?: string
  quantity?: number | string
  cantidad?: number | string
  warehouse?: string
  almacen?: string
  codigo?: string
  [k: string]: unknown
}

async function login(): Promise<string> {
  if (!ALMACEN_USER || !ALMACEN_PASS) {
    throw new Error('Almacen credentials not configured (ALMACEN_USERNAME / ALMACEN_PASSWORD)')
  }
  const res = await fetch(`${ALMACEN_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ALMACEN_USER, password: ALMACEN_PASS }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Almacen login failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  const token = data.token || data.accessToken || data.authToken
  if (!token) throw new Error('Almacen login: no token in response')
  // Cache for 50 minutes (assume 1h expiry)
  cachedToken = { token, expires: Date.now() + 50 * 60 * 1000 }
  return token
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token
  return login()
}

async function authedGet(path: string): Promise<any> {
  const token = await getToken()
  const res = await fetch(`${ALMACEN_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (res.status === 401) {
    // Token expired, retry once
    cachedToken = null
    const newToken = await getToken()
    const retry = await fetch(`${ALMACEN_BASE}${path}`, {
      headers: { Authorization: `Bearer ${newToken}` },
      cache: 'no-store',
    })
    if (!retry.ok) throw new Error(`Almacen GET ${path} failed after retry: ${retry.status}`)
    return retry.json()
  }
  if (!res.ok) throw new Error(`Almacen GET ${path} failed: ${res.status}`)
  return res.json()
}

/** Get all PVs from Almacen. */
export async function fetchPVs(): Promise<AlmacenPV[]> {
  const data = await authedGet('/api/pv-entries')
  // Could be array or { data: [...] }
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data?.entries)) return data.entries
  if (Array.isArray(data?.pvs)) return data.pvs
  return []
}

/** Get items, optionally filtered by pvNumber. */
export async function fetchItems(pvNumber?: string): Promise<AlmacenItem[]> {
  const qs = pvNumber ? `?pvNumber=${encodeURIComponent(pvNumber)}` : ''
  const data = await authedGet(`/api/items${qs}`)
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data?.items)) return data.items
  return []
}

/** Get every item across every PV (one row per item, as requested).
 *  Fetches items for all PVs in parallel batches for speed. */
export async function fetchAllItemsByPV(): Promise<{ pv: AlmacenPV; items: AlmacenItem[] }[]> {
  const pvs = await fetchPVs()
  const result: { pv: AlmacenPV; items: AlmacenItem[] }[] = []

  // Process in batches of 8 parallel requests to avoid overwhelming the API
  const BATCH_SIZE = 8
  for (let i = 0; i < pvs.length; i += BATCH_SIZE) {
    const batch = pvs.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.allSettled(
      batch.map(async pv => {
        try {
          const items = await fetchItems(pv.pvNumber)
          return { pv, items }
        } catch (e) {
          console.error(`Failed to fetch items for PV ${pv.pvNumber}:`, e)
          return { pv, items: [] }
        }
      })
    )
    for (const r of batchResults) {
      if (r.status === 'fulfilled') result.push(r.value)
    }
  }
  return result
}
