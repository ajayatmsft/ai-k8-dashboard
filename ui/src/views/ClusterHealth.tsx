/*
 * Cluster Health — the landing view. Hero score + cluster meters + severity
 * counts, then issues (with concrete fixes), node table with per-node memory
 * attribution, and top consumers.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { RefreshCw, ScrollText, Activity } from 'lucide-react'
import { api } from '@/lib/api'
import type { HealthReport, HealthIssue, TopContainer, Severity } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { Card, SevPill, StatusPill, Meter, ScoreRing, Spinner, ErrorBox, Empty, Th, Td } from '@/components/ui'
import { TopProcessesModal } from '@/components/ExecModal'
import { cn } from '@/lib/utils'

export function ClusterHealth() {
  const { ns } = useOutletContext<ShellContext>()
  const [report, setReport] = useState<HealthReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setError('')
    api<HealthReport>('clusterHealth', { ns })
      .then((r) => { setReport(r); setLoading(false) })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [ns])

  useEffect(() => {
    setLoading(true)
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  if (loading && !report) return <Spinner text="Analyzing cluster health…" />
  if (error && !report) return <ErrorBox error={error} onRetry={load} />
  if (!report) return null

  const gradeTone = report.score >= 90 ? 'good' : report.score >= 70 ? 'warning' : 'critical'

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* headline row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card className="md:col-span-1">
          <div className="flex items-center gap-3">
            <ScoreRing score={report.score} />
            <div className="min-w-0">
              <StatusPill kind={gradeTone}>{report.grade}</StatusPill>
              <p className="mt-2 text-xs leading-relaxed text-ink-2">{report.summary}</p>
            </div>
          </div>
        </Card>
        <Card title="Cluster CPU">
          <Meter pct={report.cluster.cpuPct} />
          <div className="mt-2 font-mono text-sm">{report.cluster.cpuText}</div>
          <div className="text-[11px] text-ink-3">used / allocatable</div>
        </Card>
        <Card title="Cluster memory">
          <Meter pct={report.cluster.memPct} />
          <div className="mt-2 font-mono text-sm">{report.cluster.memText}</div>
          <div className="text-[11px] text-ink-3">used / allocatable</div>
        </Card>
        <Card title="Issues by severity">
          <div className="flex flex-wrap gap-1.5">
            {(['critical', 'high', 'medium', 'low'] as Severity[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <SevPill sev={s} />
                <span className="font-mono text-sm tabular-nums">{report.counts[s] || 0}</span>
              </span>
            ))}
          </div>
          <button
            onClick={load}
            className="mt-3 flex items-center gap-1.5 rounded border border-line bg-raised px-2 py-1 text-[11px] text-ink-2 hover:text-ink"
          >
            <RefreshCw className={cn('size-3', loading && 'animate-spin')} /> Refresh · auto 30s
          </button>
        </Card>
      </div>

      {!report.metricsAvailable && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-xs text-ink-2">
          <span className="font-semibold text-warning">metrics-server not detected</span> — usage meters and
          leak detection are limited. Install metrics-server in the cluster to enable them.
        </div>
      )}

      {/* issues */}
      <Card title={`Issues (${report.issues.length})`}>
        {report.issues.length === 0 ? (
          <Empty>No memory, CPU, crash, or OOM problems detected. 🎉</Empty>
        ) : (
          <ul className="space-y-3">
            {report.issues.map((issue, i) => <IssueRow key={i} issue={issue} />)}
          </ul>
        )}
      </Card>

      {/* nodes */}
      <Card title={`Nodes (${report.nodes.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <Th>Node</Th><Th>Ready</Th><Th>Pool / SKU</Th><Th className="w-44">CPU</Th><Th className="w-44">Memory</Th><Th>Top memory consumers</Th>
              </tr>
            </thead>
            <tbody>
              {report.nodes.map((n) => (
                <tr key={n.name} className="border-b border-line/50 hover:bg-raised/40">
                  <Td mono className="max-w-52 truncate" >{n.name}</Td>
                  <Td>
                    {n.ready ? <StatusPill kind="good">Ready</StatusPill> : <StatusPill kind="critical">NotReady</StatusPill>}
                    {n.pressure.map((p) => <StatusPill key={p} kind="critical">{p}</StatusPill>)}
                  </Td>
                  <Td className="text-ink-2">{[n.pool, n.sku].filter(Boolean).join(' / ') || '—'}</Td>
                  <Td><Meter pct={n.cpuPct} label={n.cpuText ?? '–'} /></Td>
                  <Td><Meter pct={n.memPct} label={n.memText ?? '–'} /></Td>
                  <Td className="text-[11px] text-ink-2">
                    {n.topConsumers.slice(0, 3).map((c) => (
                      <div key={`${c.namespace}/${c.pod}/${c.container}`} className="truncate font-mono">
                        {c.pod}/{c.container} <span className="text-ink-3">{c.memText}{c.memPctOfNode != null ? ` · ${c.memPctOfNode}%` : ''}</span>
                      </div>
                    ))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* top consumers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopTable title="Top memory consumers" rows={report.topMemory} kind="mem" />
        <TopTable title="Top CPU consumers" rows={report.topCpu} kind="cpu" />
      </div>
    </div>
  )
}

function IssueRow({ issue }: { issue: HealthIssue }) {
  const { readOnly, execEnabled } = useOutletContext<ShellContext>()
  const navigate = useNavigate()
  const [procs, setProcs] = useState(false)
  const target = [issue.namespace, issue.pod, issue.container].filter(Boolean).join(' / ') || issue.node
  const edge = {
    critical: 'border-l-critical', high: 'border-l-serious', medium: 'border-l-warning', low: 'border-l-line',
  }[issue.severity]

  return (
    <li className={cn('rounded-lg border border-l-4 border-line bg-raised/40 p-3 transition-colors hover:bg-raised/70', edge)}>
      <div className="flex flex-wrap items-center gap-2">
        <SevPill sev={issue.severity} />
        <span className="font-semibold">{issue.title}</span>
        {target && <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-3">{target}</span>}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{issue.detail}</p>
      <p className="mt-1 text-xs leading-relaxed">
        <span className="font-semibold text-accent">Fix: </span>
        <span className="text-ink-2">{issue.fix}</span>
      </p>
      {issue.pod && (
        <div className="mt-2 flex gap-1.5">
          {execEnabled && !readOnly && issue.container && (
            <button onClick={() => setProcs(true)}
              className="flex items-center gap-1 rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink">
              <Activity className="size-3" /> Top processes
            </button>
          )}
          <button
            onClick={() => navigate(`/logs?ns=${encodeURIComponent(issue.namespace ?? '_all')}&regex=${encodeURIComponent(issue.pod ?? '')}`)}
            className="flex items-center gap-1 rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink">
            <ScrollText className="size-3" /> Logs
          </button>
        </div>
      )}
      {procs && issue.pod && (
        <TopProcessesModal ns={issue.namespace ?? 'default'} pod={issue.pod} container={issue.container} onClose={() => setProcs(false)} />
      )}
    </li>
  )
}

function TopTable({ title, rows, kind }: { title: string; rows: TopContainer[]; kind: 'mem' | 'cpu' }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <Empty>No usage data (metrics-server required)</Empty>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <Th>Container</Th>
              <Th className="w-24">{kind === 'mem' ? 'Memory' : 'CPU'}</Th>
              {kind === 'mem' && <Th className="w-36">vs limit</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={`${c.namespace}/${c.pod}/${c.container}`} className="border-b border-line/50">
                <Td mono className="max-w-64">
                  <div className="truncate">{c.pod}/{c.container}</div>
                  <div className="text-[10px] text-ink-3">{c.namespace}</div>
                </Td>
                <Td mono>{kind === 'mem' ? c.memText : c.cpuText}</Td>
                {kind === 'mem' && (
                  <Td>
                    {c.memPctOfLimit != null
                      ? <Meter pct={c.memPctOfLimit} label={`${c.memPctOfLimit}% of ${c.memLimitText}`} />
                      : <span className="text-[11px] text-ink-3">no limit</span>}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
