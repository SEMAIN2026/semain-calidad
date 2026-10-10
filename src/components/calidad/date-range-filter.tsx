'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'
import { Calendar, ChevronDown } from 'lucide-react'

export type DateRangePreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'last30'
  | 'last90'
  | 'thisQuarter'
  | 'custom'

export type DateField = 'fechaPv' | 'fechaEntregaEstimada' | 'shippingDate'

export interface DateRange {
  preset: DateRangePreset
  dateFrom: string | null // ISO date (yyyy-mm-dd)
  dateTo: string | null
  dateField: DateField
}

export const DEFAULT_DATE_RANGE: DateRange = {
  preset: 'all',
  dateFrom: null,
  dateTo: null,
  dateField: 'fechaPv',
}

const PRESET_LABELS: Record<DateRangePreset, string> = {
  all: 'Todo el tiempo',
  today: 'Hoy',
  yesterday: 'Ayer',
  thisWeek: 'Esta semana',
  lastWeek: 'Semana pasada',
  thisMonth: 'Este mes',
  lastMonth: 'Mes pasado',
  last30: 'Últimos 30 días',
  last90: 'Últimos 90 días',
  thisQuarter: 'Este trimestre',
  custom: 'Personalizado',
}

const FIELD_LABELS: Record<DateField, string> = {
  fechaPv: 'Fecha PV',
  fechaEntregaEstimada: 'Entrega estimada',
  shippingDate: 'Fecha de envío',
}

/** Compute date range from a preset. Returns {dateFrom, dateTo} as yyyy-mm-dd strings. */
export function presetToRange(preset: DateRangePreset): { dateFrom: string | null; dateTo: string | null } {
  if (preset === 'all') return { dateFrom: null, dateTo: null }
  if (preset === 'custom') return { dateFrom: null, dateTo: null }

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  switch (preset) {
    case 'today':
      return { dateFrom: fmt(today), dateTo: fmt(today) }
    case 'yesterday': {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      return { dateFrom: fmt(y), dateTo: fmt(y) }
    }
    case 'thisWeek': {
      // Week starts on Monday
      const day = today.getDay() || 7 // 0=Sunday -> 7
      const monday = new Date(today)
      monday.setDate(monday.getDate() - day + 1)
      const sunday = new Date(monday)
      sunday.setDate(sunday.getDate() + 6)
      return { dateFrom: fmt(monday), dateTo: fmt(sunday) }
    }
    case 'lastWeek': {
      const day = today.getDay() || 7
      const monday = new Date(today)
      monday.setDate(monday.getDate() - day + 1 - 7)
      const sunday = new Date(monday)
      sunday.setDate(sunday.getDate() + 6)
      return { dateFrom: fmt(monday), dateTo: fmt(sunday) }
    }
    case 'thisMonth': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      return { dateFrom: fmt(first), dateTo: fmt(last) }
    }
    case 'lastMonth': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const last = new Date(today.getFullYear(), today.getMonth(), 0)
      return { dateFrom: fmt(first), dateTo: fmt(last) }
    }
    case 'last30': {
      const from = new Date(today)
      from.setDate(from.getDate() - 29)
      return { dateFrom: fmt(from), dateTo: fmt(today) }
    }
    case 'last90': {
      const from = new Date(today)
      from.setDate(from.getDate() - 89)
      return { dateFrom: fmt(from), dateTo: fmt(today) }
    }
    case 'thisQuarter': {
      const q = Math.floor(today.getMonth() / 3)
      const first = new Date(today.getFullYear(), q * 3, 1)
      const last = new Date(today.getFullYear(), q * 3 + 3, 0)
      return { dateFrom: fmt(first), dateTo: fmt(last) }
    }
    default:
      return { dateFrom: null, dateTo: null }
  }
}

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange
  onChange: (v: DateRange) => void
}) {
  const [open, setOpen] = useState(false)
  // Initialize from value; component is remounted via key when value.preset changes
  const [customFrom, setCustomFrom] = useState(value.dateFrom || '')
  const [customTo, setCustomTo] = useState(value.dateTo || '')

  const handlePreset = (preset: DateRangePreset) => {
    if (preset === 'custom') {
      onChange({ ...value, preset })
      return
    }
    const { dateFrom, dateTo } = presetToRange(preset)
    onChange({ ...value, preset, dateFrom, dateTo })
    setOpen(false)
  }

  const applyCustom = () => {
    onChange({ ...value, preset: 'custom', dateFrom: customFrom || null, dateTo: customTo || null })
    setOpen(false)
  }

  const label = value.preset === 'custom' && (value.dateFrom || value.dateTo)
    ? `${value.dateFrom || '…'} → ${value.dateTo || '…'}`
    : PRESET_LABELS[value.preset]

  return (
    <div className="flex items-center gap-2">
      <Select
        value={value.dateField}
        onValueChange={(v) => onChange({ ...value, dateField: v as DateField })}
      >
        <SelectTrigger className="w-[150px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fechaPv">Fecha PV</SelectItem>
          <SelectItem value="fechaEntregaEstimada">Entrega est.</SelectItem>
          <SelectItem value="shippingDate">Fecha envío</SelectItem>
        </SelectContent>
      </Select>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            <span className="max-w-[140px] truncate">{label}</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3" align="start">
          <div className="space-y-2">
            <Label className="text-xs font-medium">Período</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(PRESET_LABELS).map(([key, lbl]) => (
                <Button
                  key={key}
                  variant={value.preset === key ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs justify-start"
                  onClick={() => handlePreset(key as DateRangePreset)}
                >
                  {lbl}
                </Button>
              ))}
            </div>

            {value.preset === 'custom' && (
              <div className="space-y-2 pt-2 border-t mt-2">
                <Label className="text-xs font-medium">Rango personalizado</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Desde</Label>
                    <Input
                      type="date"
                      value={customFrom}
                      onChange={e => setCustomFrom(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Hasta</Label>
                    <Input
                      type="date"
                      value={customTo}
                      onChange={e => setCustomTo(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
                <Button onClick={applyCustom} size="sm" className="w-full h-8 text-xs">
                  Aplicar
                </Button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
