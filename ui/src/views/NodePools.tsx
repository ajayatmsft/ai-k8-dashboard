/*
 * Node Pools — pools with SKUs/zones, per-node detail (expandable
 * nodeSelector labels + taints), and which workloads pin themselves to nodes.
 */
import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '@/lib/api'
import type { NodePoolsResult } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { Card, StatusPill, Spinner, ErrorBox, Empty, Th, Td } from '@/components/ui'

export function NodePools() {
  const { ns } = useOutletContext<ShellContext>()
  const [data, setData] = useState<NodePoolsResult | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setError('')
    api<NodePoolsResult>('nodePools', { ns }).then(setData).catch((e: Error) => setError(e.message))
  }, [ns])

  useEffect(load, [load])

  if (error) return <ErrorBox error={error} onRetry={load} />
  if (!data) return <Spinner text="Loading node pools…" />

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Card title={`Pools (${data.pools.length})`}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <Th>Pool</Th><Th>Mode</Th><Th>Nodes</Th><Th>SKUs</Th><Th>Zones</Th><Th>OS</Th><Th>Total CPU</Th><Th>Total memory</Th>
            </tr>
          </thead>
          <tbody>
            {data.pools.map((p) => (
              <tr key={p.name} className="border-b border-line/50 hover:bg-raised/40">
                <Td mono>{p.name}</Td>
                <Td>{p.mode ? <StatusPill kind="muted">{p.mode}</StatusPill> : null}</Td>
                <Td>
                  <StatusPill kind={p.ready === p.count ? 'good' : 'warning'}>{p.ready}/{p.count} ready</StatusPill>
                </Td>
                <Td mono className="text-ink-2">{p.skus.join(', ')}</Td>
                <Td mono className="text-ink-2">{p.zones.join(', ') || '—'}</Td>
                <Td className="text-ink-2">{p.os.join(', ')}</Td>
                <Td mono>{p.totalCpu}</Td>
                <Td mono>{p.totalMemory}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title={`Nodes (${data.nodes.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <Th>Node</Th><Th>Pool</Th><Th>SKU</Th><Th>Zone</Th><Th>Ready</Th><Th>Pods</Th><Th>Taints</Th><Th>Age</Th>
              </tr>
            </thead>
            <tbody>
              {data.nodes.map((n) => (
                <NodeRow key={n.name} n={n} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Node selectors in use (${data.scheduling.length})`}>
        {data.scheduling.length === 0 ? (
          <Empty>No workloads pin themselves to nodes in this scope</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  <Th>Workload</Th><Th>Kind</Th><Th>nodeSelector</Th><Th>Affinity</Th><Th>Tolerations</Th>
                </tr>
              </thead>
              <tbody>
                {data.scheduling.map((s) => (
                  <tr key={`${s.kind}/${s.namespace}/${s.name}`} className="border-b border-line/50 hover:bg-raised/40">
                    <Td mono className="max-w-56 truncate">
                      <div className="truncate">{s.name}</div>
                      <div className="text-[10px] text-ink-3">{s.namespace}</div>
                    </Td>
                    <Td className="text-ink-2">{s.kind}</Td>
                    <Td mono className="max-w-64 text-[11px] text-ink-2">
                      {Object.entries(s.nodeSelector).map(([k, v]) => <div key={k} className="truncate">{k}={v}</div>)}
                    </Td>
                    <Td mono className="max-w-64 text-[11px] text-ink-2">{s.affinity.map((a, i) => <div key={i} className="truncate">{a}</div>)}</Td>
                    <Td mono className="max-w-52 text-[11px] text-ink-3">{s.tolerations.map((t, i) => <div key={i} className="truncate">{t}</div>)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function NodeRow({ n }: { n: NodePoolsResult['nodes'][number] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className="cursor-pointer border-b border-line/50 hover:bg-raised/40" onClick={() => setOpen((v) => !v)}>
        <Td mono className="max-w-60 truncate">{n.name}</Td>
        <Td mono className="text-ink-2">{n.pool}</Td>
        <Td mono className="text-ink-2">{n.sku}</Td>
        <Td mono className="text-ink-2">{n.zone || '—'}</Td>
        <Td>{n.ready ? <StatusPill kind="good">Ready</StatusPill> : <StatusPill kind="critical">NotReady</StatusPill>}</Td>
        <Td mono>{n.pods}{n.maxPods ? ` / ${n.maxPods}` : ''}</Td>
        <Td className="text-[11px] text-ink-3">{n.taints.length ? `${n.taints.length} taint(s)` : '—'}</Td>
        <Td className="text-ink-2">{n.age}</Td>
      </tr>
      {open && (
        <tr className="border-b border-line/50 bg-raised/30">
          <td colSpan={8} className="px-4 py-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">nodeSelector labels</div>
            <div className="grid grid-cols-1 gap-x-6 font-mono text-[11px] text-ink-2 md:grid-cols-2">
              {Object.entries(n.labels).map(([k, v]) => <div key={k} className="truncate">{k}: <span className="text-ink">{v}</span></div>)}
            </div>
            {n.taints.length > 0 && (
              <>
                <div className="mt-2 mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Taints</div>
                {n.taints.map((t) => <div key={t} className="font-mono text-[11px] text-warning">{t}</div>)}
              </>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
