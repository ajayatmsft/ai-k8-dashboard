#!/usr/bin/env node
/* Download the latest built React UI (ui-dist artifact) from GitHub Actions
 * into ./ui-dist, for machines that cannot run npm (the backend serves it
 * automatically once present). Requires the `gh` CLI, authenticated.
 * Zero npm dependencies — shells out to gh. */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'ui-dist');

function gh(args) {
  return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
}

try {
  gh(['auth', 'status']);
} catch (e) {
  console.error('gh CLI not found or not authenticated. Install GitHub CLI and run `gh auth login`.');
  process.exit(1);
}

const runId = gh(['run', 'list', '--workflow', 'UI build', '--status', 'success',
  '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId']).trim();
if (!runId) {
  console.error('No successful "UI build" workflow run found.');
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
gh(['run', 'download', runId, '--name', 'ui-dist', '--dir', DEST]);
console.log(`✔ Downloaded UI bundle from run ${runId} into ${DEST}`);
console.log('  Start the dashboard normally — it now serves the React UI automatically.');
