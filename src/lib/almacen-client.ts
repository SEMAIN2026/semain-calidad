/**
 * Almacen API client (read-only).
 * Source: https://semain-almacen.vercel.app
 * Auth: POST /api/auth/login -> { token, user } -> use as Bearer
 * Data: GET /api/pv-entries (list of PVs with body containing item descriptions as free text)
 *
 * IMPORTANT: We ONLY read from this API. We never modify any data on the Almacen site.
 *
 * Note: The PV "body" field contains the full email text with item descriptions.
 * We extract item-like lines from it. The structured data (cliente, concepto,
 * teTexto, etc.) comes from the Excel import, not from Almacén.
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
  receivedAt?: string
  createdAt?: string
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
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.entries)) return data.entries
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data?.pvs)) return data.pvs
  return []
}
