'use strict';
/*
 * AI agent stack: builds the tool registry over the domain services, picks an
 * AI provider from env, and initialises the metadata store. Holds the
 * singleton state the routes read (provider, registry, storage status).
 */

const { createAIProvider } = require('./provider');
const { buildToolRegistry } = require('./tools');
const store = require('../infra/store');
const { kubectl, kubectlJSON } = require('../infra/kubectl');
const { audit, ensureWritable } = require('../infra/audit');
const { nsArgs, validName, age } = require('../util');
const { listHelmReleases } = require('../domain/helm');
const { detectAddons } = require('../domain/addons');
const { listServiceAccounts, listPodIdentities } = require('../domain/identity');
const { gatherClusterHealth } = require('../domain/clusterHealth');
const { listNodePools } = require('../domain/nodes');

let toolRegistry = null;
let aiProvider = null;
let dbStatus = { mode: 'json' };

async function buildAgentStack() {
  toolRegistry = buildToolRegistry({
    kubectl, kubectlJSON, nsArgs, validName, age, ensureWritable, audit,
    listHelmReleases, detectAddons, listServiceAccounts, listPodIdentities,
    gatherClusterHealth, listNodePools,
  });
  aiProvider = createAIProvider(process.env);
  try { dbStatus = await store.init(); } catch (e) { dbStatus = { mode: 'json', warning: e.message }; }
  return { ai: aiProvider ? { name: aiProvider.name, model: aiProvider.model } : null, db: dbStatus };
}

module.exports = {
  buildAgentStack,
  getToolRegistry: () => toolRegistry,
  getAIProvider: () => aiProvider,
  getDbStatus: () => dbStatus,
};
