# K8s Local Dashboard

A tiny, **offline**, team-grade web dashboard for Kubernetes clusters. It uses
your existing **local kubeconfig** through the `kubectl` binary already on your
machine — **no internet connection required** and **no npm dependencies** to
install.

Point it at any cluster your kubeconfig can reach (local kind/minikube/k3s, or a
remote cluster), switch contexts/regions on the fly, debug pods, and tail logs
from many pods in one place.

## Features

### 🤖 AI Investigation Assistant (new)
Ask in plain English — **"Investigate payment-service"**, **"Why is checkout
failing?"**, **"Find pods restarting frequently"** — and an agent automatically
gathers cluster state, correlates findings, and returns a **root-cause
analysis**: summary, root cause, evidence, suggested fix, and a confidence
score. Live progress streams as it works, and every investigation is saved to a
searchable history.

- **Tool-gated by design** — the AI never talks to Kubernetes directly. It can
  only call approved, validated tools (`getPods`, `getEvents`, `getLogs`,
  `getPodMetrics`, …). The backend executes them and feeds results back.
- **Works offline too** — with no AI key configured, a built-in heuristic engine
  still diagnoses the common failure modes (CrashLoopBackOff, OOMKilled,
  ImagePullBackOff, failed probes, resource exhaustion, DB/connectivity errors).
- **Pluggable providers** — OpenAI today (set `OPENAI_API_KEY`); Ollama is wired
  for fully local/air-gapped use; Claude/Gemini are stubbed for later.
- **Investigations only ever read** the cluster — they never mutate it.

### Browse & inspect
- **Overview** – pod phases, container readiness, total restarts, and **node
  CPU/memory usage** (via `kubectl top`, shown when metrics-server is present).
- **Deployments** – ready/available replicas, images, age.
- **Pods** – phase, ready, restarts, node, IP, age.
- **Secrets** – list keys, open one to **reveal decoded values** or view YAML.
- **Events** – cluster events, warnings highlighted, newest first.
- **Describe / YAML** – one click on any deployment or pod.

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
  scale, delete, exec, bulk ops) — safe to share with a wider team.
- **Audit log** – every mutating action and secret view is appended to
  `audit.log` (timestamp, action, details).
- Binds to **localhost only** by default.
- Every kubectl call uses an argv array (never a shell string); all names,
  selectors, and regexes are validated, so UI input can't inject host commands.

## Requirements

- [Node.js](https://nodejs.org) 16+ (`node -v`).
- `kubectl` on your PATH, configured for your cluster (`kubectl get pods` works).

No `npm install`.

## Run

```powershell
cd C:\Users\kumarajay\k8s-local-dashboard
node server.js
```

Or double-click **`start.cmd`**. Then open <http://127.0.0.1:7575>.

### Configuration (environment variables)

| Variable       | Default       | Purpose                                          |
|----------------|---------------|--------------------------------------------------|
| `PORT`         | `7575`        | Port to listen on                                |
| `HOST`         | `127.0.0.1`   | Bind address (localhost only by default)         |
| `KUBECTL_PATH` | `kubectl`     | Full path to the kubectl binary                  |
| `READ_ONLY`    | `0`           | Set `1` to disable all mutating actions          |

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
$env:OPENAI_API_KEY="sk-…"; $env:DATABASE_URL="postgres://user:pass@localhost:5432/k8sdash"; node server.js
```

Example (read-only, custom port):

```powershell
$env:READ_ONLY=1; $env:PORT=8080; node server.js
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

`server.js` (Node stdlib only) exposes a small JSON + SSE API under `/api/*`
that shells out to `kubectl … -o json/yaml`, `kubectl logs -f`, `top`, `rollout
restart`, `scale`, and `delete`. The browser app in `public/` renders everything
client-side. Global `--kubeconfig`/`--context` flags are derived from the
settings you pick in the UI.

## Files

```
server.js            HTTP + SSE API, kubectl integration, audit, read-only gate
lib/ai.js            Pluggable AI provider (OpenAI via stdlib https; Ollama; stubs)
lib/tools.js         Tool registry — the only surface the agent can act through
lib/agent.js         Agent orchestrator (bounded tool-calling loop + heuristic fallback)
lib/investigation.js Heuristic detectors (CrashLoopBackOff, OOMKilled, probes, …)
lib/db.js            Investigation metadata store (psql shell-out or JSON fallback)
scripts/stop.js      kill whatever is listening on PORT (used by npm run stop)
package.json
start.cmd            Windows launcher (opens browser)
settings.json        runtime state (gitignored): chosen kubeconfig/context/ns
investigations.json  runtime history (gitignored) when no PostgreSQL configured
audit.log            runtime audit trail (gitignored)
public/index.html
public/styles.css
public/app.js        UI (vanilla JS, no build step) incl. AI Assistant tab
```




