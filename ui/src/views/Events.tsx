/*
 * Events — newest first, warnings highlighted, type + text filters.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import type { EventItem } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { StatusPill, Spinner, ErrorBox, Empty, Th, Td } from '@/components/ui'
import { cn } from '@/lib/utils'

export function Events() {
  const { ns } = useOutletContext<ShellContext>()
  const [items, setItems] = useState<EventItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [type, setType] = useState<'all' | 'Warning' | 'Normal'>('all')

  const load = useCallback(() => {
    setError('')
    api<{ items: EventItem[] }>('events', { ns })
      .then((r) => { setItems(r.items); setLoading(false) })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [ns])

  useEffect(() => { setLoading(true); load() }, [load])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return items.filter((e) => {
      if (type !== 'all' && e.type !== type) return false
      if (!q) return true
      return [e.reason, e.object, e.message, e.namespace].some((v) => (v || '').toLowerCase().includes(q))
    })
  }, [items, filter, type])

  if (loading && items.length === 0 && !error) return <Spinner text="Loading events…" />
  if (error) return <ErrorBox error={error} onRetry={load} />

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by reason, object, message…"
          className="w-80 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="rounded border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
        >
          <option value="all">All types</option>
          <option value="Warning">Warning</option>
          <option value="Normal">Normal</option>
        </select>
        <span className="text-xs text-ink-3">{filtered.length} / {items.length} events</span>
        <button onClick={load} className="ml-auto flex items-center gap-1.5 rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-2 hover:text-ink">
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <Empty>No events match</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <Th>Type</Th><Th>Reason</Th><Th>Object</Th><Th>Message</Th><Th>Count</Th><Th>Last seen</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={i} className={cn('border-b border-line/50', e.type === 'Warning' ? 'bg-warning/5' : 'hover:bg-raised/40')}>
                  <Td><StatusPill kind={e.type === 'Warning' ? 'warning' : 'muted'}>{e.type}</StatusPill></Td>
                  <Td mono>{e.reason}</Td>
                  <Td mono className="max-w-56 truncate text-ink-2">
                    <div className="truncate">{e.object}</div>
                    <div className="text-[10px] text-ink-3">{e.namespace}</div>
                  </Td>
                  <Td className="max-w-xl text-ink-2"><span className="line-clamp-2">{e.message}</span></Td>
                  <Td mono className="text-ink-2">{e.count ?? ''}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{e.lastSeen ? new Date(e.lastSeen).toLocaleString() : ''}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
