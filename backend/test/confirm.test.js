'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { confirmToken } = require('../src/infra/confirm');

test('same payload yields the same token within a process', () => {
  const p = { op: 'bulkRestart', ns: '_all', regex: 'ext', selector: '', kinds: ['deployment'], count: 3 };
  assert.strictEqual(confirmToken(p), confirmToken({ ...p }));
});

test('any payload change (filter or matched count) changes the token', () => {
  const p = { op: 'bulkRestart', ns: '_all', regex: 'ext', selector: '', kinds: ['deployment'], count: 3 };
  assert.notStrictEqual(confirmToken(p), confirmToken({ ...p, count: 4 }));
  assert.notStrictEqual(confirmToken(p), confirmToken({ ...p, regex: 'ext2' }));
  assert.notStrictEqual(confirmToken(p), confirmToken({ ...p, op: 'bulkDeletePods' }));
});

test('token is a 32-char hex string (not the raw payload)', () => {
  const t = confirmToken({ op: 'x', count: 1 });
  assert.match(t, /^[0-9a-f]{32}$/);
});
