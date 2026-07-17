'use strict';
/*
 * System routes: liveness, kubeconfig/context configuration, AI status.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { READ_ONLY, EXEC_ENABLED } = require('../config');
const { kubectl, kubectlRaw } = require('../infra/kubectl');
const { audit } = require('../infra/audit');
const { badRequest } = require('../util');
const { loadSettings, saveSettings, discoverKubeconfigs } = require('../settings');
const stack = require('../ai/stack');

const api = {
  async health() {
    const ctx = (await kubectl(['config', 'current-context'])).trim();
    let server = '';
    try {
      server = (await kubectl(['config', 'view', '--minify', '-o',
        'jsonpath={.clusters[0].cluster.server}'])).trim();
    } catch (_) { /* ignore */ }
    return { ok: true, context: ctx, server, readOnly: READ_ONLY };
  },

  // Current config + everything the UI needs to switch kubeconfig/context.
  async config() {
    const s = loadSettings();
    const kubeconfigs = discoverKubeconfigs();
    let contexts = [];
    let current = '';
    try {
      const out = await kubectl(['config', 'get-contexts', '-o', 'name']);
      contexts = out.split('\n').map((x) => x.trim()).filter(Boolean);
    } catch (_) { /* ignore */ }
    try { current = (await kubectl(['config', 'current-context'])).trim(); } catch (_) {}
    return {
      kubeconfig: s.kubeconfig || '',
      defaultKubeconfig: path.join(os.homedir(), '.kube', 'config'),
      kubeconfigs,
      context: s.context || current,
      contexts,
      readOnly: READ_ONLY,
      execEnabled: EXEC_ENABLED && !READ_ONLY,
    };
  },

  // Switch kubeconfig and/or context (non-destructive: stored in our settings).
  async setConfig(q, body) {
    const s = loadSettings();
    if (typeof body.kubeconfig === 'string') {
      const kc = body.kubeconfig.trim();
      if (kc && !fs.existsSync(kc)) throw badRequest('kubeconfig file not found: ' + kc);
      s.kubeconfig = kc;
      // Changing kubeconfig invalidates the previously selected context.
      if (body.context === undefined) s.context = '';
    }
    if (typeof body.context === 'string') s.context = body.context.trim();
    if (typeof body.namespace === 'string') s.namespace = body.namespace.trim() || '_all';
    saveSettings(s);
    // Probe the new selection.
    const extra = [];
    if (s.kubeconfig) extra.push('--kubeconfig', s.kubeconfig);
    if (s.context) extra.push('--context', s.context);
    let ctx = '', server = '', error = '';
    try {
      ctx = (await kubectlRaw(['config', 'current-context'], extra)).trim();
      server = (await kubectlRaw(['config', 'view', '--minify', '-o',
        'jsonpath={.clusters[0].cluster.server}'], extra)).trim();
    } catch (e) { error = e.message; }
    audit('setConfig', { kubeconfig: s.kubeconfig, context: s.context });
    return { ok: !error, settings: s, context: ctx, server, error };
  },

  // Report AI/agent capability + storage status to the UI.
  async aiStatus() {
    const aiProvider = stack.getAIProvider();
    const toolRegistry = stack.getToolRegistry();
    return {
      enabled: true,
      aiProvider: aiProvider ? aiProvider.name : null,
      aiModel: aiProvider ? aiProvider.model : null,
      aiConfigured: !!aiProvider,
      mode: aiProvider ? 'agent' : 'heuristic',
      storage: stack.getDbStatus(),
      readOnly: READ_ONLY,
      tools: toolRegistry ? toolRegistry.list().map((t) => ({ name: t.name, mutating: !!t.mutating })) : [],
    };
  },
};

module.exports = { api };
