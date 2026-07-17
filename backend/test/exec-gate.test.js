'use strict';
// Exec disabled via env; not read-only. The gate must trip before any kubectl call.
process.env.EXEC_ENABLED = '0';
delete process.env.READ_ONLY;

const { test } = require('node:test');
const assert = require('node:assert');

test('exec endpoint is forbidden when EXEC_ENABLED=0', async () => {
  const { api } = require('../src/routes/ops');
  await assert.rejects(
    api.exec({}, { ns: 'default', pod: 'some-pod', command: 'ls' }),
    (e) => e.status === 403 && /EXEC_ENABLED/.test(e.message)
  );
});
