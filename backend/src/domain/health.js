'use strict';
/*
 * Cluster health analysis.
 * ------------------------
 * Pure functions that turn raw cluster data (nodes, `kubectl top`, pod specs
 * and container statuses, events) into a structured *health report* focused on
 * the two failure classes teams hit most: memory pressure / leaks and crashes.
 *
 * The report drives the "Cluster Health" dashboard view and is also exposed as
 * an AI tool (getClusterHealth) so the assistant can reason over the same data.
 *
 * No external deps, no kubectl calls here — the server passes data in so this
 * module stays trivially testable.
 */

// --- quantity parsing -------------------------------------------------------

// CPU quantities -> millicores (e.g. "500m" -> 500, "2" -> 2000, "250n" -> 0.00025).
function parseCpuToMilli(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  if (s.endsWith('m')) return parseFloat(s) || 0;
  if (s.endsWith('n')) return (parseFloat(s) || 0) / 1e6; // nanocores
  if (s.endsWith('u')) return (parseFloat(s) || 0) / 1e3; // microcores
  return (parseFloat(s) || 0) * 1000;
}

const MEM_UNITS = {
  '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
  Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6,
};
// Memory quantities -> bytes (e.g. "128Mi" -> 134217728, "1Gi" -> 1073741824).
function parseMemToBytes(v) {
  if (v == null) return 0;
  const m = String(v).trim().match(/^([0-9.]+)\s*([A-Za-z]*)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]) || 0;
  const unit = MEM_UNITS[m[2]] != null ? MEM_UNITS[m[2]] : 1;
  return n * unit;
}

