'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCpuToMilli, parseMemToBytes, fmtBytes, fmtCpu } = require('../src/domain/health');

test('parseCpuToMilli handles cores, millicores, micro/nanocores', () => {
  assert.strictEqual(parseCpuToMilli('500m'), 500);
  assert.strictEqual(parseCpuToMilli('2'), 2000);
  assert.strictEqual(parseCpuToMilli('250000n'), 0.25);
  assert.strictEqual(parseCpuToMilli('1500u'), 1.5);
  assert.strictEqual(parseCpuToMilli(''), 0);
  assert.strictEqual(parseCpuToMilli(null), 0);
});

test('parseMemToBytes handles binary and decimal suffixes', () => {
  assert.strictEqual(parseMemToBytes('128Mi'), 128 * 1024 * 1024);
  assert.strictEqual(parseMemToBytes('1Gi'), 1024 ** 3);
  assert.strictEqual(parseMemToBytes('1G'), 1e9);
  assert.strictEqual(parseMemToBytes('500k'), 500e3);
  assert.strictEqual(parseMemToBytes('1024'), 1024);
  assert.strictEqual(parseMemToBytes('garbage!'), 0);
  assert.strictEqual(parseMemToBytes(null), 0);
});

test('fmtBytes renders human-readable sizes', () => {
  assert.strictEqual(fmtBytes(0), '0');
  assert.strictEqual(fmtBytes(512), '512B');
  assert.strictEqual(fmtBytes(1024), '1.0Ki');
  assert.strictEqual(fmtBytes(128 * 1024 * 1024), '128Mi');
});

test('fmtCpu renders millicores under 1 core, cores above', () => {
  assert.strictEqual(fmtCpu(250), '250m');
  assert.strictEqual(fmtCpu(1000), '1');
  assert.strictEqual(fmtCpu(2500), '2.50');
});
