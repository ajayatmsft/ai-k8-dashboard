/*
 * Modal + DetailModal (lazy Describe / YAML tabs for any resource).
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { api } from '@/lib/api'
import { Spinner } from '@/components/ui'
import { cn } from '@/lib/utils'

export function Modal({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 p-6 pt-[8vh]" onMouseDown={onClose}>
      <div
        className="modal-pop flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="truncate font-mono text-[13px] text-ink">{title}</div>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-raised hover:text-ink"><X className="size-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  )
}

interface Target { type: string; ns: string; name: string }

export function DetailModal({ target, onClose, extraTabs }: {
  target: Target
  onClose: () => void
  extraTabs?: Record<string, ReactNode>
}) {
  const builtins = ['Describe', 'YAML']
  const tabs = [...(extraTabs ? Object.keys(extraTabs) : []), ...builtins]
  const [tab, setTab] = useState(tabs[0])
  const [cache, setCache] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    if (!builtins.includes(tab) || cache[tab]) return
    setError('')
    const ep = tab === 'Describe' ? 'describe' : 'manifest'
    api<{ text: string }>(ep, { type: target.type, ns: target.ns, name: target.name })
      .then((r) => setCache((c) => ({ ...c, [tab]: r.text })))
      .catch((e: Error) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, target])

  return (
    <Modal title={`${target.type} ${target.ns}/${target.name}`} onClose={onClose}>
      <div className="flex gap-1 border-b border-line px-3 pt-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-t-md px-3 py-1.5 text-xs',
              t === tab ? 'bg-raised font-semibold text-ink' : 'text-ink-3 hover:text-ink',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="p-3">
        {extraTabs && extraTabs[tab] !== undefined ? (
          extraTabs[tab]
        ) : error ? (
          <div className="p-4 text-sm text-critical">{error}</div>
        ) : cache[tab] ? (
          <pre className="whitespace-pre-wrap break-all font-mono text-[11.5px] leading-[1.45] text-ink-2">{cache[tab]}</pre>
        ) : (
          <Spinner />
        )}
      </div>
    </Modal>
  )
}
