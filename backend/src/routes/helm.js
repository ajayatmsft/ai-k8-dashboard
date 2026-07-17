'use strict';
/*
 * Helm releases and add-on detection (read-only).
 */

const { helm } = require('../infra/kubectl');
const { validName, badRequest } = require('../util');
const { listHelmReleases } = require('../domain/helm');
const { detectAddons } = require('../domain/addons');

const api = {
  async helm(q) { return listHelmReleases({ ns: q.ns }); },

  // Helm release detail: status + history + user-supplied values (best-effort;
  // needs the helm binary, returns availability flags otherwise).
  async helmRelease(q) {
    if (!validName(q.name)) throw badRequest('valid release name required');
    if (!validName(q.ns)) throw badRequest('valid namespace required');
    const out = { name: q.name, namespace: q.ns };
    try { out.status = JSON.parse(await helm(['status', q.name, '-n', q.ns, '-o', 'json'])); out.helmAvailable = true; }
    catch (e) { out.helmAvailable = !e.notFound; out.error = e.message; }
    try { out.history = JSON.parse(await helm(['history', q.name, '-n', q.ns, '-o', 'json'])); } catch (_) {}
    try { out.values = await helm(['get', 'values', q.name, '-n', q.ns]); } catch (_) {}
    return out;
  },

  async addons() { return detectAddons(); },
};

module.exports = { api };
