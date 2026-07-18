# K8s Local Dashboard

**Find the memory leak. Down to the process. Without reading the code.**

A tiny, **offline-first** Kubernetes debug dashboard that runs from a single
`node` command. It talks to any cluster your kubeconfig can reach through the
`kubectl` binary already on your machine — **zero runtime dependencies, no
internet required, nothing installed in your cluster**.

It continuously grades cluster health, detects OOM-kill/leak cycles and crash
loops, attributes node memory pressure to the exact pods causing it, and — one
click later — lists the **processes inside the suspect container sorted by
RSS**. An AI investigation assistant (works offline with built-in heuristics;
plug in OpenAI or a local Ollama for the full agent) turns "why is checkout
failing?" into a structured root-cause analysis.

<!-- TODO(launch): demo GIF here — health issue → “Top processes” → leaking
     process identified. This is the landing shot. -->

## Quickstart

```bash
# Prerequisites: Node 18+ and kubectl on PATH (kubectl get pods works)

# Option A — from a GitHub release (offline-friendly)
#   download the zip from the Releases page, unzip, then:
node backend/server.js

# Option B — from a clone
git clone https://github.com/ajayatmsft/ai-k8-dashboard.git && cd ai-k8-dashboard
npm run fetch-ui     # grabs the pre-built UI from CI (needs gh CLI) — no npm install ever
npm start
```

Open <http://127.0.0.1:7575>. Switch kubeconfig/context from the UI — nothing
on your machine is modified.

## Features

### ❤️ Cluster Health — memory-leak & crash detection (new)
A dedicated **Cluster Health** view that continuously grades your cluster and
surfaces the two problems teams hit most: **memory leaks/OOM kills** and
**crashes**.

- **Health score + live gauges** – an at-a-glance 0–100 score plus cluster-wide
  **CPU** and **memory** meters (from `kubectl top` + node allocatable).
- **Memory-leak detection** – flags containers stuck in the classic
  *grow → hit limit → OOMKill → restart* cycle (high memory-vs-limit ratio
  combined with repeated `OOMKilled` restarts), and containers running with **no
  memory limit** that can take a whole node down.
- **Crash detection** – `CrashLoopBackOff`, frequent restarts, `ImagePullBackOff`,
  and pod evictions, correlated with events.
- **"What is using this node?"** – when a node is under memory pressure (e.g.
  *"Node aks-… memory at 96%"*) the alert now lists the **top memory-consuming
  pods/containers scheduled on that exact node**, each with its share of node
  memory, and shows how much is workloads vs. kubelet/OS overhead.
- **Down to the process** – a one-click **"Top processes"** action runs
  `ps`/`top` (with a portable `/proc` fallback) **inside** the suspect container
  and lists its processes sorted by resident memory (RSS). A process whose RSS
  keeps growing across refreshes is your leak — **all without reading the code**.
- **Top memory/CPU consumers** – ranked, with each container's usage vs its limit
  so leak suspects are obvious.
- **Fix, don't just find** – every issue comes with a **concrete suggested fix**
  and one-click actions: jump to **previous-instance logs**, **Describe** the pod,
  **restart** it, or hand it to the **AI assistant** for a deep root-cause dive.
- The same analysis is exposed to the AI as a `getClusterHealth` tool, so
  *"do we have a memory leak?"* is answered with real data.

### 🤖 AI Investigation Assistant
Ask in plain English — **"Investigate payment-service"**, **"Why is checkout
failing?"**, **"Find pods restarting frequently"** — and an agent automatically
gathers cluster state, correlates findings, and returns a **root-cause
analysis**: summary, root cause, evidence, suggested fix, and a confidence
score. Live progress streams as it works, and every investigation is saved to a
searchable history.

- **Tool-gated by design** — the AI never talks to Kubernetes directly. It can
  only call approved, validated tools (`getPods`, `getEvents`, `getLogs`,
  `getPodMetrics`, `getClusterHealth`, `getNodePools`, `getHelmReleases`,
  `getClusterAddons`, `getServiceAccounts`, `getPodIdentities`, …). The backend
  executes them and feeds results back.
