/*
 * AI Investigate — ask in plain English, watch the agent work (SSE steps),
 * get a structured root-cause analysis. Falls back to the heuristic engine
 * when no AI provider is configured. History is loaded from the backend.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Sparkles, Square, History } from 'lucide-react'
import { api } from '@/lib/api'
import type { AiStatus, AgentStep, InvestigateReport, InvestigationRow } from '@/lib/api'
import type { ShellContext } from '@/components/Shell'
import { Card, SevPill, StatusPill, Spinner, ErrorBox, Empty } from '@/components/ui'
import { cn } from '@/lib/utils'

const EXAMPLES = [
  'Do we have a memory leak?',
  'Why is payment-service failing?',
  'Find pods restarting frequently',
]

export function Investigate() {
  const { ns } = useOutletContext<ShellContext>()
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [question, setQuestion] = useState('')
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [report, setReport] = useState<InvestigateReport | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<InvestigationRow[]>([])
  const esRef = useRef<EventSource | null>(null)

  const loadHistory = useCallback(() => {
    api<{ items: InvestigationRow[] }>('investigations')
      .then((r) => setHistory(r.items))
      .catch(() => setHistory([]))
  }, [])

  useEffect(() => {
    api<AiStatus>('aiStatus').then(setStatus).catch(() => setStatus(null))
    loadHistory()
    return () => { esRef.current?.close() }
  }, [loadHistory])

  const stop = () => {
    esRef.current?.close()
    esRef.current = null
    setRunning(false)
  }

  const ask = (q: string) => {
    const text = q.trim()
    if (!text || running) return
    stop()
    setQuestion(text)
    setSteps([])
    setReport(null)
    setError('')
    setRunning(true)
    const qs = new URLSearchParams({ question: text })
    if (ns && ns !== '_all') qs.set('ns', ns)
    const es = new EventSource(`/api/investigate?${qs.toString()}`)
    esRef.current = es
    es.addEventListener('step', (e) => {
      const step = JSON.parse((e as MessageEvent).data) as AgentStep
      setSteps((prev) => [...prev, step])
    })
    es.addEventListener('report', (e) => {
      setReport(JSON.parse((e as MessageEvent).data) as InvestigateReport)
    })
    es.addEventListener('error', (e) => {
      const d = (e as MessageEvent).data
      if (d) setError((JSON.parse(d) as { error: string }).error)
    })
    es.addEventListener('eof', () => { stop(); loadHistory() })
    es.onerror = () => { if (esRef.current) { setError('stream disconnected'); stop() } }
  }

  const openHistory = async (id: string) => {
    stop()
    setError('')
    setSteps([])
    try {
      const row = await api<InvestigationRow>('investigation', { id })
      setQuestion(row.question)
      setReport({
        summary: row.summary, root_cause: row.root_cause, confidence: row.confidence ?? undefined,
        evidence: row.evidence, suggested_fix: row.suggested_fix, provider: row.provider,
        namespace: row.namespace, target: row.target, created_at: row.created_at,
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {/* ask box */}
        <Card>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-accent" />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ask(question) }}
              placeholder='Ask anything — "Investigate payment-service", "Do we have a memory leak?"'
              className="w-full bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-3"
            />
            {running ? (
              <button onClick={stop} className="flex shrink-0 items-center gap-1.5 rounded border border-critical/40 bg-critical/15 px-3 py-1.5 text-xs font-semibold text-critical">
                <Square className="size-3" /> Stop
              </button>
            ) : (
              <button onClick={() => ask(question)} className="btn-primary shrink-0 rounded-lg px-3.5 py-1.5 text-xs">
                Investigate
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => ask(ex)} disabled={running}
                className="rounded-full border border-line bg-raised px-2.5 py-0.5 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40">
                {ex}
              </button>
            ))}
            {status && (
              <span className="ml-auto text-[11px] text-ink-3">
                {status.aiConfigured
                  ? <>engine: <span className="text-ink-2">{status.aiProvider} · {status.aiModel}</span></>
                  : <>engine: <span className="text-ink-2">built-in heuristics</span> (set OPENAI_API_KEY for the full agent)</>}
              </span>
            )}
          </div>
        </Card>

        {/* live progress */}
        {(running || steps.length > 0) && (
          <Card title="Investigation progress">
            <ol className="space-y-1.5">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span className={cn(
                    'mt-0.5 shrink-0 rounded px-1.5 py-px font-mono text-[10px] uppercase',
                    s.phase === 'tool' ? 'bg-accent/15 text-accent' : 'bg-raised text-ink-3',
                  )}>
                    {s.tool || s.phase}
                  </span>
                  <span className="text-ink-2">{s.message}</span>
                </li>
              ))}
              {running && <li><Spinner text="Working…" /></li>}
            </ol>
          </Card>
        )}

        {error && <ErrorBox error={error} />}

        {/* report */}
        {report && (
          <Card
            title="Root-cause analysis"
            actions={
              <span className="flex items-center gap-2 text-[11px] text-ink-3">
                {report.provider && <span className="rounded bg-raised px-1.5 py-px font-mono">{report.provider}</span>}
                {report.confidence != null && (
                  <StatusPill kind={report.confidence >= 70 ? 'good' : report.confidence >= 40 ? 'warning' : 'muted'}>
                    confidence {report.confidence}%
                  </StatusPill>
                )}
              </span>
            }
          >
            <div className="space-y-3 text-[13px] leading-relaxed">
              {report.summary && <p className="text-ink">{report.summary}</p>}
              {report.root_cause && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Root cause</div>
                  <p className="text-ink-2">{report.root_cause}</p>
                </div>
              )}
              {report.evidence && report.evidence.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Evidence</div>
                  <ul className="list-inside list-disc space-y-0.5 text-ink-2">
                    {report.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
                  </ul>
                </div>
              )}
              {report.suggested_fix && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-accent">Suggested fix</div>
                  <p className="text-ink-2">{report.suggested_fix}</p>
                </div>
              )}
              {report.signals && report.signals.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
                  {report.signals.map((s, i) => (
                    <span key={i} className="flex items-center gap-1"><SevPill sev={s.severity} /><span className="text-[11px] text-ink-3">{s.title}</span></span>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* history */}
      <Card title={<span className="flex items-center gap-1.5"><History className="size-3.5" /> History</span>}>
        {history.length === 0 ? (
          <Empty>No investigations yet</Empty>
        ) : (
          <ul className="space-y-1">
            {history.map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => openHistory(h.id)}
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-raised"
                >
                  <div className="truncate text-[13px] text-ink">{h.question}</div>
                  <div className="flex items-center gap-2 text-[10px] text-ink-3">
                    {h.provider && <span className="font-mono">{h.provider}</span>}
                    {h.confidence != null && <span>{h.confidence}%</span>}
                    {h.created_at && <span>{new Date(h.created_at).toLocaleString()}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
