# API Contract — k8s-local-dashboard backend

The backend exposes a JSON + SSE API under `/api/*`. This document is the
contract between the backend and any client (bundled frontend, future React
rebuild, CLI, mobile). **Renaming or removing anything here is a breaking
change** — `backend/test/router.test.js` enforces the route list.

## Conventions

- Base URL: same origin by default (`http://127.0.0.1:7575`). A separately
  hosted client sets its API base and the backend must run with
  `CORS_ORIGIN=<client origin>`.
- Reads are `GET` with query parameters; mutations are `POST` with a JSON body.
- The common `ns` parameter is a namespace name, or `_all` (or empty/absent)
  for all namespaces.
- Success: `200` with a JSON object.
- Errors: non-200 with `{ "error": string, "stderr"?: string }`.
  Statuses used: `400` invalid input, `403` forbidden (READ_ONLY / exec
  disabled / secret manifest in read-only), `404` unknown endpoint or missing
  resource, `409` bulk execute without a valid dry-run token, `500` kubectl or
  internal failure.
- SSE endpoints (`streamLogs`, `investigate`) send named events
  (`event: <name>\ndata: <json>\n\n`) and a `: hb` comment heartbeat every 15s.

## Gating rules

| Gate | Effect |
|---|---|
| `READ_ONLY=1` | All mutating endpoints return 403. Secret values are redacted (`secret` returns `redacted: true`, `manifest` for secrets returns 403). `config.execEnabled` is false. |
| `EXEC_ENABLED=0` | `exec` returns 403; everything else unaffected. |
| Bulk confirm token | `bulkRestart` / `bulkDeletePods` with `dryRun: false` require `confirmToken` from a prior `dryRun: true` response with the **same filter and matched count**. Mismatch → 409. Tokens are invalid across server restarts. |

## System

### GET /api/health
→ `{ ok, context, server, readOnly }`

### GET /api/config
→ `{ kubeconfig, defaultKubeconfig, kubeconfigs: string[], context, contexts: string[], readOnly, execEnabled }`

### POST /api/setConfig
Body: `{ kubeconfig?, context?, namespace? }` (all strings; empty string clears;
changing kubeconfig without a context clears the context).
→ `{ ok, settings, context, server, error }` — probes the new selection.

### GET /api/aiStatus
→ `{ enabled, aiProvider, aiModel, aiConfigured, mode: "agent"|"heuristic", storage: { mode, warning? }, readOnly, tools: [{ name, mutating }] }`

## Cluster (read-only)

### GET /api/namespaces
→ `{ namespaces: [{ name, status, age }] }`

### GET /api/overview?ns=
→ `{ totalPods, phases: { [phase]: count }, restarts, containersReady, containersTotal, nodes: [{ name, ready, version, usage: { cpu, cpuPct, mem, memPct } | null }], metrics: bool }`

### GET /api/clusterHealth?ns=
→ health report from the analyzer: score, gauges, issues (memory leaks, OOM
cycles, crashes, node pressure with per-node pod attribution), top consumers,
suggested fixes. Shape defined in `backend/src/domain/health.js`.

### GET /api/nodePools?ns=
→ `{ pools: [{ name, mode, count, ready, skus[], zones[], os[], arch[], totalCpu, totalMemory }], nodes: [{ name, pool, sku, zone, ready, cpu, memory, pods, maxPods, taints[], labels, age, … }], scheduling: [{ namespace, name, kind, nodeSelector, affinity[], tolerations[] }] }`

### GET /api/deployments?ns=
→ `{ items: [{ namespace, name, desired, ready, updated, available, age, images[] }] }`

### GET /api/pods?ns=
→ `{ items: [{ namespace, name, phase, ready: "n/m", restarts, node, podIP, age, containers[] }] }`

### GET /api/events?ns=
→ `{ items: [{ namespace, type, reason, object, message, count, lastSeen }] }` (newest first)

### GET /api/describe?type=&ns=&name=
→ `{ text }` (`kubectl describe` output)

### GET /api/manifest?type=&ns=&name=
→ `{ text }` (YAML). 403 for secrets in READ_ONLY mode.

### GET /api/top?kind=nodes|pods&ns=
→ `{ available, kind, rows: string[][], error? }`

## Helm & add-ons (read-only)