- **Works offline too** — with no AI key configured, a built-in heuristic engine
  still diagnoses the common failure modes (CrashLoopBackOff, OOMKilled,
  ImagePullBackOff, failed probes, resource exhaustion, DB/connectivity errors).
- **Pluggable providers** — OpenAI today (set `OPENAI_API_KEY`); Ollama is wired
  for fully local/air-gapped use; Claude/Gemini are stubbed for later.
- **Investigations only ever read** the cluster — they never mutate it.

### Browse & inspect
- **Overview** – pod phases, container readiness, total restarts, and **node
  CPU/memory usage** (via `kubectl top`, shown when metrics-server is present).
- **Node Pools** – node pools grouped with their **VM SKUs / instance types**,
  AKS **System/User mode**, **availability zones**, OS/arch, aggregate CPU/memory
  and ready counts. A per-node table shows SKU, zone, pod count and **taints**,
  and each node opens a detail panel listing the exact **labels you'd use in a
  `nodeSelector`**. A **"Node selectors in use"** section lists every workload
  that pins itself via `nodeSelector`, **node affinity**, or **tolerations** — so
  you can see which pool/SKU each service targets. Works across AKS, EKS, GKE and
  Karpenter label conventions.
- **Deployments** – ready/available replicas, images, age.
- **Pods** – phase, ready, restarts, node, IP, age.
- **⎈ Helm** – every **Helm release** in the cluster (name, namespace, revision,
  status, chart, app version, last deployed). Uses the `helm` binary when it's
  on PATH (then exposes per-release **status / history / values**); otherwise it
  decodes the `helm.sh/release.v1` Secrets directly so it still works **without
  helm installed**.
- **Add-ons** – auto-detects **cluster add-ons / operators** (ingress,
  cert-manager, service mesh, CNI, observability, policy, identity, CSI drivers,
  GitOps…) by correlating installed **CRD API groups** with **system-namespace
  workloads**, plus a raw list of both for full visibility.
- **Identities** – **managed identities attached to pods**: Azure **Workload
  Identity** (annotated service accounts + pods opting in via
  `azure.workload.identity/use`) and legacy **AAD Pod Identity** (`AzureIdentity`
  CRDs + `aadpodidbinding` labels). Also surfaces AWS IRSA role ARNs and GCP
  Workload Identity annotations.
- **Service Accounts** – every service account with token **automount** setting,
  attached secrets, and any **cloud identity** annotation (Azure client-id, AWS
  role ARN, GCP service account).
- **Secrets** – list keys, open one to **reveal decoded values** or view YAML.
- **Events** – cluster events, warnings highlighted, newest first.
- **Describe / YAML** – one click on any deployment or pod.

> **Fluent UI** – navigation lives in a collapsible **left sidebar** grouped by
> Cluster / Workloads / Observability / Security. Lists (Secrets, Pods,
> Deployments, Events, Logs) now have **richer filters** — free-text plus
> **namespace / type / phase** dropdowns — so you can zero in fast.

### Multi-cluster / multi-region
- **Kubeconfig picker** – choose any kubeconfig discovered in `~/.kube`, or type
  a custom path. Switch at runtime, no restart.
- **Context / region switcher** – switch between contexts defined in the
  selected kubeconfig. **Non-destructive**: the app passes `--context` per call
  and never edits your kubeconfig file.
- Your last kubeconfig/context/namespace are remembered in `settings.json`.

### Debugging
- **Per-pod logs** – pick pod/container, tail N lines, `--previous`, search with
  highlight.
- **Aggregate Logs** – the headline feature. Give a **name regex** (e.g.
  `extension`) or a **label selector**, and see logs from *all* matching pods
  merged into one view, each line prefixed and color-coded by pod:
  - **Snapshot** – pull the last N lines from every matching pod at once.
  - **Live tail** – follow all matching pods in real time (streamed via SSE).
  - **Search / highlight** and **Download** the combined log to a file.
  - On Deployments, the **Logs** button jumps straight here pre-filtered to that
    deployment's pods.
