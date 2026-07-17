'use strict';
delete process.env.READ_ONLY;

const { test } = require('node:test');
const assert = require('node:assert');

test('ensureWritable passes when READ_ONLY is unset', () => {
  const { ensureWritable } = require('../src/infra/audit');
  assert.doesNotThrow(() => ensureWritable());
});
