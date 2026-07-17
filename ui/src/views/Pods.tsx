/*
 * Pods — dense filterable table. Reads ?q= from the URL (set by the command
 * palette) as the initial filter.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import type { PodItem } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { StatusPill, Spinner, ErrorBox, Empty, Th, Td } from '@/components/ui'
import { cn } from '@/lib/utils'

function phaseTone(phase: string): 'good' | 'warning' | 'critical' | 'muted' {
  if (phase === 'Running') return 'good'
  if (phase === 'Pending' || phase === 'Unknown') return 'warning'
  if (phase === 'Failed') return 'critical'
  return 'muted'
}

export function Pods() {
  const { ns } = useOutletContext<ShellContext>()
  const [params] = useSearchParams()
  const [items, setItems] = useState<PodItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(params.get('q') ?? '')

  const load = useCallback(() => {
    setError('')
    api<{ items: PodItem[] }>('pods', { ns })
      .then((r) => { setItems(r.items); setLoading(false) })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [ns])

  useEffect(() => { setLoading(true); load() }, [load])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter((p) =>
      p.name.toLowerCase().includes(q) || p.namespace.toLowerCase().includes(q) ||
      (p.node || '').toLowerCase().includes(q) || p.phase.toLowerCase().includes(q),
    )
  }, [items, filter])

  if (loading && items.length === 0 && !error) return <Spinner text="Loading pods…" />
  if (error) return <ErrorBox error={error} onRetry={load} />

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, namespace, node, phase…"
          onKeyDown={(e) => { if (e.key === 'Escape') setFilter('') }}
          className="w-80 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <span className="text-xs text-ink-3">{filtered.length} / {items.length} pods</span>
        <button
          onClick={load}
          className="ml-auto flex items-center gap-1.5 rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-2 hover:text-ink"
        >
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <Empty>No pods match</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <Th>Namespace</Th><Th>Name</Th><Th>Phase</Th><Th>Ready</Th><Th>Restarts</Th><Th>Node</Th><Th>IP</Th><Th>Age</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={`${p.namespace}/${p.name}`} className="border-b border-line/50 hover:bg-raised/40">
                  <Td mono className="text-ink-2">{p.namespace}</Td>
                  <Td mono className="max-w-72 truncate">{p.name}</Td>
                  <Td><StatusPill kind={phaseTone(p.phase)}>{p.phase}</StatusPill></Td>
                  <Td mono>{p.ready}</Td>
                  <Td>
                    {p.restarts > 0
                      ? <StatusPill kind={p.restarts > 5 ? 'critical' : 'warning'}>{p.restarts}</StatusPill>
                      : <span className="text-ink-3">0</span>}
                  </Td>
                  <Td mono className="max-w-44 truncate text-ink-2">{p.node || ''}</Td>
                  <Td mono className="text-ink-2">{p.podIP || ''}</Td>
                  <Td className="text-ink-2">{p.age}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
