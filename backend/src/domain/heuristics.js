'use strict';
/*
 * Investigation heuristics.
 * -------------------------
 * Pure functions that scan gathered Kubernetes data (pods, events, logs,
 * metrics) and emit structured "signals". These power two things:
 *   1. Strong hints injected into the AI prompt so the model reasons well.
 *   2. A deterministic fallback root-cause analysis when no AI provider is
 *      configured (keeps the feature usable fully offline).
 *
 * Each signal: { code, severity, title, detail, evidence[], fix }
 */

const SEV = { critical: 3, high: 2, medium: 1, low: 0 };

// Log line patterns that commonly indicate a specific class of failure.
const LOG_PATTERNS = [
  { code: 'DB_CONN', re: /(connection (refused|timed? ?out|reset)|could not connect|connection pool|too many connections|ORA-|ECONNREFUSED|pool exhaust)/i, title: 'Database / connection errors in logs', fix: 'Check the dependency (DB/cache) availability, network policy, credentials, and connection pool size.' },
  { code: 'OOM_LOG', re: /(java\.lang\.OutOfMemoryError|out of memory|cannot allocate memory|fatal error: runtime: out of memory)/i, title: 'Out-of-memory errors in logs', fix: 'Raise the container memory limit/request or fix the leak; verify GC/heap settings.' },
  { code: 'AUTH', re: /(401 unauthorized|403 forbidden|permission denied|access denied|invalid (token|credentials))/i, title: 'Authentication / authorization failures in logs', fix: 'Verify credentials, tokens, RBAC, and mounted secrets.' },
  { code: 'TLS', re: /(x509|certificate (verify failed|has expired)|tls handshake|ssl error)/i, title: 'TLS/certificate errors in logs', fix: 'Check certificate validity/CA trust and SNI/hostname configuration.' },
  { code: 'DNS', re: /(no such host|name resolution|could not resolve|dns lookup failed|getaddrinfo)/i, title: 'DNS resolution failures in logs', fix: 'Verify the service name, CoreDNS health, and the target Service/Endpoints exist.' },
  { code: 'PANIC', re: /(panic:|traceback \(most recent call last\)|unhandled exception|fatal exception|segfault)/i, title: 'Unhandled crash / panic in logs', fix: 'Inspect the stack trace; the application is crashing on startup or under load.' },
];

function pushSignal(list, sig) { list.push(sig); }

// --- pod-level analysis -----------------------------------------------------

