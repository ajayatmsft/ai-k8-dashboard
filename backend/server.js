#!/usr/bin/env node
/*
 * k8s-local-dashboard — backend entry point
 * -----------------------------------------
 * Offline, team-grade web dashboard for Kubernetes clusters.
 *
 *  - Zero npm dependencies (Node stdlib only).
 *  - No internet required. Talks to clusters through the `kubectl` binary on
 *    your PATH, using whatever kubeconfig/context you select in the UI.
 *  - Non-destructive context switching: we pass `--context` per call and never
 *    mutate your kubeconfig file.
 *  - Mutating actions are gated by READ_ONLY mode and written to audit.log.
 *
 * Layout (separation of concerns — see src/):
 *   src/config.js    all env/config in one place
 *   src/settings.js  runtime kubeconfig/context selection
 *   src/infra/       kubectl+helm runners, audit log, investigation store
 *   src/domain/      cluster analysis (health, helm, addons, identity, nodes)
 *   src/ai/          provider, agent loop, tool registry
 *   src/http/        router, responses/CORS, static frontend serving
 *   src/routes/      thin API handlers grouped by concern
 * The frontend is a separate app in ../frontend, served statically here by
 * default; host it elsewhere by setting CORS_ORIGIN + frontend API base.
 */

'use strict';

const http = require('http');
const config = require('./src/config');
const { loadSettings } = require('./src/settings');
const { handleRequest } = require('./src/http/router');
const { buildAgentStack } = require('./src/ai/stack');

const server = http.createServer(handleRequest);

server.listen(config.PORT, config.HOST, () => {
  /* eslint-disable no-console */
  console.log('');
  console.log('  k8s-local-dashboard');
  console.log('  -------------------');
  console.log(`  Serving on http://${config.HOST}:${config.PORT}`);
  console.log(`  kubectl:   ${config.KUBECTL}`);
  console.log(`  read-only: ${config.READ_ONLY}`);
  const s = loadSettings();
  console.log(`  kubeconfig: ${s.kubeconfig || '(default)'}`);
  console.log(`  context:    ${s.context || '(current)'}`);
  buildAgentStack().then((info) => {
    console.log(`  ai:         ${info.ai ? info.ai.name + ' (' + info.ai.model + ')' : 'heuristic-only (set OPENAI_API_KEY for the agent)'}`);
    console.log(`  storage:    ${info.db.mode}${info.db.warning ? ' — ' + info.db.warning : ''}`);
    console.log('  (Ctrl+C to stop)');
    console.log('');
  });
});
