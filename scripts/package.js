#!/usr/bin/env node
/* Build a clean offline-ready archive of the dashboard.
 *
 * Output: ./dist/k8s-local-dashboard-<timestamp>.zip
 *
 * Excludes runtime/local-only files (audit.log, settings.json, .git, etc).
 * Zero dependencies — uses PowerShell's Compress-Archive on Windows and
 * the `zip` command elsewhere, falling back to a tar.gz if neither exists.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, execSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const baseName = `k8s-local-dashboard-${stamp}`;

// Files / dirs to include. (We intentionally enumerate to avoid surprises.)
const INCLUDE = [
  'package.json',
  'README.md',
  'server.js',
  'start.cmd',
  '.gitignore',
  'public',
  'scripts',
];
// Optional siblings.
for (const opt of ['LICENSE', 'CHANGELOG.md']) {
  if (fs.existsSync(path.join(ROOT, opt))) INCLUDE.push(opt);
}

// Stage to a temp dir so we don't pull in audit.log/settings.json/etc.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'kdash-pkg-'));
const stageRoot = path.join(stage, baseName);
fs.mkdirSync(stageRoot, { recursive: true });

function copyRec(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src)) copyRec(path.join(src, e), path.join(dst, e));
  } else {
    fs.copyFileSync(src, dst);
  }
}
for (const item of INCLUDE) {
  const src = path.join(ROOT, item);
  if (!fs.existsSync(src)) continue;
  copyRec(src, path.join(stageRoot, item));
}

// Drop a small INSTALL note inside the archive.
fs.writeFileSync(path.join(stageRoot, 'INSTALL-OFFLINE.txt'), `K8s Local Dashboard — offline install
=====================================

Prerequisites on the target machine:
 1. Node.js 16+ on PATH    (node -v)
 2. kubectl on PATH        (kubectl version --client)
 3. A kubeconfig that points at a cluster reachable from this machine.

Run:
   npm start
or double-click start.cmd (Windows).

Then open http://127.0.0.1:7575

This package has ZERO npm dependencies — no internet required.
`);

// Zip it.
const isWin = process.platform === 'win32';
const outZip = path.join(DIST, `${baseName}.zip`);
const outTar = path.join(DIST, `${baseName}.tar.gz`);

function tryWindowsZip() {
  const ps = `Compress-Archive -Path '${stageRoot}\\*' -DestinationPath '${outZip}' -Force`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
}
function tryUnixZip() {
  execSync(`cd "${stage}" && zip -r "${outZip}" "${baseName}"`, { stdio: 'inherit' });
}
function tryTar() {
  execSync(`cd "${stage}" && tar czf "${outTar}" "${baseName}"`, { stdio: 'inherit' });
}

let produced;
try {
  if (isWin) { tryWindowsZip(); produced = outZip; }
  else if (spawnSync('zip', ['-v']).status === 0) { tryUnixZip(); produced = outZip; }
  else { tryTar(); produced = outTar; }
} catch (e) {
  // last-resort: tar
  try { tryTar(); produced = outTar; }
  catch (err) { console.error('packaging failed:', err.message); process.exit(1); }
}

// Cleanup staging.
fs.rmSync(stage, { recursive: true, force: true });

const sizeMB = (fs.statSync(produced).size / (1024 * 1024)).toFixed(2);
console.log(`\n✔ Packaged: ${produced}  (${sizeMB} MB)`);
console.log('  Copy that file to the offline machine, unzip, run "npm start" or start.cmd.');
console.log('  Make sure node and kubectl are installed there separately.');