function analyzePods(pods = []) {
  const signals = [];
  for (const p of pods) {
    const ref = `${p.namespace}/${p.name}`;
    for (const c of p.containers || []) {
      const wr = c.state && c.state.kind === 'waiting' ? c.state.reason : null;
      const tr = c.state && c.state.kind === 'terminated' ? c.state.reason : null;
      const lastReason = c.lastTerminated && c.lastTerminated.reason;

      if (wr === 'CrashLoopBackOff' || lastReason === 'Error' && c.restartCount > 0) {
        pushSignal(signals, { code: 'CrashLoopBackOff', severity: 'critical',
          title: `Container '${c.name}' is crash-looping`,
          detail: `Pod ${ref} container ${c.name} restarted ${c.restartCount}× (state: ${wr || (c.state && c.state.kind)}).`,
          evidence: [`restarts=${c.restartCount}`, `lastTerminated=${JSON.stringify(c.lastTerminated)}`],
          fix: 'Read previous-instance logs (getLogs previous=true) to find the startup error; fix config/dependency and redeploy.' });
      }
      if (wr === 'ImagePullBackOff' || wr === 'ErrImagePull') {
        pushSignal(signals, { code: 'ImagePullBackOff', severity: 'critical',
          title: `Image cannot be pulled for '${c.name}'`,
          detail: `Pod ${ref}: ${wr}. Image=${c.image}. ${(c.state && c.state.message) || ''}`,
          evidence: [`image=${c.image}`, `reason=${wr}`],
          fix: 'Verify the image name/tag exists and registry credentials (imagePullSecrets) are correct.' });
      }
      if (tr === 'OOMKilled' || lastReason === 'OOMKilled') {
        pushSignal(signals, { code: 'OOMKilled', severity: 'critical',
          title: `Container '${c.name}' was OOMKilled`,
          detail: `Pod ${ref} container ${c.name} exceeded its memory limit and was killed (restarts=${c.restartCount}).`,
          evidence: [`reason=OOMKilled`, `restarts=${c.restartCount}`],
          fix: 'Increase memory limit/request or reduce memory usage; check for leaks.' });
      }
      if (wr === 'CreateContainerConfigError' || wr === 'CreateContainerError') {
        pushSignal(signals, { code: 'ConfigError', severity: 'high',
          title: `Container config error for '${c.name}'`,
          detail: `Pod ${ref}: ${wr}. ${(c.state && c.state.message) || ''}`,
          evidence: [`reason=${wr}`],
          fix: 'Check referenced ConfigMaps/Secrets and env/volume mounts exist and are valid.' });
      }
      if (c.restartCount >= 5 && !wr) {
        pushSignal(signals, { code: 'FrequentRestarts', severity: 'high',
          title: `Container '${c.name}' restarting frequently`,
          detail: `Pod ${ref} container ${c.name} has ${c.restartCount} restarts.`,
          evidence: [`restarts=${c.restartCount}`],
          fix: 'Inspect logs and liveness probe configuration; the container is unstable.' });
      }
    }
    if (p.phase === 'Pending') {
      pushSignal(signals, { code: 'Pending', severity: 'high',
        title: `Pod ${ref} stuck in Pending`,
        detail: `Phase=Pending. ${p.reason || ''} ${p.message || ''}`.trim(),
        evidence: [`phase=Pending`, p.reason ? `reason=${p.reason}` : ''].filter(Boolean),
        fix: 'Check events for FailedScheduling (insufficient CPU/memory, taints, unbound PVC).' });
    }
  }
  return signals;
}

// --- event-level analysis ---------------------------------------------------

function analyzeEvents(events = []) {
  const signals = [];
  const seen = new Set();
  for (const e of events) {
    if (e.type !== 'Warning') continue;
    const key = e.reason + '|' + (e.objectName || '');
    if (seen.has(key)) continue; seen.add(key);
    const base = { evidence: [`${e.reason} ×${e.count || 1}: ${e.message}`] };
    switch (e.reason) {
      case 'FailedScheduling':
        signals.push({ code: 'FailedScheduling', severity: 'high', title: 'Pod cannot be scheduled', detail: e.message,
          fix: 'Free up node CPU/memory, adjust requests, or fix taints/affinity/PVC binding.', ...base }); break;
      case 'Unhealthy':
        signals.push({ code: 'ProbeFailed', severity: 'high', title: 'Readiness/liveness probe failing', detail: e.message,
          fix: 'Confirm the probe path/port and that the app is actually serving; relax initialDelaySeconds if startup is slow.', ...base }); break;
      case 'BackOff':
        signals.push({ code: 'BackOff', severity: 'high', title: 'Container start back-off', detail: e.message,
          fix: 'Container keeps failing to start — read previous logs for the cause.', ...base }); break;
      case 'OOMKilling':
        signals.push({ code: 'OOMKilled', severity: 'critical', title: 'Kernel OOM killing container', detail: e.message,
          fix: 'Increase memory limit or reduce usage.', ...base }); break;
      case 'FailedMount':
        signals.push({ code: 'FailedMount', severity: 'high', title: 'Volume/secret mount failed', detail: e.message,
          fix: 'Verify the referenced PVC/Secret/ConfigMap exists and is bound.', ...base }); break;
      case 'Failed':
        signals.push({ code: 'EventFailed', severity: 'medium', title: 'Failure event', detail: e.message, fix: 'See event message.', ...base }); break;
      default:
        signals.push({ code: 'WarnEvent:' + e.reason, severity: 'low', title: e.reason, detail: e.message, fix: 'Review event.', ...base });
    }
  }
  return signals;
}

