'use strict';
/*
 * Read-only cluster browsing: namespaces, overview, health, node pools,
 * workloads, events, describe/YAML, and `kubectl top` passthrough.
 */

const { READ_ONLY } = require('../config');
const { kubectl, kubectlJSON } = require('../infra/kubectl');
const { nsArgs, age, validName, badRequest, forbidden } = require('../util');
const { gatherClusterHealth } = require('../domain/clusterHealth');
const { listNodePools, listNodeScheduling } = require('../domain/nodes');

const api = {
  async namespaces() {
    const data = await kubectlJSON(['get', 'namespaces', '-o', 'json']);
    return { namespaces: data.items.map((i) => ({ name: i.metadata.name, status: i.status && i.status.phase, age: age(i.metadata.creationTimestamp) })) };
  },

  async overview(q) {
    const [pods, nodes, podTop] = await Promise.all([
      kubectlJSON(['get', 'pods', ...nsArgs(q.ns), '-o', 'json']),
      kubectlJSON(['get', 'nodes', '-o', 'json']).catch(() => ({ items: [] })),
      kubectl(['top', 'nodes', '--no-headers']).catch(() => null),
    ]);
    const phases = {}; let restarts = 0, cReady = 0, cTotal = 0;
    for (const p of pods.items) {
      const ph = (p.status && p.status.phase) || 'Unknown';
      phases[ph] = (phases[ph] || 0) + 1;
      for (const c of (p.status && p.status.containerStatuses) || []) {
        restarts += c.restartCount || 0; cTotal += 1; if (c.ready) cReady += 1;
      }
    }
    const topByNode = {};
    if (podTop) {
      for (const line of podTop.trim().split('\n')) {
        const cols = line.trim().split(/\s+/);
        if (cols.length >= 5) topByNode[cols[0]] = { cpu: cols[1], cpuPct: cols[2], mem: cols[3], memPct: cols[4] };
      }
    }
    const nodeInfo = nodes.items.map((n) => {
      const ready = ((n.status && n.status.conditions) || []).find((c) => c.type === 'Ready');
      return {
        name: n.metadata.name,
        ready: ready ? ready.status === 'True' : false,
        version: n.status && n.status.nodeInfo && n.status.nodeInfo.kubeletVersion,
        usage: topByNode[n.metadata.name] || null,
      };
    });
    return { totalPods: pods.items.length, phases, restarts, containersReady: cReady, containersTotal: cTotal, nodes: nodeInfo, metrics: !!podTop };
  },

  // Cluster health focused on memory/CPU pressure, memory leaks, and crashes.
  async clusterHealth(q) { return gatherClusterHealth({ ns: q.ns }); },

  // Node pools + SKUs, and which workloads target them via nodeSelector/affinity.
  async nodePools(q) {
    const [poolsData, scheduling] = await Promise.all([
      listNodePools(),
      listNodeScheduling({ ns: q.ns }),
    ]);
    return { ...poolsData, scheduling: scheduling.items };
  },

  async deployments(q) {
    const data = await kubectlJSON(['get', 'deployments', ...nsArgs(q.ns), '-o', 'json']);
    return { items: data.items.map((d) => {
      const s = d.status || {};
      return {
        namespace: d.metadata.namespace, name: d.metadata.name,
        desired: (d.spec && d.spec.replicas) || 0,
        ready: s.readyReplicas || 0, updated: s.updatedReplicas || 0, available: s.availableReplicas || 0,
        age: age(d.metadata.creationTimestamp),
        images: ((d.spec && d.spec.template.spec.containers) || []).map((c) => c.image),
      };
    }) };
  },

  async pods(q) {
    const data = await kubectlJSON(['get', 'pods', ...nsArgs(q.ns), '-o', 'json']);
    return { items: data.items.map((p) => {
      const cs = (p.status && p.status.containerStatuses) || [];
      const ready = cs.filter((c) => c.ready).length;
      const restarts = cs.reduce((a, c) => a + (c.restartCount || 0), 0);
      return {
        namespace: p.metadata.namespace, name: p.metadata.name,
        phase: (p.status && p.status.phase) || 'Unknown',
        ready: `${ready}/${cs.length}`, restarts,
        node: p.spec && p.spec.nodeName, podIP: p.status && p.status.podIP,
        age: age(p.metadata.creationTimestamp),
        containers: ((p.spec && p.spec.containers) || []).map((c) => c.name),
      };
    }) };
  },

  async events(q) {
    const data = await kubectlJSON(['get', 'events', ...nsArgs(q.ns), '-o', 'json']);
    const items = data.items.map((e) => ({
      namespace: e.metadata.namespace, type: e.type, reason: e.reason,
      object: e.involvedObject && `${e.involvedObject.kind}/${e.involvedObject.name}`,
      message: e.message, count: e.count, lastSeen: e.lastTimestamp || e.eventTime,
    })).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
    return { items };
  },

  async describe(q) {
    if (!validName(q.ns)) throw badRequest('valid namespace required');
    if (!validName(q.name)) throw badRequest('valid name required');
    const type = (q.type || 'pod').toLowerCase();
    if (!validName(type)) throw badRequest('invalid type');
    return { text: await kubectl(['describe', type, q.name, '-n', q.ns]) };
  },

  async manifest(q) {
    if (!validName(q.ns)) throw badRequest('valid namespace required');
    if (!validName(q.name)) throw badRequest('valid name required');
    const type = (q.type || 'pod').toLowerCase();
    if (!validName(type)) throw badRequest('invalid type');
    // Secret YAML embeds base64 values — never expose it on read-only instances.
    if (READ_ONLY && /^secrets?$/.test(type)) throw forbidden('secret manifests are hidden in READ_ONLY mode');
    return { text: await kubectl(['get', type, q.name, '-n', q.ns, '-o', 'yaml']) };
  },

  async top(q) {
    const kind = q.kind === 'pods' ? 'pods' : 'nodes';
    const args = ['top', kind, '--no-headers'];
    if (kind === 'pods') args.push(...nsArgs(q.ns));
    let out;
    try { out = await kubectl(args); }
    catch (e) { return { available: false, error: e.message, rows: [] }; }
    const rows = out.trim().split('\n').filter(Boolean).map((l) => l.trim().split(/\s+/));
    return { available: true, kind, rows };
  },
};

module.exports = { api };
