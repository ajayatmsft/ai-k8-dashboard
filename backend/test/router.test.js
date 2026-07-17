'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { api } = require('../src/http/router');

// The public API contract — removing or renaming any of these is a breaking
// change for the frontend (and future clients). See API.md.
const EXPECTED = [
  // system
  'health', 'config', 'setConfig', 'aiStatus',
  // cluster
  'namespaces', 'overview', 'clusterHealth', 'nodePools', 'deployments', 'pods',
  'events', 'describe', 'manifest', 'top',
  // helm / addons
  'helm', 'helmRelease', 'addons',
  // security
  'secrets', 'secret', 'serviceAccounts', 'identities',
  // logs
  'logs', 'aggregateLogs',
  // ops
  'exec', 'restart', 'scale', 'deletePod', 'applyManifest', 'bulkRestart', 'bulkDeletePods',
  // investigations
  'investigations', 'investigation',
];

test('router exposes the full API contract', () => {
  for (const name of EXPECTED) {
    assert.strictEqual(typeof api[name], 'function', `missing route: ${name}`);
  }
});

test('router has no unexpected routes (update EXPECTED + API.md when adding)', () => {
  const extra = Object.keys(api).filter((k) => !EXPECTED.includes(k));
  assert.deepStrictEqual(extra, []);
});
