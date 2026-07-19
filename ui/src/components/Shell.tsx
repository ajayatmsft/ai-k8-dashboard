/*
 * App shell: left sidebar (grouped nav), top bar (context + namespace),
 * command palette, and the routed outlet. Views receive { ns } via outlet
 * context.
 */
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  HeartPulse, LayoutDashboard, Server, Boxes, Layers, ScrollText, Bell,
  Sparkles, KeyRound, Fingerprint, Command as CommandIcon, Settings, Wand2, Package,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { AppConfig, NamespaceItem } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CommandPalette } from '@/components/CommandPalette'
import { SettingsModal } from '@/components/SettingsModal'
import { Toasts } from '@/components/toast'

export interface ShellContext { ns: string; readOnly: boolean; execEnabled: boolean }

interface NavItem {
  label: string
  to?: string
  soon?: boolean
  icon: typeof HeartPulse
}

// Per-section identity hues (navigation identity, not data encoding — status
// colors remain reserved for state).
const GROUP_HUE: Record<string, { icon: string; active: string; bar: string }> = {
  Cluster: { icon: 'text-cyan', active: 'bg-cyan/10', bar: 'bg-cyan' },
  Workloads: { icon: 'text-violet', active: 'bg-violet/10', bar: 'bg-violet' },
  Observability: { icon: 'text-pink', active: 'bg-pink/10', bar: 'bg-pink' },
  Security: { icon: 'text-sky', active: 'bg-sky/10', bar: 'bg-sky' },
}

export const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Cluster',
    items: [
      { label: 'Health', to: '/', icon: HeartPulse },
      { label: 'Overview', to: '/overview', icon: LayoutDashboard },
      { label: 'Node Pools', to: '/nodepools', icon: Server },
      { label: 'Helm', to: '/helm', icon: Package },
    ],
  },
  {
    group: 'Workloads',
    items: [
      { label: 'Pods', to: '/pods', icon: Boxes },
      { label: 'Deployments', to: '/deployments', icon: Layers },
      { label: 'Bulk Ops', to: '/bulk', icon: Wand2 },
    ],
  },
  {
    group: 'Observability',
    items: [
      { label: 'Logs', to: '/logs', icon: ScrollText },
      { label: 'Events', to: '/events', icon: Bell },
      { label: 'AI Investigate', to: '/investigate', icon: Sparkles },
    ],
  },
  {
    group: 'Security',
    items: [
      { label: 'Secrets', to: '/secrets', icon: KeyRound },
      { label: 'Identities', to: '/identities', icon: Fingerprint },
    ],
  },
]

export function Shell() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [namespaces, setNamespaces] = useState<NamespaceItem[]>([])
  const [ns, setNs] = useState<string>('_all')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    api<AppConfig>('config').then(setConfig).catch(() => setConfig(null))
    api<{ namespaces: NamespaceItem[] }>('namespaces')
      .then((r) => setNamespaces(r.namespaces))
      .catch(() => setNamespaces([]))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const location = useLocation()

  return (
    <div className="flex h-full">
      {/* sidebar */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-surface/80 backdrop-blur">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="flex size-6 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-2 shadow-[0_0_14px_-2px] shadow-accent/50">
            <HeartPulse className="size-3.5 text-bg" />
          </span>
          <span className="text-gradient text-sm font-extrabold tracking-tight">K8s Dashboard</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {NAV.map((g) => {
            const hue = GROUP_HUE[g.group]
            return (
              <div key={g.group} className="mt-3">
                <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">{g.group}</div>
                {g.items.map((item) =>
                  item.to ? (
                    <NavLink
                      key={item.label}
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) =>
                        cn(
                          'relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                          isActive
                            ? cn('font-bold text-ink', hue.active)
                            : 'text-ink-2 hover:bg-raised hover:text-ink',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className={cn('absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full', hue.bar)} />}
                          <item.icon className={cn('size-3.5', hue.icon)} />
                          {item.label}
                        </>
                      )}
                    </NavLink>
                  ) : (
                    <div key={item.label} className="flex cursor-default items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-ink-3">
                      <item.icon className="size-3.5 opacity-50" />
                      {item.label}
                      <span className="ml-auto rounded bg-raised px-1 py-px text-[9px] uppercase text-ink-3">soon</span>
                    </div>
                  ),
                )}
              </div>
            )
          })}
        </nav>
        <button
          onClick={() => setPaletteOpen(true)}
          className="m-2 flex items-center gap-2 rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink-3 hover:text-ink"
        >
          <CommandIcon className="size-3" /> Jump to… <kbd className="ml-auto font-mono text-[10px]">Ctrl K</kbd>
        </button>
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-surface/70 px-4 py-2 backdrop-blur">
          <span className="text-xs text-ink-3">Context</span>
          <span className="max-w-64 truncate rounded bg-raised px-2 py-0.5 font-mono text-xs text-ink" title={config?.context}>
            {config ? config.context || '(current)' : '…'}
          </span>
          <span className="ml-2 text-xs text-ink-3">Namespace</span>
          <select
            value={ns}
            onChange={(e) => setNs(e.target.value)}
            className="rounded border border-line bg-raised px-2 py-1 text-xs text-ink outline-none focus:border-accent"
          >
            <option value="_all">All namespaces</option>
            {namespaces.map((n) => (
              <option key={n.name} value={n.name}>{n.name}</option>
            ))}
          </select>
          {config?.readOnly && (
            <span className="rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning">
              READ-ONLY
            </span>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            title="Cluster connection (kubeconfig / context)"
            className="ml-auto rounded p-1.5 text-ink-3 hover:bg-raised hover:text-ink"
          >
            <Settings className="size-4" />
          </button>
        </header>
        <main key={location.pathname} className="view-enter min-h-0 flex-1 overflow-y-auto p-4">
          <Outlet context={{ ns, readOnly: config?.readOnly ?? false, execEnabled: config?.execEnabled ?? false } satisfies ShellContext} />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {settingsOpen && config && <SettingsModal config={config} onClose={() => setSettingsOpen(false)} />}
      <Toasts />
    </div>
  )
}
