'use strict';
/*
 * Logs: single-pod, aggregated snapshot across matching pods, and the live
 * multi-pod SSE tail.
 */

const { spawn } = require('child_process');
const readline = require('readline');
const { KUBECTL, MAX_STREAM_PODS } = require('../config');
const { kubectl } = require('../infra/kubectl');
const { globalArgs } = require('../settings');
const { validName, badRequest } = require('../util');
const { resolvePods } = require('../domain/pods');
const { sendError, startSSE } = require('../http/respond');

const api = {
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
};

// Live aggregated log streaming (SSE).
async function streamLogs(req, res, query) {
  let pods;
  try {
    pods = await resolvePods({ ns: query.ns, selector: query.selector, regex: query.regex });
  } catch (e) { sendError(res, e, e.status || 500); return; }

  const send = startSSE(res);

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

module.exports = { api, sse: { streamLogs } };
