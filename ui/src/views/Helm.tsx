/*
 * Helm releases — works with or without the helm binary (secrets fallback).
 * Detail modal shows status / history / values (best-effort, needs helm).
 */
import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { Modal } from '@/components/Modal'
import { StatusPill, Spinner, ErrorBox, Empty, Th, Td } from '@/components/ui'

interface HelmItem {
  name: string
  namespace: string
  revision: number | string
  status?: string
  chart?: string | null
  appVersion?: string
  updated?: string
}
interface HelmResult { source: 'helm' | 'secrets' | 'none'; items: HelmItem[]; error?: string }
interface HelmDetail {
  name: string
  namespace: string
  helmAvailable?: boolean
  error?: string
  status?: { info?: { status?: string; description?: string; last_deployed?: string } }
  history?: Array<{ revision: number; status: string; chart: string; description?: string; updated?: string }>
  values?: string
}

export function Helm() {
  const { ns } = useOutletContext<ShellContext>()
  const [data, setData] = useState<HelmResult | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<HelmItem | null>(null)

  const load = useCallback(() => {
    setError('')
    api<HelmResult>('helm', { ns }).then(setData).catch((e: Error) => setError(e.message))
  }, [ns])

  useEffect(load, [load])

  if (error) return <ErrorBox error={error} onRetry={load} />
  if (!data) return <Spinner text="Discovering Helm releases…" />

  return (
    <div className="mx-auto max-w-6xl">
      {data.source === 'secrets' && (
        <div className="mb-3 rounded-lg border border-line bg-surface px-4 py-2 text-[11px] text-ink-3">
          Read from helm release Secrets (helm binary not found — install helm for status/history/values detail).
        </div>
      )}
      {data.items.length === 0 ? (
        <Empty>No Helm releases found{data.error ? ` — ${data.error}` : ''}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <Th>Namespace</Th><Th>Release</Th><Th>Revision</Th><Th>Status</Th><Th>Chart</Th><Th>App version</Th><Th>Last deployed</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((h) => (
                <tr key={`${h.namespace}/${h.name}`} className="cursor-pointer border-b border-line/50 hover:bg-raised/40" onClick={() => setOpen(h)}>
                  <Td mono className="text-ink-2">{h.namespace}</Td>
                  <Td mono className="text-accent">{h.name}</Td>
                  <Td mono>{h.revision}</Td>
                  <Td>
                    <StatusPill kind={h.status === 'deployed' ? 'good' : h.status === 'failed' ? 'critical' : 'muted'}>
                      {h.status || 'unknown'}
                    </StatusPill>
                  </Td>
                  <Td mono className="text-ink-2">{h.chart || '—'}</Td>
                  <Td mono className="text-ink-2">{h.appVersion || ''}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{h.updated ? new Date(h.updated).toLocaleString() : ''}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <HelmDetailModal item={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function HelmDetailModal({ item, onClose }: { item: HelmItem; onClose: () => void }) {
  const [detail, setDetail] = useState<HelmDetail | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api<HelmDetail>('helmRelease', { ns: item.namespace, name: item.name })
      .then(setDetail)
      .catch((e: Error) => setErr(e.message))
  }, [item])

  return (
    <Modal title={`helm release ${item.namespace}/${item.name}`} onClose={onClose}>
      <div className="space-y-4 p-4">
        {err && <div className="text-sm text-critical">{err}</div>}
        {!detail && !err && <Spinner />}
        {detail && (
          <>
            {detail.error && !detail.helmAvailable && (
              <p className="text-xs text-ink-3">
                The helm binary is not installed on the dashboard host — detailed status/values unavailable.
              </p>
            )}
            {detail.status?.info && (
              <div className="text-[13px]">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Status</div>
                <p className="text-ink-2">
                  {detail.status.info.status} — {detail.status.info.description}
                </p>
              </div>
            )}
            {detail.history && detail.history.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">History</div>
                <table className="w-full border-collapse text-[12px]">
                  <thead><tr className="border-b border-line"><Th>Rev</Th><Th>Status</Th><Th>Chart</Th><Th>Description</Th></tr></thead>
                  <tbody>
                    {detail.history.slice().reverse().map((h) => (
                      <tr key={h.revision} className="border-b border-line/50">
                        <Td mono>{h.revision}</Td>
                        <Td className="text-ink-2">{h.status}</Td>
                        <Td mono className="text-ink-2">{h.chart}</Td>
                        <Td className="text-ink-3">{h.description}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {detail.values !== undefined && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">User-supplied values</div>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-line bg-raised/40 p-3 font-mono text-[11px] text-ink-2">
                  {detail.values || '(none)'}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
