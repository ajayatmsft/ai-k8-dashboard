/*
 * Bulk Ops — restart or recreate many workloads by regex/label selector.
 * Dry-run is server-enforced: Execute must present the confirm token from its
 * own preview; any input change invalidates it.
 */
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { ListChecks, Play } from 'lucide-react'
import { post } from '@/lib/api'
import type { BulkOpResult, BulkMatched } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { Card, StatusPill, ErrorBox, Empty, Th, Td } from '@/components/ui'
import { showToast } from '@/components/toast'

type Op = 'restart' | 'deletePods'
const KINDS = ['deployment', 'statefulset', 'daemonset'] as const

export function BulkOps() {
  const { ns, readOnly } = useOutletContext<ShellContext>()
  const [op, setOp] = useState<Op>('restart')
  const [mode, setMode] = useState<'regex' | 'selector'>('regex')
  const [matcher, setMatcher] = useState('')
  const [kinds, setKinds] = useState<string[]>(['deployment'])
  const [matched, setMatched] = useState<BulkMatched[] | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [results, setResults] = useState<Array<{ namespace: string; name: string; kind?: string; ok: boolean; error?: string }> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const invalidate = () => { setToken(null); setMatched(null); setResults(null) }

  const body = (dryRun: boolean) => {
    const b: Record<string, unknown> = { ns, dryRun }
    if (mode === 'selector') b.selector = matcher.trim()
    else b.regex = matcher.trim()
    if (op === 'restart') b.kinds = kinds
    if (!dryRun) b.confirmToken = token
    return b
  }

  const endpoint = op === 'restart' ? 'bulkRestart' : 'bulkDeletePods'

  const preview = async () => {
    if (!matcher.trim()) { setError('Enter a matcher first'); return }
    setBusy(true)
    setError('')
    setResults(null)
    try {
      const r = await post<BulkOpResult>(endpoint, body(true))
      setMatched(r.matched ?? [])
      setToken(r.confirmToken ?? null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const execute = async () => {
    if (!matched || !token) return
    const label = op === 'restart' ? 'Rollout-restart' : 'Delete (recreate) pods for'
    if (!window.confirm(`${label} ${matched.length} resource(s)?`)) return
    setBusy(true)
    setError('')
    try {
      const r = await post<BulkOpResult>(endpoint, body(false))
      const list = r.restarted ?? r.deleted ?? []
      setResults(list)
      const ok = list.filter((x) => x.ok).length
      showToast(`Done: ${ok}/${list.length} succeeded`, ok === list.length ? 'ok' : 'err')
      setToken(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {readOnly && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-xs text-ink-2">
          <span className="font-semibold text-warning">READ-ONLY mode</span> — previews work, execution is disabled.
        </div>
      )}

      <Card title="Bulk operation">
        <div className="flex flex-wrap items-center gap-2">
          <select value={op} onChange={(e) => { setOp(e.target.value as Op); invalidate() }}
            className="rounded border border-line bg-raised px-2 py-1.5 text-xs text-ink outline-none focus:border-accent">
            <option value="restart">Rollout restart (deploy/sts/ds)</option>
            <option value="deletePods">Delete pods (force recreate)</option>
          </select>
          <select value={mode} onChange={(e) => { setMode(e.target.value as 'regex' | 'selector'); invalidate() }}
            className="rounded border border-line bg-raised px-2 py-1.5 text-xs text-ink outline-none focus:border-accent">
            <option value="regex">Name regex</option>
            <option value="selector">Label selector</option>
          </select>
          <input
            value={matcher}
            onChange={(e) => { setMatcher(e.target.value); invalidate() }}
            placeholder={mode === 'regex' ? 'e.g. extension' : 'e.g. app=payment'}
            className="w-64 grow rounded-md border border-line bg-raised px-3 py-1.5 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          />
        </div>
        {op === 'restart' && (
          <div className="mt-2 flex items-center gap-3 text-xs text-ink-2">
            Kinds:
            {KINDS.map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={kinds.includes(k)}
                  onChange={(e) => { setKinds((prev) => e.target.checked ? [...prev, k] : prev.filter((x) => x !== k)); invalidate() }}
                />
                {k}
              </label>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button onClick={preview} disabled={busy}
            className="flex items-center gap-1.5 rounded border border-line bg-raised px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent disabled:opacity-40">
            <ListChecks className="size-3.5" /> Preview (dry-run)
          </button>
          <button onClick={execute} disabled={busy || readOnly || !token || !matched?.length}
            className="flex items-center gap-1.5 rounded border border-critical/40 bg-critical/15 px-3 py-1.5 text-xs font-semibold text-critical disabled:opacity-40">
            <Play className="size-3.5" /> Execute {matched?.length ? `(${matched.length})` : ''}
          </button>
          {!token && matched === null && <span className="text-[11px] text-ink-3">Execution unlocks after a preview.</span>}
        </div>
      </Card>

      {error && <ErrorBox error={error} />}

      {matched !== null && !results && (
        <Card title={`Preview — ${matched.length} resource(s) will be affected`}>
          {matched.length === 0 ? (
            <Empty>No resources matched</Empty>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead><tr className="border-b border-line"><Th>Kind</Th><Th>Namespace</Th><Th>Name</Th></tr></thead>
              <tbody>
                {matched.map((m) => (
                  <tr key={`${m.kind}/${m.namespace}/${m.name}`} className="border-b border-line/50">
                    <Td className="text-ink-2">{m.kind ?? 'pod'}</Td>
                    <Td mono className="text-ink-2">{m.namespace}</Td>
                    <Td mono>{m.name}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {results && (
        <Card title="Results">
          <table className="w-full border-collapse text-[13px]">
            <thead><tr className="border-b border-line"><Th>Result</Th><Th>Namespace</Th><Th>Name</Th><Th>Error</Th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={`${r.namespace}/${r.name}`} className="border-b border-line/50">
                  <Td>{r.ok ? <StatusPill kind="good">ok</StatusPill> : <StatusPill kind="critical">failed</StatusPill>}</Td>
                  <Td mono className="text-ink-2">{r.namespace}</Td>
                  <Td mono>{r.name}</Td>
                  <Td className="text-xs text-critical">{r.error ?? ''}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
