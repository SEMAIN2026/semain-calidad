'use client'

import { useMemo, useState } from 'react'
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
import { formatDateTime, formatDate } from '@/lib/time-tracking'

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

const ESTADO_COLORS: Record<string, string> = {
  'Entregado': 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-300',
  'ATRASADO': 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300',
  'POR VENCER': 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-300',
  'EN TIEMPO': 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300',
  'REVISAR': 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-300',
  'REVISAR TE': 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-300',
}

const SHIPPING_COLORS: Record<string, string> = {
  'a_tiempo': 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-300',
  'tarde': 'bg-lime-100 text-lime-800 border-lime-300 dark:bg-lime-900/40 dark:text-lime-300',
  'no_enviado': 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-900/40 dark:text-gray-300',
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
  const [estadoFilter, setEstadoFilter] = useState<string>('all')
  const [shippingFilter, setShippingFilter] = useState<string>('all')
  const [editOpen, setEditOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [refreshOpen, setRefreshOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<CalidadItem | null>(null)
  const [refreshTarget, setRefreshTarget] = useState<CalidadItem | null>(null)

  const filtered = useMemo(() => {
    return items.filter(it => {
      if (estadoFilter !== 'all' && it.estado !== estadoFilter) return false
      if (shippingFilter !== 'all') {
        if (shippingFilter === 'none' && it.shippingStatus) return false
        if (shippingFilter !== 'none' && it.shippingStatus !== shippingFilter) return false
      }
      if (search) {
        const q = search.toLowerCase()
        const blob = `${it.pvNumber} ${it.concepto} ${it.cliente || ''} ${it.clave || ''} ${it.notes || ''}`.toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [items, search, estadoFilter, shippingFilter])

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

  const handleRefreshDate = async (id: string, data: any) => {
    try {
      const res = await fetch(`/api/calidad/items/${id}/refresh-date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
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
    const headers = [
      'PV', 'Linea', 'Cliente', 'Concepto', 'Clave', 'Cantidad',
      'Fecha PV', 'Fecha Inicio', 'TE texto', 'TE dias',
      'Fecha Entrega Estimada', 'Fecha Reprogramada',
      'Estado', 'Embarque', 'Shipping Fecha', 'Shipping Status',
      'Guia', 'Paqueteria', 'Notas', 'Origen',
    ]
    const rows = filtered.map(it => [
      it.pvNumber, it.itemLine, it.cliente || '', it.concepto, it.clave || '', it.cantidad,
      it.fechaPv || '', it.fechaInicio || '', it.teTexto || '', it.teDias || '',
      it.fechaEntregaEstimada || '', it.fechaReprogramada || '',
      it.estado, it.embarque || '', it.shippingDate || '', it.shippingStatus || '',
      it.guia || '', it.paqueteria || '', it.notes || '', it.source,
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `calidad-pv-${new Date().toISOString().slice(0, 10)}.csv`
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
                  placeholder="PV, concepto, cliente, clave..."
                  className="pl-8"
                />
              </div>
            </div>
            <div className="w-[160px]">
              <Label className="text-xs mb-1.5 block">Estado</Label>
              <Select value={estadoFilter} onValueChange={setEstadoFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="Entregado">Entregado</SelectItem>
                  <SelectItem value="ATRASADO">Atrasado</SelectItem>
                  <SelectItem value="POR VENCER">Por vencer</SelectItem>
                  <SelectItem value="EN TIEMPO">En tiempo</SelectItem>
                  <SelectItem value="REVISAR">Revisar</SelectItem>
                  <SelectItem value="REVISAR TE">Revisar TE</SelectItem>
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
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setEstadoFilter('all'); setShippingFilter('all') }}>
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

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Seguimiento de PV ({filtered.length})</span>
            {loading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[90px]">PV</TableHead>
                  <TableHead className="w-[40px]">#</TableHead>
                  <TableHead className="min-w-[200px]">Concepto</TableHead>
                  <TableHead className="min-w-[120px]">Cliente</TableHead>
                  <TableHead className="w-[60px] text-right">Cant.</TableHead>
                  <TableHead className="w-[90px]">Fecha PV</TableHead>
                  <TableHead className="w-[80px]">TE</TableHead>
                  <TableHead className="w-[90px]">Entrega est.</TableHead>
                  <TableHead className="w-[100px]">Estado</TableHead>
                  <TableHead className="w-[90px]">Fecha envío</TableHead>
                  <TableHead className="w-[90px]">Status envío</TableHead>
                  <TableHead className="w-[80px]">Guía</TableHead>
                  <TableHead className="w-[80px] text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(it => (
                  <TableRow key={it.id} className={rowColorForEstado(it.estado, it.shippingStatus)}>
                    <TableCell className="font-mono text-xs font-semibold">{it.pvNumber}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{it.itemLine}</TableCell>
                    <TableCell className="max-w-[300px]">
                      <div className="truncate" title={it.concepto}>{it.concepto}</div>
                      {it.clave && (
                        <div className="text-[10px] text-muted-foreground font-mono">{it.clave}</div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[150px]">
                      <div className="truncate text-xs" title={it.cliente || ''}>{it.cliente || '—'}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{it.cantidad}</TableCell>
                    <TableCell className="text-xs">{formatDate(it.fechaPv)}</TableCell>
                    <TableCell className="text-xs">
                      {it.teTexto ? (
                        <span title={`${it.teDias || 0} días`}>{it.teTexto}</span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-xs">{formatDate(it.fechaEntregaEstimada)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${ESTADO_COLORS[it.estado] || ''}`}>
                        {it.estado}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{formatDate(it.shippingDate)}</TableCell>
                    <TableCell>
                      {it.shippingStatus ? (
                        <Badge variant="outline" className={`text-[10px] ${SHIPPING_COLORS[it.shippingStatus] || ''}`}>
                          {shippingLabel(it.shippingStatus)}
                        </Badge>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-xs font-mono truncate max-w-[80px]" title={it.guia || ''}>
                      {it.guia || '—'}
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
                    <TableCell colSpan={13} className="text-center py-12 text-muted-foreground">
                      No hay items. Importa el Excel o agrega uno manualmente.
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
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-green-100 border border-green-300" /> Entregado
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-red-100 border border-red-300" /> Atrasado
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300" /> Por vencer
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-blue-100 border border-blue-300" /> En tiempo
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-purple-100 border border-purple-300" /> Revisar
            </span>
            <span className="mx-3 text-muted-foreground">|</span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-green-200 border border-green-400" /> Envío a tiempo
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-lime-200 border border-lime-400" /> Envío tarde
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
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
      {refreshOpen && refreshTarget && (
        <RefreshDateDialog
          key={`refresh-${refreshTarget.id}`}
          open={refreshOpen}
          onOpenChange={setRefreshOpen}
          item={refreshTarget}
          onSave={async (data) => {
            await handleRefreshDate(refreshTarget.id, data)
            return true
          }}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este item?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El item se quitará permanentemente.
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

function rowColorForEstado(estado: string, shippingStatus: string | null): string {
  if (shippingStatus === 'a_tiempo') return 'bg-green-50/50 dark:bg-green-900/20'
  if (shippingStatus === 'tarde') return 'bg-lime-50/50 dark:bg-lime-900/20'
  switch (estado) {
    case 'ATRASADO': return 'bg-red-50/50 dark:bg-red-900/20'
    case 'POR VENCER': return 'bg-yellow-50/50 dark:bg-yellow-900/20'
    case 'REVISAR':
    case 'REVISAR TE': return 'bg-purple-50/50 dark:bg-purple-900/20'
    default: return ''
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
  const [itemLine, setItemLine] = useState(String(item?.itemLine ?? 1))
  const [cliente, setCliente] = useState(item?.cliente ?? '')
  const [concepto, setConcepto] = useState(item?.concepto ?? '')
  const [clave, setClave] = useState(item?.clave ?? '')
  const [cantidad, setCantidad] = useState(String(item?.cantidad ?? 1))
  const [fechaPv, setFechaPv] = useState(item?.fechaPv ? item.fechaPv.slice(0, 10) : '')
  const [fechaInicio, setFechaInicio] = useState(item?.fechaInicio ? item.fechaInicio.slice(0, 10) : '')
  const [teTexto, setTeTexto] = useState(item?.teTexto ?? '')
  const [teDias, setTeDias] = useState(item?.teDias != null ? String(item.teDias) : '')
  const [fechaEntregaEstimada, setFechaEntregaEstimada] = useState(item?.fechaEntregaEstimada ? item.fechaEntregaEstimada.slice(0, 10) : '')
  const [estado, setEstado] = useState(item?.estado ?? 'EN TIEMPO')
  const [embarque, setEmbarque] = useState(item?.embarque ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')

  const submit = async () => {
    if (!pvNumber || !concepto) return
    await onSave({
      pvNumber,
      itemLine: Number(itemLine) || 1,
      cliente: cliente || null,
      concepto,
      clave: clave || null,
      cantidad: Number(cantidad) || 1,
      fechaPv: fechaPv || null,
      fechaInicio: fechaInicio || null,
      teTexto: teTexto || null,
      teDias: teDias ? Number(teDias) : null,
      fechaEntregaEstimada: fechaEntregaEstimada || null,
      estado,
      embarque: embarque || null,
      notes: notes || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? 'Editar item' : 'Nuevo item'}</DialogTitle>
          <DialogDescription>
            {item ? 'Edita los campos y guarda los cambios.' : 'Agrega un item manualmente.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">PV *</Label>
            <Input value={pvNumber} onChange={e => setPvNumber(e.target.value)} placeholder="PV 1290" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Línea</Label>
            <Input type="number" min={1} value={itemLine} onChange={e => setItemLine(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Concepto *</Label>
            <Textarea value={concepto} onChange={e => setConcepto(e.target.value)} rows={2} placeholder="MANDRIL CON TAPAS | G90A5-0E020 MANDREL" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Cliente</Label>
            <Input value={cliente} onChange={e => setCliente(e.target.value)} placeholder="TOYODA GOSEI RUBBER MEXICO" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Clave</Label>
            <Input value={clave} onChange={e => setClave(e.target.value)} placeholder="MAN-NVO-01" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Cantidad</Label>
            <Input type="number" min={1} value={cantidad} onChange={e => setCantidad(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Estado</Label>
            <Select value={estado} onValueChange={setEstado}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EN TIEMPO">En tiempo</SelectItem>
                <SelectItem value="POR VENCER">Por vencer</SelectItem>
                <SelectItem value="ATRASADO">Atrasado</SelectItem>
                <SelectItem value="Entregado">Entregado</SelectItem>
                <SelectItem value="REVISAR">Revisar</SelectItem>
                <SelectItem value="REVISAR TE">Revisar TE</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Fecha PV</Label>
            <Input type="date" value={fechaPv} onChange={e => setFechaPv(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Fecha inicio</Label>
            <Input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">TE (texto)</Label>
            <Input value={teTexto} onChange={e => setTeTexto(e.target.value)} placeholder="3 SEMANAS" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">TE (días)</Label>
            <Input type="number" value={teDias} onChange={e => setTeDias(e.target.value)} placeholder="21" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Fecha entrega estimada</Label>
            <Input type="date" value={fechaEntregaEstimada} onChange={e => setFechaEntregaEstimada(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Embarque</Label>
            <Input value={embarque} onChange={e => setEmbarque(e.target.value)} placeholder="x" />
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
  onSave: (data: any) => Promise<boolean>
}) {
  const [shippingDate, setShippingDate] = useState(
    item?.shippingDate ? item.shippingDate.slice(0, 16) : ''
  )
  const [shippingStatus, setShippingStatus] = useState<string>(item?.shippingStatus ?? '')
  const [fechaReprogramada, setFechaReprogramada] = useState(
    item?.fechaReprogramada ? item.fechaReprogramada.slice(0, 10) : ''
  )
  const [guia, setGuia] = useState(item?.guia ?? '')
  const [paqueteria, setPaqueteria] = useState(item?.paqueteria ?? '')

  const submit = async () => {
    await onSave({
      shippingDate: shippingDate ? new Date(shippingDate).toISOString() : null,
      shippingStatus: shippingStatus || null,
      fechaReprogramada: fechaReprogramada ? new Date(fechaReprogramada).toISOString() : null,
      guia: guia || null,
      paqueteria: paqueteria || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Actualizar fecha de envío</DialogTitle>
          <DialogDescription>
            A veces la fecha se actualiza después del primer sync. Modifícala aquí.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {item && (
            <div className="text-xs text-muted-foreground p-2 bg-muted rounded">
              <span className="font-mono">{item.pvNumber} #{item.itemLine}</span>
              <br />
              <span className="truncate block">{item.concepto}</span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Fecha de envío</Label>
            <Input type="datetime-local" value={shippingDate} onChange={e => setShippingDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Estado del envío</Label>
            <Select value={shippingStatus} onValueChange={setShippingStatus}>
              <SelectTrigger><SelectValue placeholder="Sin estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="a_tiempo">A tiempo</SelectItem>
                <SelectItem value="tarde">Tarde</SelectItem>
                <SelectItem value="no_enviado">No enviado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Fecha reprogramada</Label>
            <Input type="date" value={fechaReprogramada} onChange={e => setFechaReprogramada(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Guía</Label>
            <Input value={guia} onChange={e => setGuia(e.target.value)} placeholder="Número de guía" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Paquetería</Label>
            <Input value={paqueteria} onChange={e => setPaqueteria(e.target.value)} placeholder="DHL, ESTAFETA..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