### GET /api/helm?ns=
→ `{ source: "helm"|"secrets"|"none", items: [{ name, namespace, revision, status, chart, appVersion, updated }], error? }`

### GET /api/helmRelease?ns=&name=
→ `{ name, namespace, status?, history?, values?, helmAvailable, error? }` (best-effort; needs helm binary for detail)

### GET /api/addons
→ `{ detected: [{ name, category, evidence[] }], crdGroups: [{ group, count }], systemWorkloads: [{ kind, namespace, name, images[] }] }`

## Security (read-only + audited)

### GET /api/secrets?ns=
→ `{ items: [{ namespace, name, type, keys[], age }] }` (never values)

### GET /api/secret?ns=&name=
→ `{ name, namespace, type, data: { [key]: decodedValue }, redacted? }`.
Always audited. In READ_ONLY mode values are `<redacted — READ_ONLY mode>` and
`redacted: true`.

### GET /api/serviceAccounts?ns=
→ `{ items: [{ namespace, name, secrets[], automount, identity, hasIdentity, age }] }`

### GET /api/identities?ns=
→ `{ workloadIdentity[], azureIdentities[], podIdentityBindings[], serviceAccountsWithIdentity[] }`

## Logs

### GET /api/logs?ns=&pod=&container=&tail=&previous=&search=
→ `{ lines: string[], truncated?, error? }` (tail ≤ 10000, output capped at 5000 lines)

### GET /api/aggregateLogs?ns=&regex=|selector=&tail=&search=
Merged snapshot across matching pods (≤ 60 pods, all containers, timestamps).
→ `{ pods: string[], podCount, capped, lines: [{ pod, ns, line }], truncated }`

### GET /api/streamLogs?ns=&regex=|selector=&tail=&search= (SSE)
Events:
- `meta` `{ podCount, streaming, capped, pods[] }` (or `{ pods: [], message }`)
- `log` `{ pod, ns, line }`
- `warn` `{ pod, line }`
- `podclose` `{ pod }`
- `eof` `{}` (only when no pods matched)

## Mutations (403 in READ_ONLY; all audited)

### POST /api/exec
Body: `{ ns, pod, container?, command }` — runs `/bin/sh -c <command>` in the pod.
403 when `EXEC_ENABLED=0`. → `{ output, error? }`

### POST /api/restart
Body: `{ ns, name, kind? = "deployment" }` → `{ output }` (rollout restart)

### POST /api/scale
Body: `{ ns, name, replicas: 0–1000, kind? = "deployment" }` → `{ output }`

### POST /api/deletePod
Body: `{ ns, pod }` → `{ output }`

### POST /api/applyManifest
Body: `{ yaml }` (≤ 2 MB) — `kubectl apply -f -` via stdin. → `{ output }`

### POST /api/bulkRestart
Body: `{ ns, regex?|selector?, kinds?: ("deployment"|"statefulset"|"daemonset")[], dryRun, confirmToken? }`
- `dryRun: true` → `{ dryRun: true, matched: [{ kind, namespace, name }], confirmToken }`
- `dryRun: false` (requires `confirmToken`) → `{ dryRun: false, matched, restarted: [{ …, ok, error? }] }`

### POST /api/bulkDeletePods
Body: `{ ns, regex?|selector?, dryRun, confirmToken? }`
- `dryRun: true` → `{ dryRun: true, matched: [{ namespace, name }], confirmToken }`
- `dryRun: false` (requires `confirmToken`) → `{ dryRun: false, deleted: [{ namespace, name, ok, error? }] }`

## AI investigations (never mutate the cluster)

### GET /api/investigations
→ `{ items: [{ id, question, namespace, target, summary, root_cause, confidence, suggested_fix, provider, created_at }] }` (≤ 50, newest first)

### GET /api/investigation?id=
→ one investigation row (404 if missing)

### GET /api/investigate?question=&ns=&maxSteps= (SSE)
Runs the agent (or heuristic engine when no AI key). Events:
- `meta` `{ question, provider, model, readOnly }`
- `step` `{ …agent progress… }` (one per tool call / reasoning step)
- `warn` `{ message }` (e.g. persistence failure)
- `report` `{ summary, root_cause, confidence, evidence[], suggested_fix, provider, id?, created_at? }`
- `error` `{ error }`
- `eof` `{}` (always last)
