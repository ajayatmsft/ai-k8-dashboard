/*
 * Pods — dense filterable table. Reads ?q= from the URL (set by the command
 * palette) as the initial filter.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { RefreshCw, ScrollText, FileText, Trash2, Terminal } from 'lucide-react'
import { api, post } from '@/lib/api'
import type { PodItem } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { StatusPill, Spinner, ErrorBox, Empty, Th, Td } from '@/components/ui'
import { DetailModal } from '@/components/Modal'
import { ExecShellModal } from '@/components/ExecModal'
import { showToast } from '@/components/toast'
import { cn } from '@/lib/utils'

function phaseTone(phase: string): 'good' | 'warning' | 'critical' | 'muted' {
  if (phase === 'Running') return 'good'
  if (phase === 'Pending' || phase === 'Unknown') return 'warning'
  if (phase === 'Failed') return 'critical'
  return 'muted'
}

export function Pods() {
  const { ns, readOnly, execEnabled } = useOutletContext<ShellContext>()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [items, setItems] = useState<PodItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(params.get('q') ?? '')
  const [detail, setDetail] = useState<PodItem | null>(null)
  const [shell, setShell] = useState<PodItem | null>(null)

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

  const deletePod = async (p: PodItem) => {
    if (!window.confirm(`Delete pod ${p.namespace}/${p.name}? Its controller will recreate it.`)) return
    try {
      await post('deletePod', { ns: p.namespace, pod: p.name })
      showToast(`Deleted ${p.name}`)
      load()
    } catch (e) {
      showToast((e as Error).message, 'err')
    }
  }

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
                <Th>Namespace</Th><Th>Name</Th><Th>Phase</Th><Th>Ready</Th><Th>Restarts</Th><Th>Node</Th><Th>IP</Th><Th>Age</Th><Th />
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
                  <Td>
                    <div className="flex gap-1">
                      <RowBtn title="Aggregate logs" onClick={() => navigate(`/logs?ns=${encodeURIComponent(p.namespace)}&regex=${encodeURIComponent(p.name)}`)}>
                        <ScrollText className="size-3" />
                      </RowBtn>
                      <RowBtn title="Describe / YAML" onClick={() => setDetail(p)}>
                        <FileText className="size-3" />
                      </RowBtn>
                      {execEnabled && (
                        <RowBtn title="Debug shell (audited)" onClick={() => setShell(p)}>
                          <Terminal className="size-3" />
                        </RowBtn>
                      )}
                      {!readOnly && (
                        <RowBtn title="Delete pod (controller recreates it)" onClick={() => deletePod(p)} danger>
                          <Trash2 className="size-3" />
                        </RowBtn>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <DetailModal target={{ type: 'pod', ns: detail.namespace, name: detail.name }} onClose={() => setDetail(null)} />
      )}
      {shell && (
        <ExecShellModal ns={shell.namespace} pod={shell.name} containers={shell.containers} onClose={() => setShell(null)} />
      )}
    </div>
  )
}

function RowBtn({ children, title, onClick, danger }: {
  children: ReactNode
  title: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'rounded border border-line bg-raised p-1 text-ink-2 hover:text-ink',
        danger && 'hover:border-critical/40 hover:text-critical',
      )}
    >
      {children}
    </button>
  )
}
