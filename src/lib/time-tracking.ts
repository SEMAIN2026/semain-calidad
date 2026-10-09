/**
 * Time tracking helpers for Calidad items.
 *
 * Rules (per user request):
 *   - Each item has an `estimatedDays` budget (default 7) starting from `createdAt`.
 *   - When `usedPercent >= 90` AND not shipped -> YELLOW warning.
 *   - When `usedPercent >= 100` AND not shipped -> RED overdue.
 *   - When shipped (shippingStatus === 'a_tiempo' or 'tarde' but shipped) -> GREEN.
 *   - Light green when shipped on time; slightly different shade when shipped late.
 */

export interface TimeInfo {
  usedPercent: number      // 0-100+, capped display at 100
  rawPercent: number       // uncapped
  daysUsed: number
  daysEstimated: number
  daysRemaining: number
  state: 'normal' | 'warning' | 'overdue' | 'shipped_on_time' | 'shipped_late'
  rowClass: string         // Tailwind classes for the row
  badgeClass: string       // Tailwind classes for a badge
  label: string
}

export function computeTimeInfo(opts: {
  createdAt: Date
  estimatedDays: number
  status: string
  shippingStatus: string | null
  shippingSynced: boolean
  now?: Date
}): TimeInfo {
  const now = opts.now ?? new Date()
  const created = new Date(opts.createdAt)
  const estimated = Math.max(1, opts.estimatedDays || 7)
  const msUsed = now.getTime() - created.getTime()
  const daysUsed = msUsed / (1000 * 60 * 60 * 24)
  const rawPercent = (daysUsed / estimated) * 100
  const usedPercent = Math.max(0, Math.min(100, rawPercent))
  const daysRemaining = estimated - daysUsed

  const isShipped = opts.shippingStatus === 'a_tiempo' || opts.shippingStatus === 'tarde'
  const isShippedOnTime = opts.shippingStatus === 'a_tiempo'

  if (isShipped && isShippedOnTime) {
    return {
      usedPercent,
      rawPercent,
      daysUsed,
      daysEstimated: estimated,
      daysRemaining,
      state: 'shipped_on_time',
      rowClass: 'bg-green-100 hover:bg-green-200/80 dark:bg-green-900/40 dark:hover:bg-green-900/60',
      badgeClass: 'bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/40',
      label: 'Enviado a tiempo',
    }
  }
  if (isShipped && !isShippedOnTime) {
    return {
      usedPercent,
      rawPercent,
      daysUsed,
      daysEstimated: estimated,
      daysRemaining,
      state: 'shipped_late',
      rowClass: 'bg-lime-100 hover:bg-lime-200/80 dark:bg-lime-900/40 dark:hover:bg-lime-900/60',
      badgeClass: 'bg-lime-500/20 text-lime-700 dark:text-lime-300 border-lime-500/40',
      label: 'Enviado tarde',
    }
  }
  if (rawPercent >= 100) {
    return {
      usedPercent,
      rawPercent,
      daysUsed,
      daysEstimated: estimated,
      daysRemaining,
      state: 'overdue',
      rowClass: 'bg-red-100 hover:bg-red-200/80 dark:bg-red-900/40 dark:hover:bg-red-900/60',
      badgeClass: 'bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40',
      label: 'Tiempo agotado',
    }
  }
  if (rawPercent >= 90) {
    return {
      usedPercent,
      rawPercent,
      daysUsed,
      daysEstimated: estimated,
      daysRemaining,
      state: 'warning',
      rowClass: 'bg-yellow-100 hover:bg-yellow-200/80 dark:bg-yellow-900/40 dark:hover:bg-yellow-900/60',
      badgeClass: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border-yellow-500/40',
      label: '90% del tiempo',
    }
  }
  return {
    usedPercent,
    rawPercent,
    daysUsed,
    daysEstimated: estimated,
    daysRemaining,
    state: 'normal',
    rowClass: 'hover:bg-muted/50',
    badgeClass: 'bg-muted text-muted-foreground',
    label: 'En proceso',
  }
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}