- **Debug shell** – run a command inside a pod (`kubectl exec … -- /bin/sh -c`).

### Operations (with safety rails)
- **Scale** a deployment to N replicas.
- **Restart** a single deployment (rolling restart).
- **Delete** a single pod (controller recreates it).
- **Bulk Ops** – restart or recreate **many** workloads matching a regex or label
  selector at once:
  - Works on Deployments / StatefulSets / DaemonSets (rollout restart) or Pods
    (delete → recreate).
  - **Dry-run preview** shows exactly what will be affected before you execute.

### Production hardening
- **READ_ONLY mode** (`READ_ONLY=1`) disables every mutating action (restart,
  scale, delete, exec, bulk ops) **and redacts secret values** (keys stay
  visible; secret YAML manifests are blocked) — safe to share with a wider team.
- **EXEC_ENABLED=0** disables the debug shell independently of read-only mode.
- **Bulk ops require a server-verified dry-run**: the execute call must present
  the confirmation token returned by its own preview; if the matched set
  changed in between, the server rejects it and asks for a fresh preview.
- **Audit log** – every mutating action and secret view is appended to
  `audit.log` (timestamp, action, details).
- Binds to **localhost only** by default.
- Every kubectl call uses an argv array (never a shell string); all names,
  selectors, and regexes are validated, so UI input can't inject host commands.
- The full API surface is documented in [API.md](API.md) and locked by tests
  (`npm test`).

## Requirements

