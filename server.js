#!/usr/bin/env node
/*
 * k8s-local-dashboard
 * ---------------------
 * Offline, team-grade web dashboard for Kubernetes clusters.
 *
 *  - Zero npm dependencies (Node stdlib only).
 *  - No internet required. Talks to clusters through the `kubectl` binary on
 *    your PATH, using whatever kubeconfig/context you select in the UI.
 *  - Non-destructive context switching: we pass `--context` per call and never
 *    mutate your kubeconfig file.
 *  - Mutating actions are gated by READ_ONLY mode and written to audit.log.
 *
 * All kubectl invocations use execFile/spawn with an argv array (never a shell
 * string), so values from the UI cannot inject shell commands on the host.
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const url = require('url');
const readline = require('readline');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '7575', 10);
const KUBECTL = process.env.KUBECTL_PATH || 'kubectl';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const AUDIT_FILE = path.join(__dirname, 'audit.log');
const READ_ONLY = /^(1|true|yes)$/i.test(process.env.READ_ONLY || '');

const MAX_BUFFER = 64 * 1024 * 1024; // 64 MB
const KUBECTL_TIMEOUT = 30000; // 30s
const MAX_STREAM_PODS = 60; // safety cap for multi-pod follow

// --- AI investigation layer (zero external deps) ----------------------------
const { createAIProvider } = require('./lib/ai');
const { buildToolRegistry } = require('./lib/tools');
const agent = require('./lib/agent');
const db = require('./lib/db');

// Assigned at startup by buildAgentStack().
let toolRegistry = null;
let aiProvider = null;
let dbStatus = { mode: 'json' };


// --- settings ---------------------------------------------------------------

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (_) {
    return { kubeconfig: '', context: '', namespace: '_all' };
  }
}
function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

// Global kubectl flags derived from current settings.
function globalArgs() {
  const s = loadSettings();
  const args = [];
  if (s.kubeconfig) args.push('--kubeconfig', s.kubeconfig);
  if (s.context) args.push('--context', s.context);
  return args;
}

// Discover candidate kubeconfig files (default + KUBECONFIG env + ~/.kube/*).
function discoverKubeconfigs() {
  const found = new Set();
  const def = path.join(os.homedir(), '.kube', 'config');
  if (fs.existsSync(def)) found.add(def);
  if (process.env.KUBECONFIG) {
    for (const p of process.env.KUBECONFIG.split(path.delimiter)) {
      if (p && fs.existsSync(p)) found.add(p);
    }
  }
  const kubeDir = path.join(os.homedir(), '.kube');
  try {
    for (const f of fs.readdirSync(kubeDir)) {
      const full = path.join(kubeDir, f);
      if (!fs.statSync(full).isFile()) continue;
      // Heuristic: yaml/config-like files only.
      if (/config|\.ya?ml$|kubeconfig/i.test(f)) found.add(full);
    }
  } catch (_) { /* ignore */ }
  return [...found];
}

// --- kubectl runners --------------------------------------------------------

function kubectl(args, { timeout } = {}) {
  const full = [...globalArgs(), ...args];
  return new Promise((resolve, reject) => {
    execFile(
      KUBECTL, full,
      { maxBuffer: MAX_BUFFER, timeout: timeout || KUBECTL_TIMEOUT, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error((stderr || err.message || '').trim());
          e.code = err.code; e.stderr = stderr; e.stdout = stdout;
          return reject(e);
        }
        resolve(stdout);
      }
    );
  });
}
async function kubectlJSON(args) { return JSON.parse(await kubectl(args)); }

// kubectl that ignores global context (used when probing a specific kubeconfig)
function kubectlRaw(args, extraGlobal = [], { timeout } = {}) {
  const full = [...extraGlobal, ...args];
  return new Promise((resolve, reject) => {
    execFile(KUBECTL, full,
      { maxBuffer: MAX_BUFFER, timeout: timeout || KUBECTL_TIMEOUT, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) { const e = new Error((stderr || err.message).trim()); e.stderr = stderr; return reject(e); }
        resolve(stdout);
      });
  });
}

