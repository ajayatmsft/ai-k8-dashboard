/*
 * Typed client for the backend /api contract (see API.md at the repo root).
 * Same-origin by default; the Vite dev server proxies /api to :7575.
 */

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type Query = Record<string, string | number | boolean | undefined>

export async function api<T>(name: string, query: Query = {}): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const res = await fetch(`/api/${name}${qs.size ? '?' + qs.toString() : ''}`)
  const data = await res.json().catch(() => ({ error: 'bad response' }))
  if (!res.ok || data.error) throw new ApiError(data.error || `HTTP ${res.status}`, res.status)
  return data as T
}

export async function post<T>(name: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({ error: 'bad response' }))
  if (!res.ok || data.error) throw new ApiError(data.error || `HTTP ${res.status}`, res.status)
  return data as T
}

// --- response types (mirrors API.md) ---------------------------------------

export interface AppConfig {
  kubeconfig: string
  defaultKubeconfig: string
  kubeconfigs: string[]
  context: string
  contexts: string[]
  readOnly: boolean
  execEnabled: boolean
}

export interface NamespaceItem { name: string; status?: string; age?: string }

export interface PodItem {
  namespace: string
  name: string
  phase: string
  ready: string
  restarts: number
  node?: string
  podIP?: string
  age: string
  containers: string[]
}

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface NodeConsumer {
  namespace: string
  pod: string
  container: string
  memBytes: number
  memText: string
  memPctOfNode: number | null
}

export interface HealthIssue {
  severity: Severity
  code: string
  title: string
  detail: string
  fix: string
  namespace?: string
  pod?: string
  container?: string
  node?: string
  previousLogs?: boolean
  consumers?: NodeConsumer[]
}

export interface HealthNode {
  name: string
  ready: boolean
  version?: string
  pool: string | null
  sku: string | null
  pressure: string[]
  cpuPct: number | null
  memPct: number | null
  cpuText: string | null
  memText: string | null
  topConsumers: NodeConsumer[]
  workloadMemText: string
}

export interface TopContainer {
  namespace: string | null
  pod: string
  container: string
  cpuMilli: number
  memBytes: number
  memText: string
  cpuText: string
  memLimit: number | null
  memLimitText: string | null
  memPctOfLimit: number | null
  restarts: number
  hasLimit: boolean
}

export interface DeploymentItem {
  namespace: string
  name: string
  desired: number
  ready: number
  updated: number
  available: number
  age: string
  images: string[]
}

export interface EventItem {
  namespace: string
  type: string
  reason: string
  object?: string
  message?: string
  count?: number
  lastSeen?: string
}

export interface AggLogLine { pod: string; ns: string; line: string }

export interface AggregateLogsResult {
  pods: string[]
  podCount?: number
  capped?: boolean
  lines: AggLogLine[]
  truncated?: boolean
}

export interface AiStatus {
  enabled: boolean
  aiProvider: string | null
  aiModel: string | null
  aiConfigured: boolean
  mode: 'agent' | 'heuristic'
  readOnly: boolean
  storage: { mode: string; warning?: string }
  tools: Array<{ name: string; mutating: boolean }>
}

export interface AgentStep {
  phase: string
  message: string
  tool?: string
  args?: Record<string, unknown>
}

export interface InvestigateReport {
  summary?: string
  root_cause?: string
  evidence?: string[]
  suggested_fix?: string
  confidence?: number
  target?: string | null
  namespace?: string | null
  provider?: string
  signals?: Array<{ code: string; severity: Severity; title: string }>
  id?: string
  created_at?: string
}

export interface InvestigationRow {
  id: string
  question: string
  namespace?: string | null
  target?: string | null
  summary?: string
  root_cause?: string
  confidence?: number | null
  evidence?: string[]
  suggested_fix?: string
  provider?: string
  created_at?: string
}

export interface HealthReport {
  metricsAvailable: boolean
  generatedAt: string
  score: number
  grade: string
  counts: Record<Severity, number>
  cluster: { cpuPct: number | null; memPct: number | null; cpuText: string; memText: string }
  nodes: HealthNode[]
  topMemory: TopContainer[]
  topCpu: TopContainer[]
  issues: HealthIssue[]
  summary: string
}
