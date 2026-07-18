'use strict';
/*
 * Central configuration. Every environment variable the backend reads is
 * resolved here — no other module touches process.env for tunables.
 *
 * DATA_DIR holds runtime state (settings.json, audit.log, investigations.json)
 * and defaults to the repo root so existing installs keep their data.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = process.env.DATA_DIR || ROOT;

// UI resolution: prefer the built React app (ui/dist — shipped in releases and
// the npm package; ui-dist — a downloaded CI artifact), fall back to the
// legacy no-build frontend. FRONTEND_DIR always wins.
function defaultFrontendDir() {
  for (const dir of [path.join(ROOT, 'ui', 'dist'), path.join(ROOT, 'ui-dist')]) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return path.join(ROOT, 'frontend');
}

module.exports = {
  HOST: process.env.HOST || '127.0.0.1',
  PORT: parseInt(process.env.PORT || '7575', 10),
  KUBECTL: process.env.KUBECTL_PATH || 'kubectl',
  HELM: process.env.HELM_PATH || 'helm',
  READ_ONLY: /^(1|true|yes)$/i.test(process.env.READ_ONLY || ''),

  // Debug shell (kubectl exec). Enabled by default for the local single-user
  // case (the health view's "Top processes" action depends on it); disable
  // explicitly on shared instances with EXEC_ENABLED=0. READ_ONLY also
  // disables it regardless of this flag.
  EXEC_ENABLED: !/^(0|false|no)$/i.test(process.env.EXEC_ENABLED || ''),

  // Allow a separately hosted frontend (e.g. a dev server) to call this API.
  // Empty (default) = same-origin only, no CORS headers emitted.
  CORS_ORIGIN: process.env.CORS_ORIGIN || '',

  ROOT,
  DATA_DIR,
  FRONTEND_DIR: process.env.FRONTEND_DIR || defaultFrontendDir(),
  SETTINGS_FILE: path.join(DATA_DIR, 'settings.json'),
  AUDIT_FILE: path.join(DATA_DIR, 'audit.log'),
  INVESTIGATIONS_FILE: path.join(DATA_DIR, 'investigations.json'),

  MAX_BUFFER: 64 * 1024 * 1024, // 64 MB
  KUBECTL_TIMEOUT: 30000, // 30s
  MAX_STREAM_PODS: 60, // safety cap for multi-pod follow
};
