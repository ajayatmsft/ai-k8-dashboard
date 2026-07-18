/*
 * Aggregate Logs — the headline feature. Name-regex or label-selector match,
 * snapshot (merged, sorted) or live tail (SSE) across all matching pods.
 * Pod identity is carried by the name prefix; the color is a reading aid
 * assigned in fixed order.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { Camera, Play, Square, Download } from 'lucide-react'
import { api } from '@/lib/api'
import type { AggregateLogsResult } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { ErrorBox } from '@/components/ui'
import { cn } from '@/lib/utils'

interface Line { pod: string; line: string }

const POD_COLORS = [
  'text-sky-400', 'text-emerald-400', 'text-amber-400', 'text-violet-400',
  'text-rose-400', 'text-teal-300', 'text-orange-300', 'text-indigo-300',
]

const MAX_LINES = 5000

export function Logs() {
  const { ns } = useOutletContext<ShellContext>()
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'regex' | 'selector'>('regex')
  const [matcher, setMatcher] = useState(params.get('regex') ?? '')
  const [tail, setTail] = useState('200')
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [meta, setMeta] = useState('')
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const outRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const podColor = useRef(new Map<string, string>())

  const effNs = params.get('ns') ?? ns

  const colorOf = (pod: string) => {
    let c = podColor.current.get(pod)
    if (!c) {
      c = POD_COLORS[podColor.current.size % POD_COLORS.length]
      podColor.current.set(pod, c)
    }
    return c
  }

  const stop = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    setLive(false)
  }, [])

  useEffect(() => () => stop(), [stop])

  // Keep scrolled to bottom unless the user scrolled up.
  useEffect(() => {
    const el = outRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [lines])

  const query = () => ({
    ns: effNs,
    [mode]: matcher.trim(),
    tail,
    search: search.trim() || undefined,
  })

  const snapshot = async () => {
    if (!matcher.trim()) { setError('Enter a name regex or label selector'); return }
    stop()
    setBusy(true)
    setError('')
    podColor.current.clear()
    try {
      const r = await api<AggregateLogsResult>('aggregateLogs', query())
      setLines(r.lines.map((l) => ({ pod: l.pod, line: l.line })))
      setMeta(`${r.podCount ?? r.pods.length} pod(s)${r.capped ? ' (capped)' : ''}${r.truncated ? ' · output truncated' : ''}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const startLive = () => {
    if (!matcher.trim()) { setError('Enter a name regex or label selector'); return }
    stop()
    setError('')
    setLines([])
    podColor.current.clear()
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query())) if (v) qs.set(k, String(v))
    const es = new EventSource(`/api/streamLogs?${qs.toString()}`)
    esRef.current = es
    setLive(true)
    es.addEventListener('meta', (e) => {
      const m = JSON.parse((e as MessageEvent).data)
      setMeta(m.message || `tailing ${m.streaming}/${m.podCount} pod(s)${m.capped ? ' (capped)' : ''}`)
    })
    es.addEventListener('log', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { pod: string; line: string }
      setLines((prev) => {
        const next = prev.length >= MAX_LINES ? prev.slice(-MAX_LINES + 1) : prev.slice()
        next.push({ pod: d.pod, line: d.line })
        return next
      })
    })
    es.addEventListener('eof', () => stop())
    es.onerror = () => { setError('stream disconnected'); stop() }
  }

  const download = () => {
    const blob = new Blob([lines.map((l) => `[${l.pod}] ${l.line}`).join('\n')], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `logs-${matcher.trim() || 'all'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
          className="rounded border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
        >
          <option value="regex">Name regex</option>
          <option value="selector">Label selector</option>
        </select>
        <input
          value={matcher}
          onChange={(e) => setMatcher(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') snapshot() }}
          placeholder={mode === 'regex' ? 'e.g. extension — matches pod names' : 'e.g. app=payment'}
          className="w-72 rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <label className="flex items-center gap-1 text-xs text-ink-3">
          tail
          <input
            value={tail}
            onChange={(e) => setTail(e.target.value.replace(/\D/g, ''))}
            className="w-16 rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
          />
        </label>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search text…"
          className="w-44 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <button onClick={snapshot} disabled={busy || live}
          className="flex items-center gap-1.5 rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-2 hover:text-ink disabled:opacity-40">
          <Camera className="size-3" /> Snapshot
        </button>
        {live ? (
          <button onClick={stop} className="flex items-center gap-1.5 rounded border border-critical/40 bg-critical/15 px-2.5 py-1.5 text-xs font-semibold text-critical">
            <Square className="size-3" /> Stop
          </button>
        ) : (
          <button onClick={startLive} disabled={busy}
            className="flex items-center gap-1.5 rounded border border-good/40 bg-good/15 px-2.5 py-1.5 text-xs font-semibold text-good disabled:opacity-40">
            <Play className="size-3" /> Live tail
          </button>
        )}
        <button onClick={download} disabled={lines.length === 0}
          className="flex items-center gap-1.5 rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-2 hover:text-ink disabled:opacity-40">
          <Download className="size-3" /> Download
        </button>
        <span className="text-xs text-ink-3">
          {live && <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-good align-middle" />}
          {meta}{lines.length ? ` · ${lines.length} lines` : ''}
        </span>
      </div>

      {error && <div className="mb-2"><ErrorBox error={error} /></div>}

      <div
        ref={outRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-[11.5px] leading-[1.45]"
      >
        {lines.length === 0 ? (
          <div className="p-6 text-center font-sans text-ink-3">
            Enter a matcher and take a <b>Snapshot</b> or start a <b>Live tail</b> — logs from every matching pod merge here.
          </div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              <span className={cn('select-none', colorOf(l.pod))}>[{l.pod}] </span>
              <span className="text-ink-2">{l.line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
