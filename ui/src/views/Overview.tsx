/*
 * Overview — pod phases, container readiness, restarts, node usage.
 */
import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import type { OverviewResult } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { Card, StatusPill, Meter, Spinner, ErrorBox, Th, Td } from '@/components/ui'
import { cn } from '@/lib/utils'

const PHASE_TONE: Record<string, 'good' | 'warning' | 'critical' | 'muted'> = {
  Running: 'good', Succeeded: 'muted', Pending: 'warning', Failed: 'critical', Unknown: 'warning',
}

export function Overview() {
  const { ns } = useOutletContext<ShellContext>()
  const [data, setData] = useState<OverviewResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setError('')
    api<OverviewResult>('overview', { ns })
      .then((r) => { setData(r); setLoading(false) })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [ns])

  useEffect(() => { setLoading(true); load() }, [load])

  if (loading && !data) return <Spinner text="Loading overview…" />
  if (error && !data) return <ErrorBox error={error} onRetry={load} />
  if (!data) return null

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card title="Pods">
          <div className="text-3xl font-bold tabular-nums">{data.totalPods}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(data.phases).map(([phase, count]) => (
              <span key={phase} className="flex items-center gap-1">
                <StatusPill kind={PHASE_TONE[phase] ?? 'muted'}>{phase}</StatusPill>
                <span className="font-mono text-xs tabular-nums">{count}</span>
              </span>
            ))}
          </div>
        </Card>
        <Card title="Containers ready">
          <div className="text-3xl font-bold tabular-nums">
            {data.containersReady}<span className="text-lg text-ink-3"> / {data.containersTotal}</span>
          </div>
          <div className="mt-2">
            <Meter pct={data.containersTotal ? Math.round((data.containersReady / data.containersTotal) * 100) : null} />
          </div>
        </Card>
        <Card title="Total restarts">
          <div className={cn('text-3xl font-bold tabular-nums', data.restarts > 50 ? 'text-warning' : '')}>{data.restarts}</div>
          <div className="mt-1 text-[11px] text-ink-3">across all containers in scope</div>
        </Card>
        <Card title="Nodes">
          <div className="text-3xl font-bold tabular-nums">{data.nodes.length}</div>
          <div className="mt-1 text-[11px] text-ink-3">
            {data.nodes.filter((n) => n.ready).length} ready{!data.metrics && ' · metrics-server not detected'}
          </div>
          <button onClick={load} className="mt-2 flex items-center gap-1.5 rounded border border-line bg-raised px-2 py-1 text-[11px] text-ink-2 hover:text-ink">
            <RefreshCw className={cn('size-3', loading && 'animate-spin')} /> Refresh
          </button>
        </Card>
      </div>

      <Card title={`Node usage (${data.nodes.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <Th>Node</Th><Th>Ready</Th><Th>Kubelet</Th><Th className="w-40">CPU</Th><Th className="w-40">Memory</Th>
              </tr>
            </thead>
            <tbody>
              {data.nodes.map((n) => (
                <tr key={n.name} className="border-b border-line/50 hover:bg-raised/40">
                  <Td mono className="max-w-64 truncate">{n.name}</Td>
                  <Td>{n.ready ? <StatusPill kind="good">Ready</StatusPill> : <StatusPill kind="critical">NotReady</StatusPill>}</Td>
                  <Td mono className="text-ink-2">{n.version}</Td>
                  <Td>{n.usage ? <Meter pct={parseInt(n.usage.cpuPct, 10) || null} label={`${n.usage.cpu} · ${n.usage.cpuPct}`} /> : <span className="text-[11px] text-ink-3">n/a</span>}</Td>
                  <Td>{n.usage ? <Meter pct={parseInt(n.usage.memPct, 10) || null} label={`${n.usage.mem} · ${n.usage.memPct}`} /> : <span className="text-[11px] text-ink-3">n/a</span>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
