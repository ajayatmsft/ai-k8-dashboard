'use strict';
/*
 * Security surface: secrets (list + audited value reveal), service accounts,
 * and pod-attached cloud identities.
 */

const { READ_ONLY } = require('../config');
const { kubectlJSON } = require('../infra/kubectl');
const { audit } = require('../infra/audit');
const { nsArgs, age, validName, badRequest } = require('../util');
const { listServiceAccounts, listPodIdentities } = require('../domain/identity');

const api = {
  async secrets(q) {
    const data = await kubectlJSON(['get', 'secrets', ...nsArgs(q.ns), '-o', 'json']);
    return { items: data.items.map((s) => ({
      namespace: s.metadata.namespace, name: s.metadata.name, type: s.type,
      keys: Object.keys(s.data || {}), age: age(s.metadata.creationTimestamp),
    })) };
  },

  async secret(q) {
    if (!validName(q.ns)) throw badRequest('valid namespace required');
    if (!validName(q.name)) throw badRequest('valid name required');
    const data = await kubectlJSON(['get', 'secret', q.name, '-n', q.ns, '-o', 'json']);
    // Read-only instances never expose secret values — keys only.
    if (READ_ONLY) {
      const redacted = {};
      for (const k of Object.keys(data.data || {})) redacted[k] = '<redacted — READ_ONLY mode>';
      audit('viewSecret', { ns: q.ns, name: q.name, redacted: true });
      return { name: q.name, namespace: q.ns, type: data.type, data: redacted, redacted: true };
    }
    const decoded = {};
    for (const [k, v] of Object.entries(data.data || {})) {
      try { decoded[k] = Buffer.from(v, 'base64').toString('utf8'); }
      catch (_) { decoded[k] = '<binary>'; }
    }
    audit('viewSecret', { ns: q.ns, name: q.name });
    return { name: q.name, namespace: q.ns, type: data.type, data: decoded };
  },

  async serviceAccounts(q) { return listServiceAccounts({ ns: q.ns }); },

  async identities(q) { return listPodIdentities({ ns: q.ns }); },
};

module.exports = { api };
