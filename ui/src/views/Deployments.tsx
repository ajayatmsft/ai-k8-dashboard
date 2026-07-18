/*
 * Deployments — dense table with replica status; the Logs action jumps to the
 * aggregate Logs view pre-filtered to the deployment's pods.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { RefreshCw, ScrollText } from 'lucide-react'
import { api } from '@/lib/api'
import type { DeploymentItem } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { StatusPill, Spinner, ErrorBox, Empty, Th, Td } from '@/components/ui'
import { cn } from '@/lib/utils'

export function Deployments() {
  const { ns } = useOutletContext<ShellContext>()
  const navigate = useNavigate()
  const [items, setItems] = useState<DeploymentItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const load = useCallback(() => {
    setError('')
    api<{ items: DeploymentItem[] }>('deployments', { ns })
      .then((r) => { setItems(r.items); setLoading(false) })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [ns])

  useEffect(() => { setLoading(true); load() }, [load])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter((d) => d.name.toLowerCase().includes(q) || d.namespace.toLowerCase().includes(q))
  }, [items, filter])

  if (loading && items.length === 0 && !error) return <Spinner text="Loading deployments…" />
  if (error) return <ErrorBox error={error} onRetry={load} />

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or namespace…"
          className="w-80 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <span className="text-xs text-ink-3">{filtered.length} / {items.length} deployments</span>
        <button onClick={load} className="ml-auto flex items-center gap-1.5 rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-2 hover:text-ink">
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <Empty>No deployments match</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <Th>Namespace</Th><Th>Name</Th><Th>Ready</Th><Th>Updated</Th><Th>Available</Th><Th>Age</Th><Th>Images</Th><Th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const healthy = d.ready === d.desired && d.desired > 0
                return (
                  <tr key={`${d.namespace}/${d.name}`} className="border-b border-line/50 hover:bg-raised/40">
                    <Td mono className="text-ink-2">{d.namespace}</Td>
                    <Td mono className="max-w-64 truncate">{d.name}</Td>
                    <Td>
                      <StatusPill kind={healthy ? 'good' : d.ready === 0 ? 'critical' : 'warning'}>
                        {d.ready}/{d.desired}
                      </StatusPill>
                    </Td>
                    <Td mono>{d.updated}</Td>
                    <Td mono>{d.available}</Td>
                    <Td className="text-ink-2">{d.age}</Td>
                    <Td mono className="max-w-72 truncate text-[11px] text-ink-3" >{d.images.join(', ')}</Td>
                    <Td>
                      <button
                        onClick={() => navigate(`/logs?ns=${encodeURIComponent(d.namespace)}&regex=${encodeURIComponent(d.name)}`)}
                        className="flex items-center gap-1 rounded border border-line bg-raised px-2 py-0.5 text-[11px] text-ink-2 hover:text-ink"
                        title="Aggregate logs for this deployment's pods"
                      >
                        <ScrollText className="size-3" /> Logs
                      </button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
