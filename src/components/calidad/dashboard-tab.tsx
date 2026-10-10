'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  Area, AreaChart, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import {
  Package, CheckCircle2, Clock, AlertTriangle, XCircle, TrendingUp,
  Server, Activity, PieChart as PieIcon,
} from 'lucide-react'
import { formatDateTime } from '@/lib/time-tracking'

export interface DashboardData {
  total: number
  entregado: number
  atrasado: number
  porVencer: number
  enTiempo: number
  revisar: number
  shippedOnTime: number
  shippedLate: number
  notShipped: number
  bySource: { manual: number; almacen: number; excel: number }
  topClientes: { cliente: string; count: number }[]
  topPvs: { pv: string; count: number }[]
  onTimeRate: number
  statusDistribution: { name: string; value: number; color: string }[]
  onTimeTrend: { date: string; label: string; onTime: number; late: number; total: number; rate: number }[]
}

export interface SyncStatus {
  almacen: { status: string; message: string; createdAt: string } | null
  shipping: { status: string; message: string; createdAt: string } | null
}

export function DashboardTab({
  data,
  syncStatus,
}: {
  data: DashboardData | null
  syncStatus: SyncStatus | null
}) {
  if (!data) {
    return <div className="text-center py-12 text-muted-foreground">Cargando dashboard...</div>
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
        <StatCard icon={<Package className="h-4 w-4" />} label="Total partidas" value={data.total} tone="default" />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Entregados" value={data.entregado} tone="green" />
        <StatCard icon={<XCircle className="h-4 w-4" />} label="Retrasados" value={data.atrasado} tone="red" />
        <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="Por vencer" value={data.porVencer} tone="yellow" />
        <StatCard icon={<Clock className="h-4 w-4" />} label="En tiempo" value={data.enTiempo} tone="blue" />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Env. a tiempo" value={data.shippedOnTime} tone="green" />
        <StatCard icon={<Clock className="h-4 w-4" />} label="Env. tarde" value={data.shippedLate} tone="lime" />
      </section>

      {/* Sync status */}
      {syncStatus && (syncStatus.almacen || syncStatus.shipping) && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Server className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Última sincronización</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {syncStatus.almacen && <SyncCard title="Almacén" status={syncStatus.almacen} />}
              {syncStatus.shipping && <SyncCard title="Shipping Notice" status={syncStatus.shipping} />}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <PieIcon className="h-4 w-4" />
              Distribución por estado
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.statusDistribution.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                Sin datos para mostrar
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.statusDistribution}
                    cx="50%" cy="50%"
                    innerRadius={60} outerRadius={100}
                    paddingAngle={2} dataKey="value"
                    label={(entry: any) => `${entry.name}: ${entry.value}`}
                    labelLine={false}
                  >
                    {data.statusDistribution.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--background)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px', fontSize: '12px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              % de envíos a tiempo (últimos 14 días)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.onTimeTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} unit="%" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px', fontSize: '12px',
                  }}
                  formatter={(value: any, name: any) => {
                    if (name === 'rate') return [`${value}%`, '% a tiempo']
                    return [value, name]
                  }}
                />
                <Area type="monotone" dataKey="rate" stroke="#10b981" strokeWidth={2} fill="url(#colorRate)" name="rate" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top clientes + PVs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top 10 clientes</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topClientes.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">Sin datos</div>
            ) : (
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {data.topClientes.map((c, i) => (
                  <div key={c.cliente} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
                    <span className="text-sm flex-1 truncate" title={c.cliente}>{c.cliente}</span>
                    <Badge variant="secondary" className="tabular-nums">{c.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top 10 PVs con más partidas</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topPvs.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">Sin datos</div>
            ) : (
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {data.topPvs.map((p, i) => (
                  <div key={p.pv} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
                    <span className="font-mono text-sm flex-1 truncate">{p.pv}</span>
                    <Badge variant="secondary" className="tabular-nums">{p.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, tone }: {
  icon: React.ReactNode
  label: string
  value: number | string
  tone: 'default' | 'green' | 'lime' | 'yellow' | 'red' | 'blue'
}) {
  const toneClass = {
    default: 'border-border',
    green: 'border-green-300 bg-green-50/50 dark:bg-green-900/20',
    lime: 'border-lime-300 bg-lime-50/50 dark:bg-lime-900/20',
    yellow: 'border-yellow-300 bg-yellow-50/50 dark:bg-yellow-900/20',
    red: 'border-red-300 bg-red-50/50 dark:bg-red-900/20',
    blue: 'border-blue-300 bg-blue-50/50 dark:bg-blue-900/20',
  }[tone]
  return (
    <Card className={`${toneClass}`}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  )
}

function SyncCard({ title, status }: { title: string; status: { status: string; message: string; createdAt: string } }) {
  const ok = status.status === 'success'
  return (
    <div className={`p-3 rounded-lg border ${ok ? 'border-green-300 bg-green-50/50 dark:bg-green-900/20' : 'border-red-300 bg-red-50/50 dark:bg-red-900/20'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium">{title}</span>
        <Badge variant={ok ? 'default' : 'destructive'} className="text-[10px]">
          {ok ? 'OK' : 'Error'}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground mb-1">{formatDateTime(status.createdAt)}</div>
      <div className="text-xs truncate" title={status.message}>{status.message}</div>
    </div>
  )
}
