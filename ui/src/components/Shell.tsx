/*
 * App shell: left sidebar (grouped nav), top bar (context + namespace),
 * command palette, and the routed outlet. Views receive { ns } via outlet
 * context.
 */
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  HeartPulse, LayoutDashboard, Server, Boxes, Layers, ScrollText, Bell,
  Sparkles, KeyRound, Fingerprint, Command as CommandIcon,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { AppConfig, NamespaceItem } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CommandPalette } from '@/components/CommandPalette'

export interface ShellContext { ns: string }

interface NavItem {
  label: string
  to?: string
  soon?: boolean
  icon: typeof HeartPulse
}

export const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Cluster',
    items: [
      { label: 'Health', to: '/', icon: HeartPulse },
      { label: 'Overview', soon: true, icon: LayoutDashboard },
      { label: 'Node Pools', soon: true, icon: Server },
    ],
  },
  {
    group: 'Workloads',
    items: [
      { label: 'Pods', to: '/pods', icon: Boxes },
      { label: 'Deployments', soon: true, icon: Layers },
    ],
  },
  {
    group: 'Observability',
    items: [
      { label: 'Logs', soon: true, icon: ScrollText },
      { label: 'Events', soon: true, icon: Bell },
      { label: 'AI Investigate', soon: true, icon: Sparkles },
    ],
  },
  {
    group: 'Security',
    items: [
      { label: 'Secrets', soon: true, icon: KeyRound },
      { label: 'Identities', soon: true, icon: Fingerprint },
    ],
  },
]

export function Shell() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [namespaces, setNamespaces] = useState<NamespaceItem[]>([])
  const [ns, setNs] = useState<string>('_all')
  const [paletteOpen, setPaletteOpen] = useState(false)

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

  return (
    <div className="flex h-full">
      {/* sidebar */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2 px-4 py-3.5">
          <HeartPulse className="size-4 text-accent" />
          <span className="text-sm font-bold tracking-tight">K8s Dashboard</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {NAV.map((g) => (
            <div key={g.group} className="mt-3">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">{g.group}</div>
              {g.items.map((item) =>
                item.to ? (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]',
                        isActive ? 'bg-raised font-semibold text-ink' : 'text-ink-2 hover:bg-raised hover:text-ink',
                      )
                    }
                  >
                    <item.icon className="size-3.5" />
                    {item.label}
                  </NavLink>
                ) : (
                  <div key={item.label} className="flex cursor-default items-center gap-2.5 px-2 py-1.5 text-[13px] text-ink-3">
                    <item.icon className="size-3.5" />
                    {item.label}
                    <span className="ml-auto rounded bg-raised px-1 py-px text-[9px] uppercase text-ink-3">soon</span>
                  </div>
                ),
              )}
            </div>
          ))}
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
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
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
          <div className="ml-auto" />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-4">
          <Outlet context={{ ns } satisfies ShellContext} />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
