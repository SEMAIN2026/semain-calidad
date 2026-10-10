'use client'

import { useMemo, useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import {
  RefreshCw, Plus, Pencil, Trash2, CalendarClock, Download, Search,
} from 'lucide-react'
import { formatDateTime, type TimeInfo } from '@/lib/time-tracking'

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

export function PvsTab({
  items,
  loading,
  onRefresh,
}: {
  items: CalidadItem[]
  loading: boolean
  onRefresh: () => Promise<void>
}) {
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [shippingFilter, setShippingFilter] = useState<string>('all')
  const [editOpen, setEditOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [refreshOpen, setRefreshOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<CalidadItem | null>(null)
  const [refreshTarget, setRefreshTarget] = useState<CalidadItem | null>(null)

  const filtered = useMemo(() => {
    return items.filter(it => {
      if (statusFilter !== 'all' && it.status !== statusFilter) return false
      if (shippingFilter !== 'all') {
        if (shippingFilter === 'none' && it.shippingStatus) return false
        if (shippingFilter !== 'none' && it.shippingStatus !== shippingFilter) return false
      }
      if (search) {
        const q = search.toLowerCase()
        const blob = `${it.pvNumber} ${it.itemNumber} ${it.description} ${it.notes || ''}`.toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [items, search, statusFilter, shippingFilter])

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      const res = await fetch(`/api/calidad/items/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'Item eliminado' })
        await onRefresh()
      } else {
        toast({ title: 'Error al eliminar', variant: 'destructive' })
      }
    } finally {
      setDeleteId(null)
    }
  }

  const handleRefreshDate = async (id: string, shippingDate: string | null, shippingStatus: string | null) => {
    try {
      const res = await fetch(`/api/calidad/items/${id}/refresh-date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shippingDate, shippingStatus }),
      })
      if (res.ok) {
        toast({ title: 'Fecha de envío actualizada' })
        setRefreshOpen(false)
        setRefreshTarget(null)
        await onRefresh()
      } else {
        const j = await res.json().catch(() => ({}))
        toast({ title: 'Error', description: j.error, variant: 'destructive' })
      }
    } catch (e: any) {
      toast({ title: 'Error de red', description: e?.message, variant: 'destructive' })
    }
  }

  const exportCSV = () => {
    const headers = ['PV', 'Item', 'Descripcion', 'Cantidad', 'Status', 'DiasEstimados', 'Creado', 'EnvioFecha', 'EnvioStatus', 'Notas', 'Origen']
    const rows = filtered.map(it => [
      it.pvNumber, it.itemNumber, it.description, it.quantity, it.status, it.estimatedDays,
      it.createdAt, it.shippingDate || '', it.shippingStatus || '', it.notes || '', it.source,
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `calidad-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs mb-1.5 block">Buscar</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="PV, item, descripción, notas..."
                  className="pl-8"
                />
              </div>
            </div>
            <div className="w-[160px]">
              <Label className="text-xs mb-1.5 block">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pendiente">Pendiente</SelectItem>
                  <SelectItem value="en_proceso">En proceso</SelectItem>
                  <SelectItem value="completado">Completado</SelectItem>
                  <SelectItem value="enviado">Enviado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-[180px]">
              <Label className="text-xs mb-1.5 block">Envío</Label>
              <Select value={shippingFilter} onValueChange={setShippingFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="none">Sin envío</SelectItem>
                  <SelectItem value="a_tiempo">A tiempo</SelectItem>
                  <SelectItem value="tarde">Tarde</SelectItem>
                  <SelectItem value="no_enviado">No enviado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatusFilter('all'); setShippingFilter('all') }}>
              Limpiar
            </Button>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline ml-1.5">CSV</span>
              </Button>
              <Button size="sm" onClick={() => { setEditing(null); setCreateOpen(true) }}>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline ml-1.5">Agregar</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Items de Calidad ({filtered.length})</span>
            {loading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[110px]">PV</TableHead>
                  <TableHead className="w-[70px]">Item</TableHead>
                  <TableHead className="min-w-[200px]">Descripción</TableHead>
                  <TableHead className="w-[60px] text-right">Cant.</TableHead>
                  <TableHead className="w-[110px]">Status</TableHead>
                  <TableHead className="w-[140px]">Tiempo usado</TableHead>
                  <TableHead className="w-[130px]">Fecha envío</TableHead>
                  <TableHead className="w-[110px]">Estado envío</TableHead>
                  <TableHead className="w-[130px] text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(it => (
                  <TableRow key={it.id} className={it.time.rowClass}>
                    <TableCell className="font-mono text-xs">
                      <div className="flex flex-col">
                        <span className="font-semibold">{it.pvNumber}</span>
                        {it.source !== 'manual' && (
                          <span className="text-[10px] text-muted-foreground">{it.source}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{it.itemNumber}</TableCell>
                    <TableCell className="max-w-[300px]">
                      <div className="truncate" title={it.description}>{it.description}</div>
                      {it.notes && (
                        <div className="text-[10px] text-muted-foreground truncate" title={it.notes}>
                          {it.notes}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{it.quantity}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {statusLabel(it.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/20">
                          <div
                            className={`h-full rounded-full transition-all ${
                              it.time.state === 'overdue' ? 'bg-red-500'
                              : it.time.state === 'warning' ? 'bg-yellow-500'
                              : it.time.state === 'shipped_on_time' ? 'bg-green-500'
                              : it.time.state === 'shipped_late' ? 'bg-lime-500'
                              : 'bg-primary'
                            }`}
                            style={{ width: `${Math.min(100, it.time.usedPercent)}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {it.time.daysUsed.toFixed(1)} / {it.time.daysEstimated}d
                          {it.time.daysRemaining > 0 && it.time.state === 'normal' && (
                            <span> · {it.time.daysRemaining.toFixed(1)}d restantes</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {it.shippingDate ? formatDateTime(it.shippingDate) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${it.time.badgeClass}`}>
                        {shippingLabel(it.shippingStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 px-2">···</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => { setEditing(it); setEditOpen(true) }}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setRefreshTarget(it); setRefreshOpen(true) }}>
                            <CalendarClock className="h-3.5 w-3.5 mr-2" /> Actualizar fecha
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteId(it.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                      No hay items. Usa el botón de sincronizar o agrega uno manualmente.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 text-xs">
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-green-100 dark:bg-green-900/40 border border-green-300" />
              Enviado a tiempo
            </span>
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-lime-100 dark:bg-lime-900/40 border border-lime-300" />
              Enviado tarde
            </span>
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-yellow-100 dark:bg-yellow-900/40 border border-yellow-300" />
              90% del tiempo usado
            </span>
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-red-100 dark:bg-red-900/40 border border-red-300" />
              Tiempo agotado (no enviado)
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      {createOpen && (
        <ItemDialog
          key="create"
          open={createOpen}
          onOpenChange={setCreateOpen}
          item={null}
          onSave={async (data) => {
            const res = await fetch('/api/calidad/items', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            })
            const json = await res.json()
            if (!res.ok) {
              toast({ title: 'Error', description: json.error, variant: 'destructive' })
              return false
            }
            toast({ title: 'Item creado' })
            setCreateOpen(false)
            await onRefresh()
            return true
          }}
        />
      )}
      {editOpen && editing && (
        <ItemDialog
          key={`edit-${editing.id}`}
          open={editOpen}
          onOpenChange={setEditOpen}
          item={editing}
          onSave={async (data) => {
            const res = await fetch(`/api/calidad/items/${editing.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            })
            const json = await res.json()
            if (!res.ok) {
              toast({ title: 'Error', description: json.error, variant: 'destructive' })
              return false
            }
            toast({ title: 'Item actualizado' })
            setEditOpen(false)
            setEditing(null)
            await onRefresh()
            return true
          }}
        />
      )}

      {/* Refresh date dialog */}
      {refreshOpen && refreshTarget && (
        <RefreshDateDialog
          key={`refresh-${refreshTarget.id}`}
          open={refreshOpen}
          onOpenChange={setRefreshOpen}
          item={refreshTarget}
          onSave={async (date, status) => {
            await handleRefreshDate(refreshTarget.id, date, status)
            return true
          }}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este item?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El item se quitará permanentemente de la tabla de calidad.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function statusLabel(s: string): string {
  switch (s) {
    case 'pendiente': return 'Pendiente'
    case 'en_proceso': return 'En proceso'
    case 'completado': return 'Completado'
    case 'enviado': return 'Enviado'
    default: return s
  }
}

function shippingLabel(s: string | null): string {
  switch (s) {
    case 'a_tiempo': return 'A tiempo'
    case 'tarde': return 'Tarde'
    case 'no_enviado': return 'No enviado'
    default: return '—'
  }
}

function ItemDialog({ open, onOpenChange, item, onSave }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  item: CalidadItem | null
  onSave: (data: any) => Promise<boolean>
}) {
  const [pvNumber, setPvNumber] = useState(item?.pvNumber ?? '')
  const [itemNumber, setItemNumber] = useState(item?.itemNumber ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1))
  const [estimatedDays, setEstimatedDays] = useState(String(item?.estimatedDays ?? 7))
  const [status, setStatus] = useState(item?.status ?? 'pendiente')
  const [notes, setNotes] = useState(item?.notes ?? '')

  const submit = async () => {
    if (!pvNumber || !itemNumber || !description) return
    await onSave({
      pvNumber, itemNumber, description,
      quantity: Number(quantity) || 1,
      estimatedDays: Number(estimatedDays) || 7,
      status, notes: notes || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? 'Editar item' : 'Nuevo item'}</DialogTitle>
          <DialogDescription>
            {item ? 'Edita los campos y guarda los cambios.' : 'Agrega un item manualmente a la tabla de calidad.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">PV *</Label>
            <Input value={pvNumber} onChange={e => setPvNumber(e.target.value)} placeholder="PV-1234" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Item *</Label>
            <Input value={itemNumber} onChange={e => setItemNumber(e.target.value)} placeholder="1" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Descripción *</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Cantidad</Label>
            <Input type="number" min={1} value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Días estimados</Label>
            <Input type="number" min={1} value={estimatedDays} onChange={e => setEstimatedDays(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="en_proceso">En proceso</SelectItem>
                <SelectItem value="completado">Completado</SelectItem>
                <SelectItem value="enviado">Enviado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Notas</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit}>{item ? 'Guardar' : 'Crear'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RefreshDateDialog({ open, onOpenChange, item, onSave }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  item: CalidadItem | null
  onSave: (date: string | null, status: string | null) => Promise<boolean>
}) {
  const [date, setDate] = useState(
    item?.shippingDate ? new Date(item.shippingDate).toISOString().slice(0, 16) : ''
  )
  const [status, setStatus] = useState<string>(item?.shippingStatus ?? '')

  const submit = async () => {
    await onSave(date ? new Date(date).toISOString() : null, status || null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Actualizar fecha de envío</DialogTitle>
          <DialogDescription>
            A veces la fecha se actualiza después del primer sync. Modifícala aquí manualmente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Fecha de envío</Label>
            <Input
              type="datetime-local"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Estado del envío</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Sin estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="a_tiempo">A tiempo</SelectItem>
                <SelectItem value="tarde">Tarde</SelectItem>
                <SelectItem value="no_enviado">No enviado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {item && (
            <div className="text-xs text-muted-foreground p-2 bg-muted rounded">
              Item: <span className="font-mono">{item.pvNumber} / {item.itemNumber}</span>
              <br />
              {item.description}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
