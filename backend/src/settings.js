'use strict';
/*
 * Runtime settings: which kubeconfig/context/namespace the UI selected.
 * Persisted to settings.json. Non-destructive — we never edit the user's
 * kubeconfig; the chosen values are passed as per-call kubectl flags.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { SETTINGS_FILE } = require('./config');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (_) {
    return { kubeconfig: '', context: '', namespace: '_all' };
  }
}
function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

// Global kubectl flags derived from current settings.
function globalArgs() {
  const s = loadSettings();
  const args = [];
  if (s.kubeconfig) args.push('--kubeconfig', s.kubeconfig);
  if (s.context) args.push('--context', s.context);
  return args;
}

// Discover candidate kubeconfig files (default + KUBECONFIG env + ~/.kube/*).
function discoverKubeconfigs() {
  const found = new Set();
  const def = path.join(os.homedir(), '.kube', 'config');
  if (fs.existsSync(def)) found.add(def);
  if (process.env.KUBECONFIG) {
    for (const p of process.env.KUBECONFIG.split(path.delimiter)) {
      if (p && fs.existsSync(p)) found.add(p);
    }
  }
  const kubeDir = path.join(os.homedir(), '.kube');
  try {
    for (const f of fs.readdirSync(kubeDir)) {
      const full = path.join(kubeDir, f);
      if (!fs.statSync(full).isFile()) continue;
      // Heuristic: yaml/config-like files only.
      if (/config|\.ya?ml$|kubeconfig/i.test(f)) found.add(full);
    }
  } catch (_) { /* ignore */ }
  return [...found];
}

module.exports = { loadSettings, saveSettings, globalArgs, discoverKubeconfigs };
