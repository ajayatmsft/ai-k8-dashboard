/*
 * Identities — cloud identities attached to pods: Azure Workload Identity,
 * legacy AAD Pod Identity, AWS IRSA, GCP Workload Identity.
 */
import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { Card, StatusPill, Spinner, ErrorBox, Empty, Th, Td } from '@/components/ui'

interface IdentityInfo {
  azureClientId?: string
  azureTenantId?: string
  awsRoleArn?: string
  gcpServiceAccount?: string
}
interface IdentitiesResult {
  workloadIdentity: Array<{ namespace: string; pod: string; serviceAccount: string; usesWorkloadIdentity: boolean; identity: IdentityInfo | null }>
  azureIdentities: Array<{ namespace: string; name: string; clientId?: string; resourceId?: string; type?: string }>
  podIdentityBindings: Array<{ namespace: string; pod: string; binding: string }>
  serviceAccountsWithIdentity: Array<{ namespace: string; name: string; identity: IdentityInfo }>
}

function identityText(id: IdentityInfo | null | undefined): string {
  if (!id) return ''
  return [
    id.azureClientId && `azure client-id ${id.azureClientId}`,
    id.awsRoleArn && `aws ${id.awsRoleArn}`,
    id.gcpServiceAccount && `gcp ${id.gcpServiceAccount}`,
  ].filter(Boolean).join(' · ')
}

export function Identities() {
  const { ns } = useOutletContext<ShellContext>()
  const [data, setData] = useState<IdentitiesResult | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setError('')
    api<IdentitiesResult>('identities', { ns }).then(setData).catch((e: Error) => setError(e.message))
  }, [ns])

  useEffect(load, [load])

  if (error) return <ErrorBox error={error} onRetry={load} />
  if (!data) return <Spinner text="Scanning pod identities…" />

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Card title={`Pods using workload identity (${data.workloadIdentity.length})`}>
        {data.workloadIdentity.length === 0 ? (
          <Empty>No pods opt into workload identity in this scope</Empty>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead><tr className="border-b border-line"><Th>Pod</Th><Th>Service account</Th><Th>Opt-in label</Th><Th>Identity</Th></tr></thead>
            <tbody>
              {data.workloadIdentity.map((w) => (
                <tr key={`${w.namespace}/${w.pod}`} className="border-b border-line/50 hover:bg-raised/40">
                  <Td mono className="max-w-64 truncate">
                    <div className="truncate">{w.pod}</div>
                    <div className="text-[10px] text-ink-3">{w.namespace}</div>
                  </Td>
                  <Td mono className="text-ink-2">{w.serviceAccount}</Td>
                  <Td>{w.usesWorkloadIdentity ? <StatusPill kind="good">use=true</StatusPill> : <StatusPill kind="muted">via SA</StatusPill>}</Td>
                  <Td mono className="max-w-72 truncate text-[11px] text-ink-2">{identityText(w.identity) || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Service accounts with cloud identity (${data.serviceAccountsWithIdentity.length})`}>
        {data.serviceAccountsWithIdentity.length === 0 ? (
          <Empty>No annotated service accounts</Empty>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead><tr className="border-b border-line"><Th>Service account</Th><Th>Identity annotations</Th></tr></thead>
            <tbody>
              {data.serviceAccountsWithIdentity.map((s) => (
                <tr key={`${s.namespace}/${s.name}`} className="border-b border-line/50 hover:bg-raised/40">
                  <Td mono>
                    <div>{s.name}</div>
                    <div className="text-[10px] text-ink-3">{s.namespace}</div>
                  </Td>
                  <Td mono className="text-[11px] text-ink-2">{identityText(s.identity)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {(data.azureIdentities.length > 0 || data.podIdentityBindings.length > 0) && (
        <Card title="Legacy AAD Pod Identity">
          {data.azureIdentities.map((a) => (
            <div key={`${a.namespace}/${a.name}`} className="border-b border-line/50 py-1.5 font-mono text-[12px]">
              <span className="text-ink">{a.namespace}/{a.name}</span>
              <span className="ml-2 text-ink-3">{a.type} · {a.clientId}</span>
            </div>
          ))}
          {data.podIdentityBindings.map((b) => (
            <div key={`${b.namespace}/${b.pod}`} className="border-b border-line/50 py-1.5 font-mono text-[12px]">
              <span className="text-ink">{b.namespace}/{b.pod}</span>
              <span className="ml-2 text-ink-3">aadpodidbinding={b.binding}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
