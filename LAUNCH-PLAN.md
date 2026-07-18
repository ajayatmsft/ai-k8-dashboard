# Launch Plan — K8s Dashboard (v2 restructure + public launch)

Goal: **Node.js backend (zero runtime dependencies) + separate frontend** with strict
separation of concerns, trim the feature set to the sharpest wedge, polish the UI,
ship publicly, and set up for the open-core monetization path (free local
single-player → paid hosted-AI/team tier).

---

## 1. Architecture: split frontend / backend — ✅ DONE

Decision: stay on **Node.js** (keeps the `node`/`npx` one-line distribution story and
the zero-`npm install` claim; no JVM requirement for users). Scaling comes from
layering, not language:

```
backend/
  server.js        entry point (wiring + startup only)
  src/config.js    every env var in one place (PORT, READ_ONLY, DATA_DIR, CORS_ORIGIN, …)
  src/settings.js  kubeconfig/context selection
  src/infra/       kubectl+helm runners, audit/READ_ONLY gate, investigation store
  src/domain/      cluster analysis: health, heuristics, helm, addons, identity, nodes
  src/ai/          provider, agent loop, tool registry, startup stack
  src/http/        router, JSON/SSE responses + CORS, static serving
  src/routes/      thin API handlers grouped by concern (system, cluster, helm,
                   security, logs, ops, investigations) — SSE streams live beside
                   their JSON siblings
frontend/          static UI (vanilla JS today; React rebuild is Phase 2)
```

Why this scales later:
- The `/api/*` JSON+SSE contract is the seam: the frontend only knows `API_BASE`,
  so it can move to a CDN / separate host (backend supports `CORS_ORIGIN`).
- `domain/` functions are pure cluster-analysis services — the future paid team
  server reuses them unchanged.
- `infra/store.js` is the only persistence point; swapping JSON-file → real DB for
  the team tier touches one module.
- `DATA_DIR` separates code from runtime state (needed for packaged/installed runs).

Rules carried over (non-negotiable):
- Binds to localhost by default.
- Every kubectl invocation is an argv array; all user input validated (names, selectors, regexes).
- `READ_ONLY=1` disables every mutating endpoint server-side.
- Append-only `audit.log` for mutations and secret views.
- AI is tool-gated: agent can only call the registered tool functions; backend executes them.

**Next architecture step:** write `API.md` documenting the `/api/*` contract (routes,
params, response shapes, SSE events) so the React frontend rebuild and any future
mobile/CLI client build against a spec, not the code.

---

## 2. Feature review — keep / gate / defer / add

### Keep (the wedge — these are why anyone installs it)
- **Cluster Health**: score, gauges, memory-leak detection (OOM cycle + no-limit
  containers), crash detection, "what's using this node", top-processes-in-container,
  suggested fixes with one-click actions.
- **AI Investigation Assistant**: tool-gated agent, heuristic fallback (works with no
  key), Ollama for air-gapped, saved history. *This is the differentiator vs Lens/K9s/Headlamp.*
- **Aggregate Logs**: regex/label multi-pod snapshot + live tail + download.
- **Core browse**: Overview, Pods, Deployments, Events, Describe/YAML, per-pod logs.
- **Node Pools** (SKUs, zones, taints, nodeSelector labels) — SREs love this, rare elsewhere.
- **Multi-kubeconfig / context switcher** (non-destructive `--context` per call).
- **Safety rails**: READ_ONLY mode, audit log, scale/restart/delete-pod with confirms.

### Keep but gate harder (security surface)
- **Secrets value reveal** → redacted by default; reveal requires a confirm click and is
  always audited; disabled entirely in READ_ONLY.
