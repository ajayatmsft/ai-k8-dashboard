'use strict';
/*
 * Mutating operations. Every handler passes through ensureWritable (READ_ONLY
 * gate) and writes an audit entry before touching the cluster. Bulk operations
 * support dry-run previews.
 */

const { spawn } = require('child_process');
const { KUBECTL, EXEC_ENABLED } = require('../config');
const { kubectl, kubectlJSON } = require('../infra/kubectl');
const { audit, ensureWritable } = require('../infra/audit');
const { confirmToken } = require('../infra/confirm');
const { globalArgs } = require('../settings');
const { validName, validSelector, nsArgs, badRequest, forbidden, compileRegex } = require('../util');
const { resolvePods } = require('../domain/pods');

// The execute leg of a bulk op must present the token from its own dry-run;
// a changed matched set (different count) invalidates the preview.
function requireConfirm(body, payload) {
  const expected = confirmToken(payload);
  if (body.confirmToken === expected) return;
  const e = new Error('preview required: run a dry-run first (if you did, the matched set changed since your preview — preview again)');
  e.status = 409;
  throw e;
}

const api = {
  async exec(q, body) {
    ensureWritable();
    if (!EXEC_ENABLED) throw forbidden('Debug shell is disabled on this instance (EXEC_ENABLED=0).');
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
    const tokenPayload = { op: 'bulkRestart', ns: body.ns || '_all', regex: body.regex || '', selector: body.selector || '', kinds, count: matched.length };
    if (body.dryRun) return { dryRun: true, matched, confirmToken: confirmToken(tokenPayload) };

    ensureWritable();
    requireConfirm(body, tokenPayload);
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
    const tokenPayload = { op: 'bulkDeletePods', ns: body.ns || '_all', regex: body.regex || '', selector: body.selector || '', count: pods.length };
    if (body.dryRun) return { dryRun: true, matched: pods.map((p) => ({ namespace: p.namespace, name: p.name })), confirmToken: confirmToken(tokenPayload) };

    ensureWritable();
    requireConfirm(body, tokenPayload);
    audit('bulkDeletePods', { ns: body.ns, regex: body.regex, selector: body.selector, count: pods.length });
    const deleted = [];
    for (const p of pods) {
      try { await kubectl(['delete', 'pod', p.name, '-n', p.namespace]); deleted.push({ namespace: p.namespace, name: p.name, ok: true }); }
      catch (e) { deleted.push({ namespace: p.namespace, name: p.name, ok: false, error: e.message }); }
    }
    return { dryRun: false, deleted };
  },
};

module.exports = { api };
