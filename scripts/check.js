#!/usr/bin/env node
/* Syntax-check every .js file under backend/ and frontend/ with `node --check`.
 * Zero dependencies; exits non-zero on the first failure. */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = [
  ...collect(path.join(ROOT, 'backend')),
  ...collect(path.join(ROOT, 'frontend')),
];

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed += 1;
    console.error(`✖ ${path.relative(ROOT, f)}\n${r.stderr.trim()}`);
  }
}
if (failed) { console.error(`\n${failed} file(s) failed syntax check`); process.exit(1); }
console.log(`✔ ${files.length} files passed syntax check`);
