/*
 * Minimal shared primitives — bold dark theme. Status colors always ship with
 * a text label, never color alone.
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
    <div className={cn('card-lift rounded-xl border border-line bg-surface/90', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-2">{title}</div>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

const SEV_STYLE: Record<Severity, string> = {
  critical: 'bg-critical text-white border-critical shadow-[0_0_12px_-2px] shadow-critical/60',
  high: 'bg-serious/20 text-serious border-serious/50',
  medium: 'bg-warning/20 text-warning border-warning/50',
  low: 'bg-raised text-ink-2 border-line',
}

export function SevPill({ sev }: { sev: Severity }) {
  return (
    <span className={cn('inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-bold', SEV_STYLE[sev])}>
      {sev}
    </span>
  )
}

export function StatusPill({ kind, children }: { kind: 'good' | 'warning' | 'critical' | 'muted'; children: ReactNode }) {
  const style = {
    good: 'bg-good/15 text-good border-good/40',
    warning: 'bg-warning/15 text-warning border-warning/40',
    critical: 'bg-critical/20 text-critical border-critical/50',
    muted: 'bg-raised text-ink-2 border-line',
  }[kind]
  return <span className={cn('inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold', style)}>{children}</span>
}

/* Usage meter with a state-colored glow; numeric truth lives in the adjacent
   text (ink tokens), color carries the threshold state. */
export function Meter({ pct, label }: { pct: number | null; label?: string }) {
  const p = pct == null ? 0 : Math.min(100, Math.max(0, pct))
  const state = pct == null
    ? 'bg-raised'
    : p >= 90
      ? 'bg-critical shadow-[0_0_8px] shadow-critical/50'
      : p >= 75
        ? 'bg-warning shadow-[0_0_8px] shadow-warning/40'
        : 'bg-good shadow-[0_0_8px] shadow-good/30'
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full min-w-16 overflow-hidden rounded-full bg-raised">
        <div className={cn('h-full rounded-full transition-[width] duration-500', state)} style={{ width: `${p}%` }} />
      </div>
      {label !== undefined && <span className="shrink-0 font-mono text-[11px] text-ink-2">{label}</span>}
    </div>
  )
}

/* Circular score gauge for the health hero. */
export function ScoreRing({ score, size = 110 }: { score: number; size?: number }) {
  const r = 41
  const c = 2 * Math.PI * r
  const off = c * (1 - score / 100)
  const tone = score >= 90 ? 'var(--color-good)' : score >= 70 ? 'var(--color-warning)' : 'var(--color-critical)'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Health score ${score} of 100`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-raised)" strokeWidth="9" />
      <circle
        cx="50" cy="50" r={r} fill="none"
        stroke={tone} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off}
        transform="rotate(-90 50 50)"
        className="ring-anim"
        style={{ filter: `drop-shadow(0 0 6px color-mix(in srgb, ${tone} 60%, transparent))` }}
      />
      <text x="50" y="48" textAnchor="middle" fill="var(--color-ink)" fontSize="26" fontWeight="800" fontFamily="var(--font-sans)">
        {score}
      </text>
      <text x="50" y="64" textAnchor="middle" fill="var(--color-ink-3)" fontSize="10" fontFamily="var(--font-sans)">
        / 100
      </text>
    </svg>
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
    <div className="rounded-xl border border-critical/40 bg-critical/10 p-4 text-sm">
      <span className="font-bold text-critical">Error: </span>
      <span className="text-ink-2">{error}</span>
      {onRetry && (
        <button onClick={onRetry} className="ml-3 rounded-md border border-line bg-raised px-2 py-0.5 text-xs text-ink hover:border-accent">
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
  return <th className={cn('px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-ink-3', className)}>{children}</th>
}

export function Td({ children, className, mono }: { children?: ReactNode; className?: string; mono?: boolean }) {
  return <td className={cn('px-3 py-1.5 align-middle', mono && 'font-mono text-[12px]', className)}>{children}</td>
}
