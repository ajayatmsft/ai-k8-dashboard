'use strict';
/*
 * Node pools / SKUs / scheduling. Cloud-agnostic: covers AKS, EKS, GKE and
 * Karpenter labelling conventions.
 */

const { kubectl, kubectlJSON } = require('../infra/kubectl');
const { nsArgs, age } = require('../util');
const { fmtBytes, fmtCpu, parseMemToBytes, parseCpuToMilli } = require('./health');

// Extract cloud-agnostic node-pool metadata from a node's labels.
function nodePoolInfo(node) {
  const l = (node.metadata && node.metadata.labels) || {};
  return {
    pool: l['kubernetes.azure.com/agentpool'] || l['agentpool']
      || l['eks.amazonaws.com/nodegroup'] || l['cloud.google.com/gke-nodepool']
      || l['karpenter.sh/nodepool'] || l['node.kubernetes.io/instancegroup'] || '(unpooled)',
    sku: l['node.kubernetes.io/instance-type'] || l['beta.kubernetes.io/instance-type'] || '',
    os: l['kubernetes.io/os'] || l['beta.kubernetes.io/os'] || '',
    osSku: l['kubernetes.azure.com/os-sku'] || '',
    arch: l['kubernetes.io/arch'] || l['beta.kubernetes.io/arch'] || '',
    region: l['topology.kubernetes.io/region'] || l['failure-domain.beta.kubernetes.io/region'] || '',
    zone: l['topology.kubernetes.io/zone'] || l['failure-domain.beta.kubernetes.io/zone'] || '',
    mode: l['kubernetes.azure.com/mode'] || '', // System / User (AKS)
  };
}

// The labels a developer would actually put in a nodeSelector to target a pool.
function selectableLabels(node) {
  const l = (node.metadata && node.metadata.labels) || {};
  const keys = [
    'kubernetes.azure.com/agentpool', 'agentpool', 'eks.amazonaws.com/nodegroup',
    'cloud.google.com/gke-nodepool', 'karpenter.sh/nodepool',
    'node.kubernetes.io/instance-type', 'kubernetes.io/os', 'kubernetes.io/arch',
    'kubernetes.azure.com/os-sku', 'kubernetes.azure.com/mode',
    'topology.kubernetes.io/region', 'topology.kubernetes.io/zone',
  ];
  const out = {};
  for (const k of keys) if (l[k] != null) out[k] = l[k];
  return out;
}

// List nodes grouped into pools, with SKUs, zones, capacity and taints.
async function listNodePools() {
  const [nodesData, podsData] = await Promise.all([
    kubectlJSON(['get', 'nodes', '-o', 'json']).catch(() => ({ items: [] })),
    kubectlJSON(['get', 'pods', '--all-namespaces', '-o', 'json']).catch(() => ({ items: [] })),
  ]);
  const podsOn = {};
  for (const p of podsData.items || []) { const n = p.spec && p.spec.nodeName; if (n) podsOn[n] = (podsOn[n] || 0) + 1; }

  const nodes = (nodesData.items || []).map((n) => {
    const info = nodePoolInfo(n);
    const cond = ((n.status && n.status.conditions) || []).find((c) => c.type === 'Ready');
    const cap = (n.status && n.status.capacity) || {};
    const alloc = (n.status && n.status.allocatable) || {};
    const taints = ((n.spec && n.spec.taints) || []).map((t) => `${t.key}${t.value ? '=' + t.value : ''}:${t.effect}`);
    return {
      name: n.metadata.name, ...info,
      ready: cond ? cond.status === 'True' : false,
      kubelet: n.status && n.status.nodeInfo && n.status.nodeInfo.kubeletVersion,
      cpu: cap.cpu || '', memory: cap.memory ? fmtBytes(parseMemToBytes(cap.memory)) : '',
      cpuMilli: parseCpuToMilli(cap.cpu), memBytes: parseMemToBytes(cap.memory),
      pods: podsOn[n.metadata.name] || 0, maxPods: alloc.pods || '',
      taints, labels: selectableLabels(n), age: age(n.metadata.creationTimestamp),
    };
  });

  const poolMap = new Map();
  for (const nd of nodes) {
    let pm = poolMap.get(nd.pool);
    if (!pm) { pm = { name: nd.pool, mode: nd.mode, count: 0, ready: 0, skus: new Set(), zones: new Set(), os: new Set(), arch: new Set(), cpuMilli: 0, memBytes: 0 }; poolMap.set(nd.pool, pm); }
    pm.count += 1; if (nd.ready) pm.ready += 1;
    if (nd.sku) pm.skus.add(nd.sku);
    if (nd.zone) pm.zones.add(nd.zone);
    if (nd.os) pm.os.add(nd.osSku || nd.os);
    if (nd.arch) pm.arch.add(nd.arch);
    if (!pm.mode && nd.mode) pm.mode = nd.mode;
    pm.cpuMilli += nd.cpuMilli || 0; pm.memBytes += nd.memBytes || 0;
  }
  const pools = [...poolMap.values()].map((p) => ({
    name: p.name, mode: p.mode || '', count: p.count, ready: p.ready,
    skus: [...p.skus], zones: [...p.zones].sort(), os: [...p.os], arch: [...p.arch],
    totalCpu: fmtCpu(p.cpuMilli), totalMemory: fmtBytes(p.memBytes),
  })).sort((a, b) => a.name.localeCompare(b.name));

  return { pools, nodes };
}

function summarizeNodeAffinity(nodeAffinity) {
  if (!nodeAffinity) return [];
  const out = [];
  const req = nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution;
  for (const term of (req && req.nodeSelectorTerms) || []) {
    for (const m of term.matchExpressions || []) out.push(`${m.key} ${m.operator} [${(m.values || []).join(', ')}]`);
  }
  for (const p of nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution || []) {
    for (const m of (p.preference && p.preference.matchExpressions) || []) out.push(`preferred(w${p.weight}) ${m.key} ${m.operator} [${(m.values || []).join(', ')}]`);
  }
  return out;
}

// Which workloads pin themselves to nodes via nodeSelector / nodeAffinity /
// tolerations — i.e. which pool/SKU each targets.
async function listNodeScheduling({ ns } = {}) {
  const kinds = [['deployments', 'Deployment'], ['statefulsets', 'StatefulSet'], ['daemonsets', 'DaemonSet']];
  const items = [];
  for (const [res, kind] of kinds) {
    let data;
    try { data = await kubectlJSON(['get', res, ...nsArgs(ns), '-o', 'json']); } catch (_) { continue; }
    for (const d of data.items || []) {
      const spec = (d.spec && d.spec.template && d.spec.template.spec) || {};
      const nodeSelector = spec.nodeSelector || {};
      const affinity = summarizeNodeAffinity(spec.affinity && spec.affinity.nodeAffinity);
      const tolerations = (spec.tolerations || []).map((t) => `${t.key || '*'}${t.value ? '=' + t.value : ''}${t.effect ? ':' + t.effect : ''}`);
      if (!Object.keys(nodeSelector).length && !affinity.length && !tolerations.length) continue;
      items.push({ namespace: d.metadata.namespace, name: d.metadata.name, kind, nodeSelector, affinity, tolerations });
    }
  }
  return { items };
}

module.exports = { nodePoolInfo, selectableLabels, listNodePools, listNodeScheduling };