- [Node.js](https://nodejs.org) 18+ (`node -v`).
- `kubectl` on your PATH, configured for your cluster (`kubectl get pods` works).

No `npm install`. The backend is Node stdlib only; the React UI ships pre-built
(`ui/dist` in releases, or `npm run fetch-ui` from a clone). Without a built UI
the legacy no-build frontend in `frontend/` is served instead — same features.

## Run

```powershell
npm start          # or: node backend/server.js
```

Or double-click **`start.cmd`** (Windows). Then open <http://127.0.0.1:7575>.

### Configuration (environment variables)

| Variable       | Default       | Purpose                                          |
|----------------|---------------|--------------------------------------------------|
| `PORT`         | `7575`        | Port to listen on                                |
| `HOST`         | `127.0.0.1`   | Bind address (localhost only by default)         |
| `KUBECTL_PATH` | `kubectl`     | Full path to the kubectl binary                  |
| `HELM_PATH`    | `helm`        | Full path to the helm binary (optional)          |
| `READ_ONLY`    | `0`           | Set `1` to disable all mutating actions (also redacts secret values) |
| `EXEC_ENABLED` | `1`           | Set `0` to disable the debug shell / in-container process listing |
| `CORS_ORIGIN`  | _(unset)_     | Allow a separately hosted frontend origin to call the API |
| `DATA_DIR`     | repo root     | Where settings.json / audit.log / investigations.json live |

#### AI Assistant configuration

| Variable          | Default                       | Purpose                                                  |
|-------------------|-------------------------------|----------------------------------------------------------|
| `AI_PROVIDER`     | `openai`                      | `openai` \| `ollama` \| `claude` \| `gemini`             |
| `OPENAI_API_KEY`  | _(unset)_                     | Enables the OpenAI agent. If unset → heuristic-only mode |
| `OPENAI_MODEL`    | `gpt-4o-mini`                 | OpenAI model to use                                      |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1`   | Override for Azure OpenAI / compatible gateways          |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434/v1`   | Local Ollama endpoint (when `AI_PROVIDER=ollama`)        |
| `OLLAMA_MODEL`    | `llama3.1`                    | Local model name                                         |

#### Investigation history storage

Only **metadata** is stored (question, summary, root cause, confidence, evidence
references) — **never logs**. Two backends, chosen automatically:

| Variable      | Behaviour                                                                       |
|---------------|---------------------------------------------------------------------------------|
| `DATABASE_URL`| When set **and** `psql` is on PATH → PostgreSQL (table auto-created on startup). |
| `PSQL_PATH`   | Path to the `psql` binary (default `psql`).                                     |
| _(neither)_   | Falls back to a local `investigations.json` file — keeps the app fully offline. |

Example with OpenAI + PostgreSQL:

```powershell
$env:OPENAI_API_KEY="sk-…"; $env:DATABASE_URL="postgres://user:pass@localhost:5432/k8sdash"; node backend/server.js
```

Example (read-only, custom port):

```powershell
$env:READ_ONLY=1; $env:PORT=8080; node backend/server.js
```

You can switch kubeconfig and context **inside the UI** — no need to set env
vars or run `kubectl config use-context`.

## Tips for your team

- For a shared jump host, run with `READ_ONLY=1` for viewers; run a separate
  writable instance on another port for operators.
- The **Aggregate Logs** tab replaces "ssh/exec into each pod": type a service
  name like `extension`, hit **Live tail**, and watch every replica at once.
- **Bulk Ops** + dry-run is the fast way to restart a whole component
  (e.g. everything matching `extension`) after a config change.

## How it works

The repo is split into a **backend** and a **frontend** with a strict JSON +
SSE API contract between them.

The backend (`backend/`, Node stdlib only) exposes the API under `/api/*` and
shells out to `kubectl … -o json/yaml`, `kubectl logs -f`, `top`, `rollout
restart`, `scale`, and `delete`. Global `--kubeconfig`/`--context` flags are
derived from the settings you pick in the UI.

The frontend is a React + TypeScript + Tailwind app in `ui/`, built by CI and
served as static files by the backend (the backend auto-detects `ui/dist` or a
downloaded `ui-dist`, falling back to the legacy no-build `frontend/`). It can
also be hosted separately — start the backend with
`CORS_ORIGIN=<frontend origin>`.

## Layout

```
backend/
  server.js               entry point: wiring + startup logging only
  src/config.js           every env var / tunable in one place (incl. DATA_DIR)
  src/util.js             input validation, HTTP errors, formatting
  src/settings.js         kubeconfig/context selection (settings.json)
  src/infra/kubectl.js    kubectl + helm process runners (argv-only, no shell)
  src/infra/audit.js      READ_ONLY gate + append-only audit.log
  src/infra/store.js      investigation metadata store (psql shell-out or JSON)
  src/domain/…            cluster analysis: health, heuristics, helm, addons,
                          identity, nodes, pod resolution
  src/ai/provider.js      pluggable AI provider (OpenAI via stdlib https; Ollama)
  src/ai/tools.js         tool registry — the only surface the agent can act through
  src/ai/agent.js         agent orchestrator (bounded tool loop + heuristic fallback)
  src/ai/stack.js         builds registry + provider + store at startup
  src/http/…              router, JSON/SSE responses + CORS, static serving
  src/routes/…            thin API handlers: system, cluster, helm, security,
                          logs (incl. SSE tail), ops, investigations (incl. SSE)
ui/
  src/                    React + TS + Tailwind app (views, components, typed API client)
  dist/                   built bundle (CI artifact; what the backend serves)
frontend/
  index.html, app.js, styles.css   legacy no-build UI (fallback when ui/dist absent)
scripts/
  check.js                syntax-check all backend+frontend files (npm run check)
  fetch-ui.js             download the CI-built React bundle (npm run fetch-ui)
  stop.js                 kill whatever is listening on PORT (npm run stop)
  package.js              build an offline zip (npm run package)
start.cmd                 Windows launcher (opens browser)
settings.json             runtime state (gitignored): chosen kubeconfig/context/ns
investigations.json       runtime history (gitignored) when no PostgreSQL configured
audit.log                 runtime audit trail (gitignored)
```

Extra backend env vars introduced by the split: `DATA_DIR` (where runtime state
files live; defaults to the repo root), `FRONTEND_DIR` (static files to serve),
`CORS_ORIGIN` (allow a separately hosted frontend; off by default).