// --- helpers ----------------------------------------------------------------

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendError(res, err, status = 500) {
  sendJSON(res, status, { error: err.message || String(err), stderr: err.stderr });
}

const NAME_RE = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/i;
function validName(v) { return typeof v === 'string' && v.length > 0 && v.length <= 253 && NAME_RE.test(v); }
// Label selectors like app=foo,tier in (a,b). Allow a conservative charset.
const SELECTOR_RE = /^[a-zA-Z0-9_.,()!= /-]*$/;
function validSelector(v) { return typeof v === 'string' && v.length <= 512 && SELECTOR_RE.test(v); }

function nsArgs(ns) { return (!ns || ns === '_all') ? ['--all-namespaces'] : ['-n', ns]; }

function age(creationTimestamp) {
  if (!creationTimestamp) return '';
  let s = Math.max(0, Math.floor((Date.now() - new Date(creationTimestamp).getTime()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }
function forbidden(msg) { const e = new Error(msg); e.status = 403; return e; }

function ensureWritable() {
  if (READ_ONLY) throw forbidden('Dashboard is in READ_ONLY mode; mutating actions are disabled.');
}
function audit(action, detail) {
  const line = `${new Date().toISOString()}\t${action}\t${JSON.stringify(detail)}\n`;
  fs.appendFile(AUDIT_FILE, line, () => {});
}

function compileRegex(src) {
  if (!src) return null;
  try { return new RegExp(src, 'i'); }
  catch (_) { throw badRequest('invalid regex: ' + src); }
}

// Resolve pods matching a filter (namespace + optional label selector + name regex).
async function resolvePods({ ns, selector, regex }) {
  if (selector && !validSelector(selector)) throw badRequest('invalid label selector');
  const re = compileRegex(regex);
  const args = ['get', 'pods', ...nsArgs(ns), '-o', 'json'];
  if (selector) args.push('-l', selector);
  const data = await kubectlJSON(args);
  return data.items
    .filter((p) => !re || re.test(p.metadata.name))
    .map((p) => ({
      namespace: p.metadata.namespace,
      name: p.metadata.name,
      containers: ((p.spec && p.spec.containers) || []).map((c) => c.name),
      phase: p.status && p.status.phase,
    }));
}

// --- API handlers -----------------------------------------------------------

const api = {
  async health() {
    const g = globalArgs();
    const ctx = (await kubectl(['config', 'current-context'])).trim();
    let server = '';
    try {
      server = (await kubectl(['config', 'view', '--minify', '-o',
        'jsonpath={.clusters[0].cluster.server}'])).trim();
    } catch (_) { /* ignore */ }
    return { ok: true, context: ctx, server, readOnly: READ_ONLY };
  },


  // Current config + everything the UI needs to switch kubeconfig/context.
  async config() {
    const s = loadSettings();
    const kubeconfigs = discoverKubeconfigs();
    let contexts = [];
    let current = '';
    try {
      const out = await kubectl(['config', 'get-contexts', '-o', 'name']);
      contexts = out.split('\n').map((x) => x.trim()).filter(Boolean);
    } catch (_) { /* ignore */ }
    try { current = (await kubectl(['config', 'current-context'])).trim(); } catch (_) {}
    return {
      kubeconfig: s.kubeconfig || '',
      defaultKubeconfig: path.join(os.homedir(), '.kube', 'config'),
      kubeconfigs,
      context: s.context || current,
      contexts,
      readOnly: READ_ONLY,
    };
  },

  // Switch kubeconfig and/or context (non-destructive: stored in our settings).
  async setConfig(q, body) {
    const s = loadSettings();
    if (typeof body.kubeconfig === 'string') {
      const kc = body.kubeconfig.trim();
      if (kc && !fs.existsSync(kc)) throw badRequest('kubeconfig file not found: ' + kc);
      s.kubeconfig = kc;
      // Changing kubeconfig invalidates the previously selected context.
      if (body.context === undefined) s.context = '';
    }
    if (typeof body.context === 'string') s.context = body.context.trim();
    if (typeof body.namespace === 'string') s.namespace = body.namespace.trim() || '_all';
    saveSettings(s);
    // Probe the new selection.
    const extra = [];
    if (s.kubeconfig) extra.push('--kubeconfig', s.kubeconfig);
    if (s.context) extra.push('--context', s.context);
    let ctx = '', server = '', error = '';
    try {
      ctx = (await kubectlRaw(['config', 'current-context'], extra)).trim();
      server = (await kubectlRaw(['config', 'view', '--minify', '-o',
        'jsonpath={.clusters[0].cluster.server}'], extra)).trim();
    } catch (e) { error = e.message; }
    audit('setConfig', { kubeconfig: s.kubeconfig, context: s.context });
    return { ok: !error, settings: s, context: ctx, server, error };
  },

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

  async logs(q) {
    if (!validName(q.ns)) throw badRequest('valid namespace required');
    if (!validName(q.pod)) throw badRequest('valid pod name required');
    const args = ['logs', q.pod, '-n', q.ns];
    if (q.container && validName(q.container)) args.push('-c', q.container);
    const tail = Math.min(parseInt(q.tail || '500', 10) || 500, 10000);
    args.push(`--tail=${tail}`);
    if (q.previous === 'true') args.push('--previous');
    let out;
    try { out = await kubectl(args, { timeout: 60000 }); }
    catch (e) { return { lines: [], error: e.message }; }
    let lines = out.split('\n');
    if (q.search) { const n = q.search.toLowerCase(); lines = lines.filter((l) => l.toLowerCase().includes(n)); }
    const max = 5000; const truncated = lines.length > max;
    return { lines: truncated ? lines.slice(-max) : lines, truncated };
  },

  // Snapshot of merged logs across all pods matching a filter.
  async aggregateLogs(q) {
    const pods = await resolvePods({ ns: q.ns, selector: q.selector, regex: q.regex });
    if (!pods.length) return { pods: [], lines: [] };
    const limited = pods.slice(0, MAX_STREAM_PODS);
    const tail = Math.min(parseInt(q.tail || '200', 10) || 200, 5000);
    const needle = (q.search || '').toLowerCase();
    const results = await Promise.all(limited.map(async (p) => {
      const a = ['logs', p.name, '-n', p.namespace, `--tail=${tail}`, '--all-containers', '--timestamps'];
      try {
        const out = await kubectl(a, { timeout: 60000 });
        return out.split('\n').filter(Boolean).map((line) => ({ pod: p.name, ns: p.namespace, line }));
      } catch (_) { return []; }
    }));
    let lines = [].concat(...results);
    // Sort by leading RFC3339 timestamp when present so streams interleave sanely.
    lines.sort((a, b) => a.line.slice(0, 30) < b.line.slice(0, 30) ? -1 : 1);
    if (needle) lines = lines.filter((l) => l.line.toLowerCase().includes(needle));
    const max = 8000; const truncated = lines.length > max;
    return {
      pods: pods.map((p) => `${p.namespace}/${p.name}`),
      podCount: pods.length,
      capped: pods.length > MAX_STREAM_PODS,
      lines: truncated ? lines.slice(-max) : lines,
      truncated,
    };
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
    return { text: await kubectl(['get', type, q.name, '-n', q.ns, '-o', 'yaml']) };
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

  async secrets(q) {
    const data = await kubectlJSON(['get', 'secrets', ...nsArgs(q.ns), '-o', 'json']);
    return { items: data.items.map((s) => ({
      namespace: s.metadata.namespace, name: s.metadata.name, type: s.type,
      keys: Object.keys(s.data || {}), age: age(s.metadata.creationTimestamp),
    })) };
  },

  async secret(q) {
    if (!validName(q.ns)) throw badRequest('valid namespace required');
    if (!validName(q.name)) throw badRequest('valid name required');
    const data = await kubectlJSON(['get', 'secret', q.name, '-n', q.ns, '-o', 'json']);
    const decoded = {};
    for (const [k, v] of Object.entries(data.data || {})) {
      try { decoded[k] = Buffer.from(v, 'base64').toString('utf8'); }
      catch (_) { decoded[k] = '<binary>'; }
    }
    audit('viewSecret', { ns: q.ns, name: q.name });
    return { name: q.name, namespace: q.ns, type: data.type, data: decoded };
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

  // --- mutating actions ---

  async exec(q, body) {
    ensureWritable();
    if (!validName(body.ns)) throw badRequest('valid namespace required');
    if (!validName(body.pod)) throw badRequest('valid pod name required');
    const cmd = body.command;
    if (typeof cmd !== 'string' || !cmd.trim()) throw badRequest('command required');
    const args = ['exec', body.pod, '-n', body.ns];
    if (body.container && validName(body.container)) args.push('-c', body.container);
    args.push('--', '/bin/sh', '-c', cmd);
    audit('exec', { ns: body.ns, pod: body.pod, command: cmd });
    try { return { output: await kubectl(args, { timeout: 60000 }) }; }
    catch (e) { return { output: e.stdout || '', error: e.message }; }
  },

  async restart(q, body) {
    ensureWritable();
    if (!validName(body.ns)) throw badRequest('valid namespace required');
    if (!validName(body.name)) throw badRequest('valid deployment name required');
    const kind = (body.kind && validName(body.kind)) ? body.kind.toLowerCase() : 'deployment';
    audit('restart', { ns: body.ns, kind, name: body.name });
    return { output: (await kubectl(['rollout', 'restart', kind, body.name, '-n', body.ns])).trim() };
  },

  async scale(q, body) {
    ensureWritable();
    if (!validName(body.ns)) throw badRequest('valid namespace required');
    if (!validName(body.name)) throw badRequest('valid name required');
    const replicas = parseInt(body.replicas, 10);
    if (!Number.isInteger(replicas) || replicas < 0 || replicas > 1000) throw badRequest('replicas must be 0-1000');
    const kind = (body.kind && validName(body.kind)) ? body.kind.toLowerCase() : 'deployment';
    audit('scale', { ns: body.ns, kind, name: body.name, replicas });
    return { output: (await kubectl(['scale', kind, body.name, '-n', body.ns, `--replicas=${replicas}`])).trim() };
  },

  async deletePod(q, body) {
    ensureWritable();
    if (!validName(body.ns)) throw badRequest('valid namespace required');
    if (!validName(body.pod)) throw badRequest('valid pod name required');
    audit('deletePod', { ns: body.ns, pod: body.pod });
    return { output: (await kubectl(['delete', 'pod', body.pod, '-n', body.ns])).trim() };
  },

  // Apply an arbitrary YAML manifest (edit-in-place for a single resource).
  // Streams the YAML to `kubectl apply -f -` via stdin so nothing else is touched.
  async applyManifest(q, body) {
    ensureWritable();
    const yaml = body && body.yaml;
    if (typeof yaml !== 'string' || !yaml.trim()) throw badRequest('yaml required');
    if (yaml.length > 2 * 1024 * 1024) throw badRequest('yaml too large (>2MB)');
    audit('applyManifest', { bytes: yaml.length });
    return await new Promise((resolve, reject) => {
      const args = [...globalArgs(), 'apply', '-f', '-'];
      const child = spawn(KUBECTL, args, { windowsHide: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          const e = new Error((stderr || `kubectl apply exited ${code}`).trim());
          e.status = 400; return reject(e);
        }
        resolve({ output: (stdout + stderr).trim() });
      });
      child.stdin.end(yaml);
    });
  },

  // Bulk rollout-restart deployments/statefulsets/daemonsets matching a filter.
  async bulkRestart(q, body) {
    const kinds = Array.isArray(body.kinds) && body.kinds.length
      ? body.kinds.filter((k) => ['deployment', 'statefulset', 'daemonset'].includes(k))
      : ['deployment'];
    const re = compileRegex(body.regex);
    if (body.selector && !validSelector(body.selector)) throw badRequest('invalid label selector');
    if (!re && !body.selector) throw badRequest('provide a name regex or a label selector');

    const matched = [];
    for (const kind of kinds) {
      const args = ['get', kind, ...nsArgs(body.ns), '-o', 'json'];
      if (body.selector) args.push('-l', body.selector);
      let data;
      try { data = await kubectlJSON(args); } catch (_) { continue; }
      for (const item of data.items) {
        if (re && !re.test(item.metadata.name)) continue;
        matched.push({ kind, namespace: item.metadata.namespace, name: item.metadata.name });
      }
    }
    if (body.dryRun) return { dryRun: true, matched };

    ensureWritable();
    audit('bulkRestart', { ns: body.ns, regex: body.regex, selector: body.selector, kinds, count: matched.length });
    const restarted = [];
    for (const m of matched) {
      try {
        await kubectl(['rollout', 'restart', m.kind, m.name, '-n', m.namespace]);
        restarted.push({ ...m, ok: true });
      } catch (e) { restarted.push({ ...m, ok: false, error: e.message }); }
    }
    return { dryRun: false, matched, restarted };
  },

  // Bulk delete pods matching a filter (controllers recreate them = a "restart").
  async bulkDeletePods(q, body) {
    const pods = await resolvePods({ ns: body.ns, selector: body.selector, regex: body.regex });
    if (!body.regex && !body.selector) throw badRequest('provide a name regex or a label selector');
    if (body.dryRun) return { dryRun: true, matched: pods.map((p) => ({ namespace: p.namespace, name: p.name })) };

    ensureWritable();
    audit('bulkDeletePods', { ns: body.ns, regex: body.regex, selector: body.selector, count: pods.length });
    const deleted = [];
    for (const p of pods) {
      try { await kubectl(['delete', 'pod', p.name, '-n', p.namespace]); deleted.push({ namespace: p.namespace, name: p.name, ok: true }); }
      catch (e) { deleted.push({ namespace: p.namespace, name: p.name, ok: false, error: e.message }); }
    }
    return { dryRun: false, deleted };
  },
};

// --- AI agent stack setup ---------------------------------------------------

// Build the tool registry over the existing kubectl helpers, pick an AI
// provider from env, and initialise the metadata store.
async function buildAgentStack() {
  toolRegistry = buildToolRegistry({
    kubectl, kubectlJSON, nsArgs, validName, age, ensureWritable, audit,
  });
  aiProvider = createAIProvider(process.env);
  try { dbStatus = await db.init(); } catch (e) { dbStatus = { mode: 'json', warning: e.message }; }
  return { ai: aiProvider ? { name: aiProvider.name, model: aiProvider.model } : null, db: dbStatus };
}

// Report AI/agent capability + storage status to the UI.
api.aiStatus = async function aiStatus() {
  return {
    enabled: true,
    aiProvider: aiProvider ? aiProvider.name : null,
    aiModel: aiProvider ? aiProvider.model : null,
    aiConfigured: !!aiProvider,
    mode: aiProvider ? 'agent' : 'heuristic',
    storage: dbStatus,
    readOnly: READ_ONLY,
    tools: toolRegistry ? toolRegistry.list().map((t) => ({ name: t.name, mutating: !!t.mutating })) : [],
  };
};

// List recent investigations (metadata only).
api.investigations = async function investigations() {
  return { items: await db.listInvestigations(50) };
};

// Fetch one investigation by id.
api.investigation = async function investigation(q) {
  if (!q.id) throw badRequest('id required');
  const row = await db.getInvestigation(q.id);
  if (!row) { const e = new Error('investigation not found'); e.status = 404; throw e; }
  return row;
};


// --- live aggregated log streaming (SSE) ------------------------------------

async function streamLogs(req, res, query) {
  let pods;
  try {
    pods = await resolvePods({ ns: query.ns, selector: query.selector, regex: query.regex });
  } catch (e) { sendError(res, e, e.status || 500); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (event, data) => { res.write(`event: ${event}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`); };

  if (!pods.length) { send('meta', { pods: [], message: 'no pods matched' }); send('eof', {}); return; }
  const limited = pods.slice(0, MAX_STREAM_PODS);
  send('meta', { podCount: pods.length, streaming: limited.length, capped: pods.length > MAX_STREAM_PODS, pods: limited.map((p) => `${p.namespace}/${p.name}`) });

  const tail = Math.min(parseInt(query.tail || '50', 10) || 50, 2000);
  const needle = (query.search || '').toLowerCase();
  const children = [];

  for (const p of limited) {
    const args = [...globalArgs(), 'logs', '-f', p.name, '-n', p.namespace, `--tail=${tail}`, '--all-containers', '--timestamps'];
    const child = spawn(KUBECTL, args, { windowsHide: true });
    children.push(child);
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (needle && !line.toLowerCase().includes(needle)) return;
      send('log', { pod: p.name, ns: p.namespace, line });
    });
    child.stderr.on('data', (d) => send('warn', { pod: p.name, line: String(d).trim() }));
    child.on('close', () => send('podclose', { pod: p.name }));
  }

  // Heartbeat keeps the connection alive through proxies/idle.
  const hb = setInterval(() => res.write(': hb\n\n'), 15000);
  const cleanup = () => {
    clearInterval(hb);
    for (const c of children) { try { c.kill(); } catch (_) {} }
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
}

// --- AI investigation streaming (SSE) ---------------------------------------

// Runs the agent for a natural-language question, streaming each step to the
// browser, then emits the final report and persists its metadata.
async function streamInvestigate(req, res, query) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (event, data) => { res.write(`event: ${event}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`); };

  const question = (query.question || query.q || '').toString();
  if (!question.trim()) { send('error', { error: 'question required' }); send('eof', {}); return res.end(); }

  let closed = false;
  req.on('close', () => { closed = true; });
  const hb = setInterval(() => { if (!closed) res.write(': hb\n\n'); }, 15000);

  send('meta', {
    question,
    provider: aiProvider ? aiProvider.name : 'heuristic',
    model: aiProvider ? aiProvider.model : null,
    readOnly: READ_ONLY,
  });

  try {
    const report = await agent.runInvestigation({
      question,
      namespace: query.ns && query.ns !== '_all' ? query.ns : null,
      registry: toolRegistry,
      ai: aiProvider,
      maxSteps: parseInt(query.maxSteps, 10) || 8,
      allowMutations: false, // investigations never mutate the cluster
      onStep: (step) => { if (!closed) send('step', step); },
    });

    let saved = report;
    try {
      saved = await db.saveInvestigation({ question, ...report });
      report.id = saved.id; report.created_at = saved.created_at;
    } catch (e) { send('warn', { message: 'could not persist investigation: ' + e.message }); }

    send('report', report);
  } catch (e) {
    send('error', { error: e.message });
  } finally {
    clearInterval(hb);
    send('eof', {});
    res.end();
  }
}

// --- static file serving ----------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; if (chunks.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(chunks ? JSON.parse(chunks) : {}); } catch (_) { resolve({}); } });
  });
}