function fmtBytes(bytes) {
  if (!bytes) return '0';
  const u = ['B', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)}${u[i]}`;
}
function fmtCpu(milli) {
  if (milli >= 1000) return `${(milli / 1000).toFixed(milli % 1000 ? 2 : 0)}`;
  return `${Math.round(milli)}m`;
}
function pct(used, total) { return total > 0 ? Math.min(100, Math.round((used / total) * 100)) : null; }

// Node-pool name / VM SKU from cloud-agnostic node labels (AKS/EKS/GKE/Karpenter).
function nodePoolOf(node) {
  const l = (node.metadata && node.metadata.labels) || {};
  return l['kubernetes.azure.com/agentpool'] || l['agentpool']
    || l['eks.amazonaws.com/nodegroup'] || l['cloud.google.com/gke-nodepool']
    || l['karpenter.sh/nodepool'] || null;
}
function nodeSkuOf(node) {
  const l = (node.metadata && node.metadata.labels) || {};
  return l['node.kubernetes.io/instance-type'] || l['beta.kubernetes.io/instance-type'] || null;
}

// --- `kubectl top` parsing --------------------------------------------------

// `kubectl top nodes --no-headers` -> [{ node, cpuMilli, cpuPct, memBytes, memPct }]
function parseNodeTop(text) {
  if (!text) return [];
  return text.trim().split('\n').filter(Boolean).map((l) => {
    const c = l.trim().split(/\s+/);
    return {
      node: c[0], cpuMilli: parseCpuToMilli(c[1]), cpuPct: parseInt(c[2], 10) || null,
      memBytes: parseMemToBytes(c[3]), memPct: parseInt(c[4], 10) || null,
    };
  });
}

// `kubectl top pods --containers --no-headers` (with/without --all-namespaces)
// -> [{ namespace, pod, container, cpuMilli, memBytes }]
function parseContainerTop(text, allNs) {
  if (!text) return [];
  return text.trim().split('\n').filter(Boolean).map((l) => {
    const c = l.trim().split(/\s+/);
    // all-ns: [ns, pod, container, cpu, mem]; single-ns: [pod, container, cpu, mem]
    return allNs
      ? { namespace: c[0], pod: c[1], container: c[2], cpuMilli: parseCpuToMilli(c[3]), memBytes: parseMemToBytes(c[4]) }
      : { namespace: null, pod: c[0], container: c[1], cpuMilli: parseCpuToMilli(c[2]), memBytes: parseMemToBytes(c[3]) };
  });
}

// --- main analysis ----------------------------------------------------------

const WEIGHT = { critical: 25, high: 12, medium: 6, low: 2 };

function analyzeClusterHealth({ podsData, nodesData, nodeTop, podTop, eventsData, allNs = true, defaultNs = null, attribution = null }) {
  const issues = [];
  const add = (i) => issues.push(i);

  // ---- nodes + cluster-wide CPU/memory rollup ----
  const nodeUsage = new Map();
  for (const r of parseNodeTop(nodeTop)) nodeUsage.set(r.node, r);

  // ---- per-node memory attribution ("what is using this node's memory?") ----
  // Map each running container's measured memory to the node its pod sits on,
  // using cluster-wide data so the breakdown is complete regardless of the
  // namespace filter applied to the rest of the report.
  const attrPods = (attribution && attribution.podsData) || podsData;
  const attrTopText = attribution && attribution.podTop != null ? attribution.podTop : podTop;
  const nodeOfPod = new Map(); // ns/pod -> nodeName
  for (const p of attrPods.items || []) {
    if (p.spec && p.spec.nodeName) nodeOfPod.set(`${p.metadata.namespace}/${p.metadata.name}`, p.spec.nodeName);
  }
  const consumersByNode = new Map(); // node -> [{ namespace, pod, container, memBytes }]
  for (const row of parseContainerTop(attrTopText, true)) {
    const node = nodeOfPod.get(`${row.namespace}/${row.pod}`);
    if (!node) continue;
    if (!consumersByNode.has(node)) consumersByNode.set(node, []);
    consumersByNode.get(node).push({ namespace: row.namespace, pod: row.pod, container: row.container, memBytes: row.memBytes });
  }
  // Build the top-N consumer list for one node (sorted by memory, with % of the
  // node's measured usage so it's clear how much each explains).
  function topConsumersFor(nodeName, usedBytes, limit = 6) {
    const list = (consumersByNode.get(nodeName) || []).slice().sort((a, b) => b.memBytes - a.memBytes);
    const workloadBytes = list.reduce((s, x) => s + x.memBytes, 0);
    return {
      workloadBytes,
      workloadText: fmtBytes(workloadBytes),
      items: list.slice(0, limit).map((x) => ({
        namespace: x.namespace, pod: x.pod, container: x.container,
        memBytes: x.memBytes, memText: fmtBytes(x.memBytes),
        memPctOfNode: usedBytes ? Math.round((x.memBytes / usedBytes) * 100) : null,
      })),
    };
  }

  let cpuAllocMilli = 0; let cpuUsedMilli = 0; let memAllocBytes = 0; let memUsedBytes = 0;
  const nodes = (nodesData.items || []).map((n) => {
    const alloc = (n.status && n.status.allocatable) || {};
    const cpuAlloc = parseCpuToMilli(alloc.cpu);
    const memAlloc = parseMemToBytes(alloc.memory);
    const u = nodeUsage.get(n.metadata.name) || {};
    const ready = ((n.status && n.status.conditions) || []).find((c) => c.type === 'Ready');
    const conditions = (n.status && n.status.conditions) || [];
    const pressure = conditions.filter((c) => c.status === 'True' && /Pressure$/.test(c.type)).map((c) => c.type);
    cpuAllocMilli += cpuAlloc; cpuUsedMilli += u.cpuMilli || 0;
    memAllocBytes += memAlloc; memUsedBytes += u.memBytes || 0;

    const cpuP = u.cpuPct != null ? u.cpuPct : pct(u.cpuMilli, cpuAlloc);
    const memP = u.memPct != null ? u.memPct : pct(u.memBytes, memAlloc);
    const consumers = topConsumersFor(n.metadata.name, u.memBytes);

    // Attach the attribution to any node-memory issue so the UI can answer
    // "what is causing this?" right where the alert appears.
    const attrDetail = consumers.items.length
      ? ` Top consumers: ${consumers.items.slice(0, 3).map((x) => `${x.pod}/${x.container} (${x.memText}${x.memPctOfNode != null ? `, ${x.memPctOfNode}%` : ''})`).join(', ')}. Measured workloads use ${consumers.workloadText}; the remainder is kubelet/OS/system overhead.`
      : '';

    if (pressure.includes('MemoryPressure')) {
      add(issue('critical', 'NodeMemoryPressure', `Node ${n.metadata.name} reports MemoryPressure`,
        `The kubelet is evicting pods because the node is low on memory.${attrDetail}`,
        'Identify the top consumer(s) below, check for a leak (open "Top processes" to see the exact program), then right-size limits, reschedule, or add capacity.',
        { node: n.metadata.name, consumers: consumers.items }));
    }
    if ((memP != null && memP >= 85) && !pressure.includes('MemoryPressure')) {
      add(issue('high', 'NodeMemoryHigh', `Node ${n.metadata.name} memory at ${memP}%`,
        `Memory usage is ${fmtBytes(u.memBytes || 0)} of ${fmtBytes(memAlloc)} allocatable.${attrDetail}`,
        'Use the top-consumer breakdown below to find the culprit workload, then open "Top processes" to see which program inside it is growing. Right-size limits or fix the leak before eviction starts.',
        { node: n.metadata.name, consumers: consumers.items }));
    }
    if (cpuP != null && cpuP >= 90) {
      add(issue('high', 'NodeCpuHigh', `Node ${n.metadata.name} CPU at ${cpuP}%`,
        `CPU usage is ${fmtCpu(u.cpuMilli || 0)} of ${fmtCpu(cpuAlloc)} allocatable.`,
        'Throttling likely. Scale the deployment horizontally or add nodes.',
        { node: n.metadata.name }));
    }
    return {
      name: n.metadata.name,
      ready: ready ? ready.status === 'True' : false,
      version: n.status && n.status.nodeInfo && n.status.nodeInfo.kubeletVersion,
      pool: nodePoolOf(n), sku: nodeSkuOf(n),
      pressure,
      cpuPct: cpuP, memPct: memP,
      cpuText: u.cpuMilli != null ? `${fmtCpu(u.cpuMilli)} / ${fmtCpu(cpuAlloc)}` : null,
      memText: u.memBytes != null ? `${fmtBytes(u.memBytes)} / ${fmtBytes(memAlloc)}` : null,
      topConsumers: consumers.items,
      workloadMemText: consumers.workloadText,
    };
  });

  // ---- per-container limits (from pod specs) ----
  const limitOf = new Map(); // ns/pod/container -> { memLimit, cpuLimit }
  const statusOf = new Map(); // ns/pod/container -> container status
  for (const p of podsData.items || []) {
    const ns = p.metadata.namespace; const pod = p.metadata.name;
    for (const c of (p.spec && p.spec.containers) || []) {
      const lim = (c.resources && c.resources.limits) || {};
      limitOf.set(`${ns}/${pod}/${c.name}`, {
        memLimit: parseMemToBytes(lim.memory), cpuLimit: parseCpuToMilli(lim.cpu),
      });
    }
    for (const cs of (p.status && p.status.containerStatuses) || []) {
      statusOf.set(`${ns}/${pod}/${cs.name}`, cs);
    }
  }

  // ---- container usage (top) joined with limits -> leak / pressure signals ----
  const containers = parseContainerTop(podTop, allNs).map((row) => {
    const ns = row.namespace || defaultNs;
    const key = `${ns}/${row.pod}/${row.container}`;
    const lim = limitOf.get(key) || {};
    const memPctOfLimit = lim.memLimit ? Math.round((row.memBytes / lim.memLimit) * 100) : null;
    const cs = statusOf.get(key) || {};
    return {
      namespace: ns, pod: row.pod, container: row.container,
      cpuMilli: row.cpuMilli, memBytes: row.memBytes,
      memText: fmtBytes(row.memBytes), cpuText: fmtCpu(row.cpuMilli),
      memLimit: lim.memLimit || null, memLimitText: lim.memLimit ? fmtBytes(lim.memLimit) : null,
      memPctOfLimit, restarts: cs.restartCount || 0,
      hasLimit: !!lim.memLimit,
    };
  });

  for (const c of containers) {
    if (c.memPctOfLimit != null && c.memPctOfLimit >= 90) {
      const leaky = c.restarts >= 3;
      add(issue(leaky ? 'critical' : 'high', leaky ? 'MemoryLeakSuspect' : 'MemoryNearLimit',
        `${c.pod}/${c.container} at ${c.memPctOfLimit}% of memory limit`,
        `Using ${c.memText} of a ${c.memLimitText} limit${leaky ? `, with ${c.restarts} restarts (classic leak → OOMKill → restart cycle)` : ''}.`,
        leaky
          ? 'Likely a memory leak. Capture a heap dump before the next restart, review recent code/deps, and raise the limit as a stop-gap.'
          : 'Raise the memory limit/request, or profile the workload to reduce footprint before it gets OOMKilled.',
        { namespace: c.namespace, pod: c.pod, container: c.container }));
    } else if (!c.hasLimit && c.memBytes > 512 * 1024 * 1024) {
      add(issue('medium', 'NoMemoryLimit',
        `${c.pod}/${c.container} has no memory limit (${c.memText})`,
        'A container without a memory limit can consume all node memory and trigger node-wide OOM.',
        'Set resources.limits.memory so the kubelet can cap and OOMKill just this container instead of the node.',
        { namespace: c.namespace, pod: c.pod, container: c.container }));
    }
  }

  // ---- crash / OOM analysis from container statuses ----
  const oomSeen = new Set();
  for (const p of podsData.items || []) {
    const ns = p.metadata.namespace; const pod = p.metadata.name;
    const ref = `${ns}/${pod}`;
    for (const cs of (p.status && p.status.containerStatuses) || []) {
      const waiting = cs.state && cs.state.waiting;
      const lastTerm = cs.lastState && cs.lastState.terminated;
      const term = cs.state && cs.state.terminated;
      const oom = (lastTerm && lastTerm.reason === 'OOMKilled') || (term && term.reason === 'OOMKilled');
      if (oom && !oomSeen.has(`${ref}/${cs.name}`)) {
        oomSeen.add(`${ref}/${cs.name}`);
        const leaky = (cs.restartCount || 0) >= 3;
        add(issue('critical', leaky ? 'MemoryLeakSuspect' : 'OOMKilled',
          `${pod}/${cs.name} was OOMKilled${leaky ? ' repeatedly' : ''}`,
          `Container exceeded its memory limit and was killed by the kernel (restarts=${cs.restartCount || 0}).`,
          leaky
            ? 'Repeated OOM kills strongly suggest a memory leak. Profile the heap, fix the leak, and/or raise the limit.'
            : 'Increase the memory limit, or reduce usage. Confirm the limit matches the real working set.',
          { namespace: ns, pod, container: cs.name, previousLogs: true }));
      }
      if (waiting && waiting.reason === 'CrashLoopBackOff') {
        add(issue('critical', 'CrashLoopBackOff',
          `${pod}/${cs.name} is crash-looping`,
          `Restarted ${cs.restartCount || 0}× — the container keeps exiting shortly after start.`,
          'Read the previous-instance logs to find the startup error, fix config/dependency, then redeploy.',
          { namespace: ns, pod, container: cs.name, previousLogs: true }));
      } else if (waiting && (waiting.reason === 'ImagePullBackOff' || waiting.reason === 'ErrImagePull')) {
        add(issue('high', 'ImagePullBackOff',
          `${pod}/${cs.name} cannot pull its image`,
          `${waiting.reason}: ${(waiting.message || '').slice(0, 160)}`,
          'Verify the image name/tag exists and imagePullSecrets are correct.',
          { namespace: ns, pod, container: cs.name }));
      } else if ((cs.restartCount || 0) >= 5 && !oom) {
        add(issue('high', 'FrequentRestarts',
          `${pod}/${cs.name} restarting frequently`,
          `${cs.restartCount} restarts — the container is unstable.`,
          'Inspect logs and the liveness-probe settings; the probe may be killing a slow-but-healthy app.',
          { namespace: ns, pod, container: cs.name, previousLogs: true }));
      }
    }
  }

  // ---- corroborate with events (OOMKilling / evictions) ----
  for (const e of eventsData.items || []) {
    if (e.type !== 'Warning') continue;
    if (e.reason === 'Evicted' || (e.reason === 'Failed' && /evict/i.test(e.message || ''))) {
      add(issue('high', 'PodEvicted',
        `Pod evicted: ${e.involvedObject && e.involvedObject.name}`,
        (e.message || '').slice(0, 200),
        'Eviction is usually node memory/disk pressure — lower requests, add capacity, or set proper limits.',
        { namespace: e.metadata.namespace, pod: e.involvedObject && e.involvedObject.name }));
    }
  }

  // ---- rank, dedupe, score ----
  const ranked = dedupeIssues(issues);
  let score = 100;
  for (const i of ranked) score -= WEIGHT[i.severity] || 0;
  score = Math.max(0, score);

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of ranked) counts[i.severity] = (counts[i.severity] || 0) + 1;

  const topMemory = containers.slice().sort((a, b) => b.memBytes - a.memBytes).slice(0, 8);
  const topCpu = containers.slice().sort((a, b) => b.cpuMilli - a.cpuMilli).slice(0, 8);

  return {
    metricsAvailable: !!(nodeTop || podTop),
    generatedAt: new Date().toISOString(),
    score,
    grade: score >= 90 ? 'Healthy' : score >= 70 ? 'Degraded' : score >= 40 ? 'At risk' : 'Critical',
    counts,
    cluster: {
      cpuPct: pct(cpuUsedMilli, cpuAllocMilli),
      memPct: pct(memUsedBytes, memAllocBytes),
      cpuText: `${fmtCpu(cpuUsedMilli)} / ${fmtCpu(cpuAllocMilli)}`,
      memText: `${fmtBytes(memUsedBytes)} / ${fmtBytes(memAllocBytes)}`,
    },
    nodes,
    topMemory,
    topCpu,
    issues: ranked,
    summary: buildSummary(ranked, counts),
  };
}

function issue(severity, code, title, detail, fix, target = {}) {
  return { severity, code, title, detail, fix, ...target };
}

const SEV = { critical: 3, high: 2, medium: 1, low: 0 };
function dedupeIssues(list) {
  const seen = new Set();
  const out = [];
  for (const i of list) {
    const k = `${i.code}|${i.namespace || ''}|${i.pod || ''}|${i.container || ''}|${i.node || ''}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(i);
  }
  return out.sort((a, b) => SEV[b.severity] - SEV[a.severity]);
}

function buildSummary(issues, counts) {
  if (!issues.length) return 'No memory, CPU, crash, or OOM problems detected in the current scope.';
  const parts = [];
  if (counts.critical) parts.push(`${counts.critical} critical`);
  if (counts.high) parts.push(`${counts.high} high`);
  if (counts.medium) parts.push(`${counts.medium} medium`);
  const leak = issues.some((i) => i.code === 'MemoryLeakSuspect');
  const crash = issues.some((i) => i.code === 'CrashLoopBackOff');
  const lead = leak && crash ? 'Memory-leak and crash-loop patterns detected'
    : leak ? 'Likely memory leak detected'
      : crash ? 'Crash-loop detected'
        : 'Resource/health issues detected';
  return `${lead}: ${parts.join(', ')} issue(s). Start with the highest-severity item below.`;
}

module.exports = {
  analyzeClusterHealth, parseCpuToMilli, parseMemToBytes, fmtBytes, fmtCpu,
  parseNodeTop, parseContainerTop,
};

