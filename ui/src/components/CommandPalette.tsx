/*
 * Ctrl+K command palette — navigation plus quick pod search. Hand-rolled
 * (no cmdk dependency): input, filtered list, arrow-key selection.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft } from 'lucide-react'
import { api } from '@/lib/api'
import type { PodItem } from '@/lib/api'
import { cn } from '@/lib/utils'
import { NAV } from '@/components/Shell'

interface Entry {
  kind: 'nav' | 'pod'
  label: string
  hint?: string
  to: string
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [pods, setPods] = useState<PodItem[]>([])
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSel(0)
    inputRef.current?.focus()
    api<{ items: PodItem[] }>('pods', { ns: '_all' })
      .then((r) => setPods(r.items))
      .catch(() => setPods([]))
  }, [open])

  const entries = useMemo<Entry[]>(() => {
    const nav: Entry[] = NAV.flatMap((g) =>
      g.items.filter((i) => i.to).map((i) => ({ kind: 'nav' as const, label: i.label, hint: g.group, to: i.to! })),
    )
    const podEntries: Entry[] = pods.map((p) => ({
      kind: 'pod' as const,
      label: p.name,
      hint: `${p.namespace} · ${p.phase}`,
      to: `/pods?q=${encodeURIComponent(p.name)}`,
    }))
    const q = query.trim().toLowerCase()
    const all = [...nav, ...podEntries]
    const filtered = q ? all.filter((e) => e.label.toLowerCase().includes(q) || (e.hint || '').toLowerCase().includes(q)) : nav
    return filtered.slice(0, 12)
  }, [query, pods])

  useEffect(() => setSel(0), [entries.length])

  if (!open) return null

  const go = (e: Entry) => {
    onClose()
    navigate(e.to)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 pt-[18vh]" onMouseDown={onClose}>
      <div
        className="mx-auto w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, entries.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              else if (e.key === 'Enter' && entries[sel]) go(entries[sel])
            }}
            placeholder="Jump to a view or search pods…"
            className="w-full bg-transparent py-3 text-sm text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto p-1.5">
          {entries.length === 0 && <li className="p-4 text-center text-xs text-ink-3">No matches</li>}
          {entries.map((e, i) => (
            <li key={`${e.kind}:${e.to}:${e.label}`}>
              <button
                onMouseEnter={() => setSel(i)}
                onClick={() => go(e)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px]',
                  i === sel ? 'bg-raised text-ink' : 'text-ink-2',
                )}
              >
                <span className={cn('rounded px-1 py-px text-[9px] font-semibold uppercase', e.kind === 'nav' ? 'bg-accent/15 text-accent' : 'bg-raised text-ink-3')}>
                  {e.kind}
                </span>
                <span className="truncate font-mono">{e.label}</span>
                {e.hint && <span className="ml-auto shrink-0 text-[11px] text-ink-3">{e.hint}</span>}
                {i === sel && <CornerDownLeft className="size-3 shrink-0 text-ink-3" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
