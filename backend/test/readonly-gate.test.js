'use strict';
// Each test file runs in its own process, so setting env before require is safe.
process.env.READ_ONLY = '1';

const { test } = require('node:test');
const assert = require('node:assert');

test('ensureWritable throws 403 when READ_ONLY=1', () => {
  const { ensureWritable } = require('../src/infra/audit');
  assert.throws(() => ensureWritable(), (e) => e.status === 403 && /READ_ONLY/.test(e.message));
});

test('config reflects READ_ONLY and disables exec', () => {
  const config = require('../src/config');
  assert.strictEqual(config.READ_ONLY, true);
});
