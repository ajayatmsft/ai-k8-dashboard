/*
 * Secrets — keys-only list; opening one shows decoded values (masked, per-key
 * reveal, audited server-side). In READ_ONLY mode the backend redacts values
 * and blocks YAML.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { api } from '@/lib/api'
import type { SecretItem, SecretDetail } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { Spinner, ErrorBox, Empty, Th, Td } from '@/components/ui'
import { DetailModal } from '@/components/Modal'

export function Secrets() {
  const { ns } = useOutletContext<ShellContext>()
  const [items, setItems] = useState<SecretItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<SecretItem | null>(null)

  const load = useCallback(() => {
    setError('')
    api<{ items: SecretItem[] }>('secrets', { ns })
      .then((r) => { setItems(r.items); setLoading(false) })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [ns])

  useEffect(() => { setLoading(true); load() }, [load])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter((s) =>
      s.name.toLowerCase().includes(q) || s.namespace.toLowerCase().includes(q) ||
      s.keys.some((k) => k.toLowerCase().includes(q)),
    )
  }, [items, filter])

  if (loading && items.length === 0 && !error) return <Spinner text="Loading secrets…" />
  if (error) return <ErrorBox error={error} onRetry={load} />

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or key…"
          className="w-80 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <span className="text-xs text-ink-3">{filtered.length} / {items.length} secrets · access is audited</span>
      </div>

      {filtered.length === 0 ? (
        <Empty>No secrets match</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line"><Th>Namespace</Th><Th>Name</Th><Th>Type</Th><Th>Keys</Th><Th>Age</Th></tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={`${s.namespace}/${s.name}`} className="cursor-pointer border-b border-line/50 hover:bg-raised/40" onClick={() => setOpen(s)}>
                  <Td mono className="text-ink-2">{s.namespace}</Td>
                  <Td mono className="max-w-64 truncate text-accent">{s.name}</Td>
                  <Td mono className="text-[11px] text-ink-3">{s.type}</Td>
                  <Td>
                    <div className="flex max-w-md flex-wrap gap-1">
                      {s.keys.slice(0, 6).map((k) => <span key={k} className="rounded bg-raised px-1.5 py-px font-mono text-[10px] text-ink-2">{k}</span>)}
                      {s.keys.length > 6 && <span className="text-[10px] text-ink-3">+{s.keys.length - 6}</span>}
                    </div>
                  </Td>
                  <Td className="text-ink-2">{s.age}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <DetailModal
          target={{ type: 'secret', ns: open.namespace, name: open.name }}
          onClose={() => setOpen(null)}
          extraTabs={{ Decoded: <DecodedSecret ns={open.namespace} name={open.name} /> }}
        />
      )}
    </div>
  )
}

function DecodedSecret({ ns, name }: { ns: string; name: string }) {
  const [detail, setDetail] = useState<SecretDetail | null>(null)
  const [error, setError] = useState('')
  const [shown, setShown] = useState<Record<string, boolean>>({})

  useEffect(() => {
    api<SecretDetail>('secret', { ns, name }).then(setDetail).catch((e: Error) => setError(e.message))
  }, [ns, name])

  if (error) return <div className="p-4 text-sm text-critical">{error}</div>
  if (!detail) return <Spinner />

  return (
    <div className="space-y-2 p-1">
      <div className="text-[11px] text-ink-3">
        {detail.redacted ? 'Values are redacted in READ-ONLY mode.' : 'This access was written to the audit log.'}
      </div>
      {Object.entries(detail.data).map(([k, v]) => (
        <div key={k} className="rounded border border-line bg-raised/40 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold text-ink">{k}</span>
            {!detail.redacted && (
              <button
                onClick={() => setShown((s) => ({ ...s, [k]: !s[k] }))}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-ink-3 hover:text-ink"
              >
                {shown[k] ? <><EyeOff className="size-3" /> hide</> : <><Eye className="size-3" /> reveal</>}
              </button>
            )}
          </div>
          <pre className="whitespace-pre-wrap break-all font-mono text-[11.5px] text-ink-2">
            {detail.redacted ? v : shown[k] ? v : '••••••••'}
          </pre>
        </div>
      ))}
    </div>
  )
}
