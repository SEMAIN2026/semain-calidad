'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/toaster'
import { useToast } from '@/hooks/use-toast'
import { RefreshCw, Upload, Server, LayoutDashboard, Table2, Download, X } from 'lucide-react'
import { formatDateTime } from '@/lib/time-tracking'
import { DashboardTab, type DashboardData, type SyncStatus } from '@/components/calidad/dashboard-tab'
import { PvsTab } from '@/components/calidad/pvs-tab'
import { DateRangeFilter, DEFAULT_DATE_RANGE, type DateRange } from '@/components/calidad/date-range-filter'

interface CalidadItem {
  id: string
  pvNumber: string
  itemLine: number
  cliente: string | null
  concepto: string
  clave: string | null
  cantidad: number
  fechaPv: string | null
  fechaInicio: string | null
  teTexto: string | null
  teDias: number | null
  fechaEntregaEstimada: string | null
  fechaReprogramada: string | null
  estado: string
  embarque: string | null
  shippingDate: string | null
  shippingStatus: string | null
  shippingSynced: boolean
  guia: string | null
  paqueteria: string | null
  source: string
  isManual: boolean
  notes: string | null
  archivo: string | null
  createdAt: string
  updatedAt: string
}

export default function CalidadPage() {
  const { toast } = useToast()
  const [items, setItems] = useState<CalidadItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [tab, setTab] = useState<string>('pvs')
  const [autoSynced, setAutoSynced] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [showInstallBanner, setShowInstallBanner] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange>(DEFAULT_DATE_RANGE)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // PWA install prompt handler
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault()
      setInstallPrompt(e)
      // Show banner if not previously dismissed
      const dismissed = localStorage.getItem('pwa-install-dismissed')
      if (!dismissed) {
        setShowInstallBanner(true)
      }
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') {
      toast({ title: 'App instalada', description: 'Semain Calidad se instaló en tu dispositivo' })
    }
    setInstallPrompt(null)
    setShowInstallBanner(false)
  }

  const dismissInstallBanner = () => {
    setShowInstallBanner(false)
    localStorage.setItem('pwa-install-dismissed', '1')
  }

  const buildDateParams = useCallback(() => {
    const params = new URLSearchParams()
    if (dateRange.dateFrom) params.set('dateFrom', dateRange.dateFrom)
    if (dateRange.dateTo) params.set('dateTo', dateRange.dateTo)
    if (dateRange.dateField) params.set('dateField', dateRange.dateField)
    return params.toString()
  }, [dateRange])

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const qs = buildDateParams()
      const res = await fetch(`/api/calidad/items${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
      const json = await res.json()
      setItems(json.data || [])
    } catch (e: any) {
      toast({ title: 'Error al cargar', description: e?.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast, buildDateParams])

  const loadSyncStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/status', { cache: 'no-store' })
      const json = await res.json()
      setSyncStatus(json)
    } catch {}
  }, [])

  const loadDashboard = useCallback(async () => {
    try {
      const qs = buildDateParams()
      const res = await fetch(`/api/dashboard${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
      const json = await res.json()
      setDashboard(json)
    } catch {}
  }, [buildDateParams])

  const runSync = useCallback(async (showToast = true) => {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync/all', { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        if (showToast) {
          toast({
            title: 'Sincronización completa',
            description: `Almacén: ${json.almacen.pvsFound} PVs (${json.almacen.updated} actualizados) · Shipping: ${json.shipping.matched} matcheados de ${json.shipping.totalRecords}`,
          })
        }
      } else {
        const errs = []
        if (json.almacen?.error) errs.push(`Almacén: ${json.almacen.error}`)
        if (json.shipping?.error) errs.push(`Shipping: ${json.shipping.error}`)
        if (showToast) {
          toast({
            title: 'Sincronización con errores',
            description: errs.join(' · ') || 'Error desconocido',
            variant: 'destructive',
          })
        }
      }
      await Promise.all([loadItems(), loadSyncStatus(), loadDashboard()])
    } catch (e: any) {
      if (showToast) {
        toast({ title: 'Error de red', description: e?.message, variant: 'destructive' })
      }
    } finally {
      setSyncing(false)
    }
  }, [toast, loadItems, loadSyncStatus, loadDashboard])

  // Initial load
  useEffect(() => {
    loadItems()
    loadSyncStatus()
    loadDashboard()
  }, [loadItems, loadSyncStatus, loadDashboard])

  // Auto-sync on first mount (silent)
  useEffect(() => {
    if (!autoSynced) {
      setAutoSynced(true)
      runSync(false)
    }
  }, [autoSynced, runSync])

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/import/excel', { method: 'POST', body: formData })
      const json = await res.json()
      if (json.ok) {
        toast({
          title: 'Excel importado',
          description: `${json.imported} nuevos, ${json.updated} actualizados, ${json.skipped} omitidos`,
        })
        await Promise.all([loadItems(), loadDashboard()])
      } else {
        toast({ title: 'Error al importar', description: json.error, variant: 'destructive' })
      }
    } catch (e: any) {
      toast({ title: 'Error de red', description: e?.message, variant: 'destructive' })
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b sticky top-0 z-30 bg-background/95 backdrop-blur">
        <div className="px-3 sm:px-4 py-2 sm:py-2.5 flex flex-wrap items-center gap-2 sm:gap-3 max-w-[1800px] mx-auto">
          <div className="flex items-center gap-2 sm:gap-2.5 sm:mr-4">
            <img
              src="/icons/header-logo.png"
              alt="Semain Calidad"
              className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg object-contain shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold leading-tight truncate">Semain · Calidad</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight hidden sm:block">Seguimiento de PV y envíos</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 ml-auto">
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleImportExcel}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="shrink-0"
            >
              {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              <span className="ml-1.5 hidden sm:inline">{importing ? 'Importando...' : 'Excel'}</span>
            </Button>
            <Button onClick={() => runSync(true)} disabled={syncing} size="sm" className="shrink-0">
              {syncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-1.5 hidden sm:inline">{syncing ? 'Sync...' : 'Sincronizar'}</span>
            </Button>
            {installPrompt && (
              <Button onClick={handleInstall} variant="default" size="sm" className="bg-[#8DC63F] hover:bg-[#7ab233] text-white shrink-0">
                <Download className="h-4 w-4" />
                <span className="ml-1.5 hidden sm:inline">Instalar</span>
              </Button>
            )}
          </div>
        </div>

        {/* PWA Install Banner */}
        {showInstallBanner && installPrompt && (
          <div className="container mx-auto px-4 pb-2">
            <div className="flex items-center gap-3 p-2.5 rounded-lg border bg-muted/50">
              <img src="/icons/header-logo.png" alt="Semain Calidad" className="w-8 h-8 rounded" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Instalar Semain Calidad</p>
                <p className="text-xs text-muted-foreground">Acceso rápido desde tu pantalla de inicio</p>
              </div>
              <Button onClick={handleInstall} size="sm" className="bg-[#8DC63F] hover:bg-[#7ab233] text-white">
                Instalar
              </Button>
              <Button onClick={dismissInstallBanner} size="sm" variant="ghost" className="h-8 w-8 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {syncStatus && (syncStatus.almacen || syncStatus.shipping) && (
          <div className="container mx-auto px-4 pb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
            {syncStatus.almacen && (
              <span className="flex items-center gap-1">
                Almacén: {syncStatus.almacen.status === 'success' ? '✓' : '✗'} {formatDateTime(syncStatus.almacen.createdAt)}
              </span>
            )}
            {syncStatus.shipping && (
              <span className="flex items-center gap-1">
                Shipping: {syncStatus.shipping.status === 'success' ? '✓' : '✗'} {formatDateTime(syncStatus.shipping.createdAt)}
              </span>
            )}
            {syncing && (
              <span className="flex items-center gap-1 text-primary">
                <Server className="h-3 w-3 animate-pulse" />
                Sincronizando...
              </span>
            )}
          </div>
        )}
      </header>

      <main className="px-3 sm:px-4 py-4 sm:py-6 flex-1 max-w-[1800px] mx-auto w-full">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full max-w-md grid-cols-2 mb-4 sm:mb-6">
            <TabsTrigger value="pvs" className="gap-1.5">
              <Table2 className="h-4 w-4" />
              PVs
            </TabsTrigger>
            <TabsTrigger value="dashboard" className="gap-1.5">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pvs" className="mt-0">
            <PvsTab items={items} loading={loading} onRefresh={async () => {
              await Promise.all([loadItems(), loadDashboard()])
            }} />
          </TabsContent>

          <TabsContent value="dashboard" className="mt-0">
            <DashboardTab data={dashboard} syncStatus={syncStatus} />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mt-auto border-t py-4 text-center text-xs text-muted-foreground">
        Semain · Calidad — Auto-sincronización desde Almacén y Shipping Notice (solo lectura).
      </footer>

      <Toaster />
    </div>
  )
}