// --- log-level analysis -----------------------------------------------------

function analyzeLogs(logBundles = []) {
  const signals = [];
  for (const b of logBundles) {
    const text = (b.lines || []).join('\n');
    if (!text) continue;
    for (const pat of LOG_PATTERNS) {
      const m = text.match(pat.re);
      if (m) {
        const sample = (b.lines.find((l) => pat.re.test(l)) || m[0]).slice(0, 300);
        signals.push({ code: pat.code, severity: pat.code === 'DB_CONN' || pat.code === 'OOM_LOG' ? 'critical' : 'high',
          title: pat.title, detail: `In ${b.pod}${b.previous ? ' (previous instance)' : ''}: "${sample.trim()}"`,
          evidence: [sample.trim()], fix: pat.fix });
      }
    }
  }
  return signals;
}

// --- metrics analysis -------------------------------------------------------

function analyzeNodeMetrics(nodeMetrics) {
  const signals = [];
  if (!nodeMetrics || !nodeMetrics.available) return signals;
  for (const n of nodeMetrics.rows || []) {
    const cpu = parseInt(n.cpuPct, 10) || 0;
    const mem = parseInt(n.memoryPct, 10) || 0;
    if (cpu >= 90 || mem >= 90) {
      signals.push({ code: 'NodePressure', severity: 'high',
        title: `Node ${n.node} under resource pressure`,
        detail: `CPU ${n.cpuPct}, memory ${n.memoryPct}.`,
        evidence: [`cpu=${n.cpuPct}`, `mem=${n.memoryPct}`],
        fix: 'Node is near capacity — scale the cluster or rebalance/limit workloads.' });
    }
  }
  return signals;
}

// --- synthesis --------------------------------------------------------------

function dedupe(signals) {
  const map = new Map();
  for (const s of signals) {
    const ex = map.get(s.code);
    if (!ex || SEV[s.severity] > SEV[ex.severity]) map.set(s.code, s);
    else if (ex && s.evidence) ex.evidence = [...new Set([...(ex.evidence || []), ...s.evidence])].slice(0, 6);
  }
  return [...map.values()].sort((a, b) => SEV[b.severity] - SEV[a.severity]);
}

/**
 * Build a structured root-cause analysis purely from signals (no AI).
 * Returns the same shape the AI is asked to produce.
 */
function synthesizeReport(target, signals) {
  const ranked = dedupe(signals);
  if (!ranked.length) {
    return {
      summary: `${target} appears healthy. No crash loops, OOM kills, image-pull failures, probe failures, or error patterns were detected.`,
      root_cause: 'No problems detected from current pod states, events, logs, or metrics.',
      evidence: [], suggested_fix: 'No action needed. If you suspect an issue, specify a time window or symptom.',
      confidence: 60, signals: [],
    };
  }
  const top = ranked[0];
  const evidence = ranked.slice(0, 5).flatMap((s) => (s.evidence && s.evidence.length ? s.evidence : [s.detail])).slice(0, 8);
  // Confidence: based on the strongest signal's severity and corroboration count.
  const corroboration = ranked.filter((s) => SEV[s.severity] >= 2).length;
  const confidence = Math.min(95, 55 + SEV[top.severity] * 10 + Math.min(corroboration, 3) * 5);
  return {
    summary: `${target} is unhealthy: ${top.title.toLowerCase()}.`,
    root_cause: `${top.title} — ${top.detail}`,
    evidence,
    suggested_fix: top.fix,
    confidence,
    signals: ranked.map((s) => ({ code: s.code, severity: s.severity, title: s.title })),
  };
}

function analyzeAll({ pods, events, logBundles, nodeMetrics }) {
  return dedupe([
    ...analyzePods(pods),
    ...analyzeEvents(events),
    ...analyzeLogs(logBundles),
    ...analyzeNodeMetrics(nodeMetrics),
  ]);
}

module.exports = { analyzePods, analyzeEvents, analyzeLogs, analyzeNodeMetrics, analyzeAll, synthesizeReport, dedupe };