// --- server -----------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const name = pathname.slice('/api/'.length);
  if (name === 'streamLogs') return streamLogs(req, res, parsed.query);
  if (name === 'investigate') return streamInvestigate(req, res, parsed.query);

  const handler = api[name];
  if (!handler) return sendJSON(res, 404, { error: `unknown endpoint: ${name}` });
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    sendJSON(res, 200, await handler(parsed.query, body));
  } catch (err) {
    sendError(res, err, err.status || 500);
  }
});

server.listen(PORT, HOST, () => {
  /* eslint-disable no-console */
  console.log('');
  console.log('  k8s-local-dashboard');
  console.log('  -------------------');
  console.log(`  Serving on http://${HOST}:${PORT}`);
  console.log(`  kubectl:   ${KUBECTL}`);
  console.log(`  read-only: ${READ_ONLY}`);
  const s = loadSettings();
  console.log(`  kubeconfig: ${s.kubeconfig || '(default)'}`);
  console.log(`  context:    ${s.context || '(current)'}`);
  buildAgentStack().then((info) => {
    console.log(`  ai:         ${info.ai ? info.ai.name + ' (' + info.ai.model + ')' : 'heuristic-only (set OPENAI_API_KEY for the agent)'}`);
    console.log(`  storage:    ${info.db.mode}${info.db.warning ? ' — ' + info.db.warning : ''}`);
    console.log('  (Ctrl+C to stop)');
    console.log('');
  });
});
