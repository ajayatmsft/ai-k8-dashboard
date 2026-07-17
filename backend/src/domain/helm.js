'use strict';
/*
 * Helm release discovery. Prefers the `helm` binary (richer: chart,
 * appVersion); falls back to reading helm release Secrets directly with
 * kubectl so it keeps working fully offline / when helm isn't installed.
 */

const zlib = require('zlib');
const { kubectlJSON, helm } = require('../infra/kubectl');
const { nsArgs } = require('../util');

// Helm v3 stores each release as a Secret of type `helm.sh/release.v1`. The
// `release` field is base64(gzip(json)) — and kubectl returns secret values
// base64-encoded again, so we decode twice then gunzip.
function decodeHelmRelease(secretValue) {
  try {
    const once = Buffer.from(secretValue, 'base64');           // -> base64(gzip(json)) text
    const gz = Buffer.from(once.toString('utf8'), 'base64');   // -> gzip bytes
    return JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  } catch (_) { return null; }
}

async function listHelmReleases({ ns } = {}) {
  // 1) Try the helm binary.
  try {
    const args = ['list', '-o', 'json'];
    if (!ns || ns === '_all') args.push('--all-namespaces'); else args.push('-n', ns);
    const out = await helm(args);
    const arr = JSON.parse(out || '[]');
    return {
      source: 'helm',
      items: arr.map((r) => ({
        name: r.name, namespace: r.namespace, revision: parseInt(r.revision, 10) || r.revision,
        status: r.status, chart: r.chart, appVersion: r.app_version, updated: r.updated,
      })),
    };
  } catch (e) {
    // Fall through to the kubectl-based discovery on any helm error.
  }

  // 2) Fallback: read helm release secrets (label owner=helm).
  const args = ['get', 'secrets', ...nsArgs(ns), '-l', 'owner=helm', '-o', 'json'];
  let data;
  try { data = await kubectlJSON(args); }
  catch (e) { return { source: 'none', error: e.message, items: [] }; }

  // Keep only the latest revision per (namespace, release name).
  const latest = new Map();
  for (const s of data.items || []) {
    const labels = (s.metadata && s.metadata.labels) || {};
    if (labels.owner !== 'helm') continue;
    const relName = labels.name;
    const rev = parseInt(labels.version, 10) || 0;
    const key = `${s.metadata.namespace}/${relName}`;
    const prev = latest.get(key);
    if (!prev || rev >= prev._rev) latest.set(key, { secret: s, labels, _rev: rev });
  }

  const items = [...latest.values()].map(({ secret, labels, _rev }) => {
    const rel = decodeHelmRelease((secret.data && secret.data.release) || '');
    const chart = rel && rel.chart && rel.chart.metadata
      ? `${rel.chart.metadata.name}-${rel.chart.metadata.version}` : null;
    return {
      name: labels.name, namespace: secret.metadata.namespace, revision: _rev,
      status: (rel && rel.info && rel.info.status) || labels.status,
      chart, appVersion: rel && rel.chart && rel.chart.metadata && rel.chart.metadata.appVersion,
      updated: (rel && rel.info && rel.info.last_deployed) || secret.metadata.creationTimestamp,
    };
  }).sort((a, b) => (a.namespace + a.name).localeCompare(b.namespace + b.name));

  return { source: 'secrets', items };
}

module.exports = { decodeHelmRelease, listHelmReleases };