- **Debug shell (exec)** → `EXEC_ENABLED` flag. Default ON (localhost single-user;
  the health view's "Top processes" action depends on it) — shared instances set
  `EXEC_ENABLED=0` or `READ_ONLY=1`, both of which disable it server-side.
- **Bulk Ops** → dry-run is server-enforced: execute must present the HMAC confirm
  token from its own preview; a changed matched set invalidates it (409).

### Defer to v2.x (cut from launch scope)
- **Helm** status/history/values → keep only the read-only release *list* at launch.
- **Add-ons / operators detection** → great demo, low daily use. Defer.
- **Service Accounts + Identities views** → niche (valuable for enterprise AKS/EKS later
  — good candidate for the paid tier). Defer.
- **PostgreSQL investigation store** → cut; the JSON file store is enough for
  single-user, and psql shell-out is fragile. Reintroduce properly in the paid team tier.
- **Claude/Gemini provider stubs** → remove dead stubs; OpenAI-compatible + Ollama covers launch.

### Add (user-friendliness gaps in v1)
- **First-run experience**: auto-detect kubeconfigs, friendly empty states, a "no
  metrics-server detected" banner with a fix hint instead of silent blanks.
- **Command palette** (Ctrl+K): jump to any pod/deployment/view — the single biggest
  "feels fast" win for an SRE tool.
- **Dark mode** (default) + light. One accent color.
- **Investigation export**: copy a finished investigation as Markdown (for pasting into
  Slack/incident docs). Cheap to build, spreads the product organically.
- **Landing view = Cluster Health**, not a generic pod list. Lead with the differentiator.

---

## 3. UI principles for the rebuild

- Keep the left sidebar (Cluster / Workloads / Observability / Security groups).
- Dense tables over cards; virtualized lists for big clusters.
- Consistent loading/empty/error states everywhere (one shared pattern).
- Keyboard-first: palette, `/` to filter any table, `Esc` closes panels.
- Detail panels slide over the list (no full-page navigations).
- Live things (log tail, health gauges, agent progress) always show a visible
  "streaming" indicator and never jump-scroll while the user is reading.

---

## 4. Step-by-step launch plan

### Phase 0 — Decisions (this week)
1. **Name** the product (a real name, not "k8s-local-dashboard" — check the name is free
   on GitHub, npm-style registries, and as a .dev/.io domain).
2. Create the GitHub org + repo under that name; fix `package.json` placeholder URLs.
3. **License**: keep MIT (see §5); update the copyright line to your name.
4. Freeze the v2 launch scope to §2 above.

### Phase 1 — Backend restructure + hardening — ✅ DONE
1. ✅ Split into `backend/` (layered: config / infra / domain / ai / http / routes)
   and `frontend/` with a configurable API base + optional CORS.
2. ✅ `API.md` written from the route modules; route list locked by
   `backend/test/router.test.js`.
3. ✅ Tests (`npm test`, zero deps): validators, health quantity parsers, the
   READ_ONLY gate, the exec gate, confirm tokens, and the router contract.
4. ✅ Feature gating: secrets redacted in READ_ONLY (values + YAML manifests),
   `EXEC_ENABLED` flag (default ON — the health view's "Top processes" flagship
   action depends on exec; shared instances set `EXEC_ENABLED=0` or `READ_ONLY=1`),
   bulk execute requires the server-verified dry-run confirm token.

### Phase 2 — Frontend rebuild — ✅ DONE (July 2026)
React + TS + Tailwind v4 app in `ui/`, built by the `ui-build` GitHub Actions
workflow (restricted machines download the `ui-dist` artifact and serve it via
`FRONTEND_DIR`). All views at parity with the vanilla frontend: Health (landing,
with Top-processes + Logs issue actions), Overview, Node Pools, Helm, Pods,
Deployments, Bulk Ops (server-token dry-run flow), Logs (snapshot + SSE live
tail), Events, AI Investigate (streaming), Secrets (redaction-aware), Identities,
debug shell, describe/YAML modals, kubeconfig/context switcher, Ctrl+K palette.
Remaining nice-to-have: the YAML apply/edit flow (vanilla-only for now).

**Next structural step:** make the React bundle the default UI (ship `ui/dist`
in releases / npm package), then retire `frontend/`.

### Phase 3 — Packaging & repo polish (in progress)
1. ✅ React bundle is the shipped default: backend auto-serves `ui/dist` /
   `ui-dist`, falling back to the legacy frontend; `npm run fetch-ui` pulls the
   CI build on npm-restricted machines.
2. ✅ Release pipeline: pushing a `vX.Y.Z` tag runs tests, builds the UI,
   attaches an offline zip to a GitHub Release, and publishes to npm when an
   `NPM_TOKEN` repo secret exists (`.github/workflows/release.yml`).
   `prepack` guard blocks publishing without a built UI.
3. ✅ README rewritten as a landing page (leak-detection hero + quickstart).
   TODO: record the demo GIF (health issue → Top processes → leaking process).
4. ⬜ DECIDE THE NAME (blocks npm publish): check availability on npm + GitHub
   + .dev domain, then rename package.json#name and the repo.
5. ⬜ First tag: `git tag v2.0.0 && git push origin v2.0.0` (after name).
6. Later: single-binary builds via Node SEA; `start.sh` for mac/linux double-click.
3. README rewritten as a landing page: one screenshot GIF above the fold
   (the memory-leak → top-processes flow), 60-second quickstart, feature sections.
4. Record that GIF (the "find the leaking process without reading code" demo).
5. CONTRIBUTING.md, issue templates, a Discussions tab or Discord link.

### Phase 4 — Launch (1 week)
1. Soft launch: 3–5 SRE/devops friends run it against real clusters; fix the top papercuts.
2. Public: r/kubernetes and r/devops posts (lead with the leak-detection story, not
   "another dashboard"), Hacker News "Show HN", dev.to/Medium write-up
   ("How I detect memory leaks in any pod down to the process"), LinkedIn.
3. Submit to k8s tool lists: awesome-kubernetes, CNCF landscape (later), Collabnix, etc.
4. Answer every issue/comment fast for the first two weeks — early responsiveness is
   the whole marketing budget.

### Phase 5 — Post-launch (monetization runway)
1. Watch which features get issues/PRs; add opt-in anonymous usage ping only if needed.
2. First paid experiment: **hosted AI** (no API key needed, N investigations/month) —
   smallest build, clearest value, doesn't fragment the open core.
3. Team tier only on inbound demand (the "can we get SSO?" email is the trigger).
4. Keep paid code in a separate private repo/module from day one — never mixed into
   the MIT core.

---

## 5. Licensing — what you actually need to know

- **MIT is not purchased or registered.** It's a 21-line text file granting permission;
  the repo already contains it (`LICENSE`). You own the copyright automatically by
  writing the code.
- **Action needed:** change line 3 to `Copyright (c) 2026 <your name>`.
- **Keep MIT for the core.** It's the community-friendliest choice and the k8s audience
  is allergic to restrictive licenses (see the Lens backlash). Alternative: Apache-2.0
  (adds an explicit patent grant, standard in the CNCF world) — also fine; pick one and
  don't switch later.
- The open-core model does **not** require relicensing: the free tool stays MIT forever;
  paid features (hosted AI, SSO, team server) live in separate, closed-source code that
  merely talks to the open core. That separation is a repo-structure decision, not a
  license decision — which is why paid code starts in its own private repo (§4, Phase 5).
