'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/toaster'
import { useToast } from '@/hooks/use-toast'
import { RefreshCw, Package, Send, Server, LayoutDashboard, Table2 } from 'lucide-react'
import { formatDateTime, type TimeInfo } from '@/lib/time-tracking'
import { DashboardTab, type DashboardData, type SyncStatus } from '@/components/calidad/dashboard-tab'

interface CalidadItem {
  id: string
  pvNumber: string
  itemNumber: string
  description: string
  quantity: number
  status: string
  estimatedDays: number
  shippingDate: string | null
  shippingStatus: string | null
  shippingSynced: boolean
  isManual: boolean
  notes: string | null
  source: string
  createdAt: string
  updatedAt: string
  time: TimeInfo
}

export default function CalidadPage() {
  const { toast } = useToast()
  const [items, setItems] = useState<CalidadItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [tab, setTab] = useState<string>('pvs')
  const [autoSynced, setAutoSynced] = useState(false)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/calidad/items', { cache: 'no-store' })
      const json = await res.json()
      setItems(json.data || [])
    } catch (e: any) {
      toast({ title: 'Error al cargar', description: e?.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  const loadSyncStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/status', { cache: 'no-store' })
      const json = await res.json()
      setSyncStatus(json)
    } catch {}
  }, [])

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard', { cache: 'no-store' })
      const json = await res.json()
      setDashboard(json)
    } catch {}
  }, [])

  const runSync = useCallback(async (showToast = true) => {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync/all', { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        if (showToast) {
          toast({
            title: 'Sincronización completa',
            description: `Almacén: ${json.almacen.itemsFound} items (${json.almacen.created} nuevos, ${json.almacen.updated} actualizados) · Shipping: ${json.shipping.matched} matcheados de ${json.shipping.totalRecords}`,
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

  // Initial load + auto-sync on first mount
  useEffect(() => {
    loadItems()
    loadSyncStatus()
    loadDashboard()
  }, [loadItems, loadSyncStatus, loadDashboard])

  // Auto-sync once after initial load (silent)
  useEffect(() => {
    if (!autoSynced && items.length >= 0) {
      setAutoSynced(true)
      runSync(false)
    }
  }, [autoSynced, items.length, runSync])

  const handleManualSync = async () => {
    await runSync(true)
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 z-30 bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 mr-4">
            <div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">
              S
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Semain · Calidad</h1>
              <p className="text-xs text-muted-foreground leading-tight">Control de calidad y envíos</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {/* Single unified sync button */}
            <Button
              onClick={handleManualSync}
              disabled={syncing}
              size="sm"
            >
              {syncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-1.5">{syncing ? 'Sincronizando...' : 'Sincronizar'}</span>
            </Button>
          </div>
        </div>

        {/* Sync status bar */}
        {(syncStatus?.almacen || syncStatus?.shipping) && (
          <div className="container mx-auto px-4 pb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
            {syncStatus?.almacen && (
              <span className="flex items-center gap-1">
                <Package className="h-3 w-3" />
                Almacén: {syncStatus.almacen.status === 'success' ? '✓' : '✗'} {formatDateTime(syncStatus.almacen.createdAt)}
              </span>
            )}
            {syncStatus?.shipping && (
              <span className="flex items-center gap-1">
                <Send className="h-3 w-3" />
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

      <main className="container mx-auto px-4 py-6 flex-1">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
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
            <PvsTabWrapper items={items} loading={loading} onRefresh={async () => {
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

// Wrapper to lazy-load PvsTab (it's heavy with all the dialogs)
import { PvsTab } from '@/components/calidad/pvs-tab'

function PvsTabWrapper({ items, loading, onRefresh }: {
  items: CalidadItem[]
  loading: boolean
  onRefresh: () => Promise<void>
}) {
  return <PvsTab items={items} loading={loading} onRefresh={onRefresh} />
}
