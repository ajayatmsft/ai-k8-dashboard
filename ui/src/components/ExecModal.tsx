/*
 * Debug shell + "Top processes" — the flagship leak-hunting action. Reads
 * /proc directly inside the container (portable across distros/busybox/
 * distroless-with-shell) and renders processes sorted by resident memory.
 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { post } from '@/lib/api'
import { Modal } from '@/components/Modal'
import { Spinner, Empty, Th, Td } from '@/components/ui'
import { cn } from '@/lib/utils'

// Emit tab-delimited "RSS(kB)\tPID\tNAME\tCMDLINE" per process from /proc.
const PROC_CMD =
  'for d in /proc/[0-9]*; do ' +
  '[ -r "$d/status" ] || continue; ' +
  "rss=$(awk '/^VmRSS:/{print $2}' \"$d/status\" 2>/dev/null); " +
  '[ -n "$rss" ] || continue; ' +
  "name=$(awk '/^Name:/{print $2}' \"$d/status\" 2>/dev/null); " +
  'pid=${d#/proc/}; ' +
  "cmd=$(tr '\\0' ' ' < \"$d/cmdline\" 2>/dev/null); " +
  "printf '%s\\t%s\\t%s\\t%s\\n' \"$rss\" \"$pid\" \"$name\" \"$cmd\"; " +
  'done | sort -rn | head -30'

interface Proc { rssKb: number; pid: string; name: string; cmd: string }

function parseProcs(text: string): Proc[] {
  const rows: Proc[] = []
  for (const line of text.split('\n')) {
    if (!line.includes('\t')) continue
    const [rss, pid, name, ...cmd] = line.split('\t')
    const rssKb = parseInt(rss, 10)
    if (!Number.isFinite(rssKb)) continue
    rows.push({ rssKb, pid, name: name || '', cmd: cmd.join(' ') })
  }
  return rows
}

function fmtKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}Gi`
  if (kb >= 1024) return `${Math.round(kb / 1024)}Mi`
  return `${kb}Ki`
}

export function TopProcessesModal({ ns, pod, container, onClose }: {
  ns: string
  pod: string
  container?: string
  onClose: () => void
}) {
  const [procs, setProcs] = useState<Proc[] | null>(null)
  const [raw, setRaw] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const body: Record<string, string> = { ns, pod, command: PROC_CMD }
      if (container) body.container = container
      const r = await post<{ output: string; error?: string }>('exec', body)
      const text = (r.output || '').trim()
      setRaw(text + (r.error ? '\n[stderr] ' + r.error : '') || '(no output)')
      const parsed = parseProcs(text)
      setProcs(parsed)
      if (!parsed.length && r.error) setError(r.error)
    } catch (e) {
      setError((e as Error).message)
      setProcs([])
    } finally {
      setBusy(false)
    }
  }, [ns, pod, container])

  useEffect(() => { load() }, [load])

  const totalKb = (procs ?? []).reduce((s, p) => s + p.rssKb, 0)

  return (
    <Modal title={`Processes in ${ns}/${pod}${container ? ` [${container}]` : ''}`} onClose={onClose}>
      <div className="p-4">
        <p className="mb-3 text-xs leading-relaxed text-ink-2">
          Live processes inside the container, sorted by resident memory (RSS). A process whose RSS
          keeps climbing across refreshes is your leak — no source code needed.
        </p>
        <div className="mb-3 flex items-center gap-2">
          <button onClick={load} disabled={busy}
            className="flex items-center gap-1.5 rounded border border-line bg-raised px-2.5 py-1.5 text-xs text-ink hover:border-accent disabled:opacity-40">
            <RefreshCw className={cn('size-3', busy && 'animate-spin')} /> Refresh
          </button>
          <button onClick={() => setShowRaw((v) => !v)}
            className="rounded border border-line bg-raised px-2.5 py-1.5 text-xs text-ink-2 hover:text-ink">
            {showRaw ? 'View table' : 'View raw'}
          </button>
          {procs && procs.length > 0 && (
            <span className="ml-auto font-mono text-[11px] text-ink-3">
              {procs.length} process(es) · {fmtKb(totalKb)} total RSS
            </span>
          )}
        </div>

        {procs === null ? (
          <Spinner text="Inspecting running processes…" />
        ) : showRaw ? (
          <pre className="whitespace-pre-wrap break-all rounded border border-line bg-raised/40 p-3 font-mono text-[11px] text-ink-2">{raw}</pre>
        ) : procs.length === 0 ? (
          <Empty>{error || 'Could not read processes — this image may be distroless / have no shell or /proc. Try "View raw".'}</Empty>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line"><Th>Memory (RSS)</Th><Th>PID</Th><Th>Process</Th><Th>Command</Th></tr>
            </thead>
            <tbody>
              {procs.map((p) => (
                <tr key={p.pid} className="border-b border-line/50">
                  <Td mono className="font-semibold text-warning">{fmtKb(p.rssKb)}</Td>
                  <Td mono className="text-ink-3">{p.pid}</Td>
                  <Td mono>{p.name}</Td>
                  <Td mono className="max-w-md truncate text-ink-2" >{p.cmd || p.name}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  )
}

export function ExecShellModal({ ns, pod, containers, onClose }: {
  ns: string
  pod: string
  containers: string[]
  onClose: () => void
}) {
  const [container, setContainer] = useState(containers[0] ?? '')
  const [command, setCommand] = useState('')
  const [output, setOutput] = useState('Output will appear here.')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!command.trim() || busy) return
    setBusy(true)
    setOutput('Running…')
    try {
      const body: Record<string, string> = { ns, pod, command }
      if (container) body.container = container
      const r = await post<{ output: string; error?: string }>('exec', body)
      setOutput((r.output || '') + (r.error ? '\n[stderr] ' + r.error : '') || '(no output)')
    } catch (e) {
      setOutput((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Debug shell — ${ns}/${pod}`} onClose={onClose}>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          {containers.length > 1 && (
            <select value={container} onChange={(e) => setContainer(e.target.value)}
              className="rounded border border-line bg-raised px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent">
              {containers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run() }}
            placeholder='Command run via /bin/sh -c, e.g. "env | sort" or "ls -la /app"'
            className="w-full rounded-md border border-line bg-raised px-3 py-1.5 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
            autoFocus
          />
          <button onClick={run} disabled={busy || !command.trim()}
            className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90 disabled:opacity-40">
            Run
          </button>
        </div>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border border-line bg-raised/40 p-3 font-mono text-[11.5px] leading-[1.45] text-ink-2">
          {output}
        </pre>
        <p className="text-[11px] text-ink-3">Every exec is written to the audit log.</p>
      </div>
    </Modal>
  )
}
