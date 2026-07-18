/*
 * Kubeconfig / context switcher. Non-destructive: the backend stores the
 * selection and passes --kubeconfig/--context per kubectl call. On success we
 * reload so every view refetches against the new cluster.
 */
import { useState } from 'react'
import { api, post } from '@/lib/api'
import type { AppConfig, SetConfigResult } from '@/lib/api'
import { Modal } from '@/components/Modal'
import { showToast } from '@/components/toast'

export function SettingsModal({ config, onClose }: { config: AppConfig; onClose: () => void }) {
  const [kubeconfig, setKubeconfig] = useState(config.kubeconfig)
  const [context, setContext] = useState(config.context)
  const [contexts, setContexts] = useState(config.contexts)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const changeKubeconfig = async (kc: string) => {
    setKubeconfig(kc)
    setContext('')
    setBusy(true)
    setError('')
    try {
      // Apply the kubeconfig so the backend can list its contexts.
      const r = await post<SetConfigResult>('setConfig', { kubeconfig: kc })
      if (r.error) setError(r.error)
      const fresh = await api<AppConfig>('config')
      setContexts(fresh.contexts)
      setContext(fresh.context)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await post<SetConfigResult>('setConfig', { kubeconfig, context })
      if (!r.ok) { setError(r.error || 'could not connect with this selection'); return }
      showToast(`Connected: ${r.context}`)
      location.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Cluster connection" onClose={onClose}>
      <div className="space-y-4 p-4 text-[13px]">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Kubeconfig</div>
          <select
            value={config.kubeconfigs.includes(kubeconfig) || kubeconfig === '' ? kubeconfig : '__custom'}
            onChange={(e) => { if (e.target.value !== '__custom') changeKubeconfig(e.target.value) }}
            className="w-full rounded border border-line bg-raised px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
          >
            <option value="">(default) {config.defaultKubeconfig}</option>
            {config.kubeconfigs.map((k) => <option key={k} value={k}>{k}</option>)}
            <option value="__custom">Custom path…</option>
          </select>
          <input
            value={kubeconfig}
            onChange={(e) => setKubeconfig(e.target.value)}
            onBlur={(e) => { if (e.target.value !== config.kubeconfig) changeKubeconfig(e.target.value) }}
            placeholder="…or type a full path to a kubeconfig file"
            className="mt-1.5 w-full rounded border border-line bg-raised px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          />
        </div>

        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Context</div>
          <select
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="w-full rounded border border-line bg-raised px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
          >
            <option value="">(current default)</option>
            {contexts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {error && <div className="rounded border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{error}</div>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded border border-line bg-raised px-3 py-1.5 text-xs text-ink-2 hover:text-ink">Cancel</button>
          <button
            onClick={apply}
            disabled={busy}
            className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Checking…' : 'Apply & reconnect'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
