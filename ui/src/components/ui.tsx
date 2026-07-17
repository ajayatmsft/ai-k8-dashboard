/*
 * Minimal shared primitives (shadcn-style, hand-rolled — no runtime deps).
 * Status colors always ship with a text label, never color alone.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Severity } from '@/lib/api'

export function Card({ title, children, className, actions }: {
  title?: ReactNode
  children: ReactNode
  className?: string
  actions?: ReactNode
}) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">{title}</div>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

const SEV_STYLE: Record<Severity, string> = {
  critical: 'bg-critical/15 text-critical border-critical/40',
  high: 'bg-serious/15 text-serious border-serious/40',
  medium: 'bg-warning/15 text-warning border-warning/40',
  low: 'bg-raised text-ink-2 border-line',
}

export function SevPill({ sev }: { sev: Severity }) {
  return (
    <span className={cn('inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold', SEV_STYLE[sev])}>
      {sev}
    </span>
  )
}

export function StatusPill({ kind, children }: { kind: 'good' | 'warning' | 'critical' | 'muted'; children: ReactNode }) {
  const style = {
    good: 'bg-good/15 text-good border-good/40',
    warning: 'bg-warning/15 text-warning border-warning/40',
    critical: 'bg-critical/15 text-critical border-critical/40',
    muted: 'bg-raised text-ink-2 border-line',
  }[kind]
  return <span className={cn('inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium', style)}>{children}</span>
}

/* Thin usage meter: track in line color, fill colored by threshold state.
   The numeric truth lives in the adjacent text (ink tokens), not the color. */
export function Meter({ pct, label }: { pct: number | null; label?: string }) {
  const p = pct == null ? 0 : Math.min(100, Math.max(0, pct))
  const state = pct == null ? 'bg-raised' : p >= 90 ? 'bg-critical' : p >= 75 ? 'bg-warning' : 'bg-good'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-raised">
        <div className={cn('h-full rounded-full transition-all', state)} style={{ width: `${p}%` }} />
      </div>
      {label !== undefined && <span className="shrink-0 font-mono text-[11px] text-ink-2">{label}</span>}
    </div>
  )
}

export function Spinner({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-ink-3">
      <span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
      {text}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-critical/40 bg-critical/10 p-4 text-sm">
      <span className="font-semibold text-critical">Error: </span>
      <span className="text-ink-2">{error}</span>
      {onRetry && (
        <button onClick={onRetry} className="ml-3 rounded border border-line bg-raised px-2 py-0.5 text-xs text-ink hover:border-accent">
          Retry
        </button>
      )}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center text-ink-3">{children}</div>
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn('px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-3', className)}>{children}</th>
}

export function Td({ children, className, mono }: { children?: ReactNode; className?: string; mono?: boolean }) {
  return <td className={cn('px-3 py-1.5 align-middle', mono && 'font-mono text-[12px]', className)}>{children}</td>
}
