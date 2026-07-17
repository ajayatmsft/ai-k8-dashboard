'use strict';
/*
 * Request routing. Assembles the API surface from the route modules and
 * dispatches: /api/<name> → JSON handler or SSE stream; everything else →
 * static frontend files. Route names are the module-exported function names,
 * preserving the original one-file API contract exactly.
 */

const url = require('url');
const { sendJSON, sendError, readBody, corsHeaders } = require('./respond');
const { serveStatic } = require('./static');

const modules = [
  require('../routes/system'),
  require('../routes/cluster'),
  require('../routes/helm'),
  require('../routes/security'),
  require('../routes/logs'),
  require('../routes/ops'),
  require('../routes/investigations'),
];

const api = {};
const sse = { streamLogs: null, investigate: null };
for (const m of modules) {
  for (const [name, fn] of Object.entries(m.api || {})) {
    if (api[name]) throw new Error(`duplicate API route: ${name}`);
    api[name] = fn;
  }
  Object.assign(sse, m.sse || {});
}

async function handleRequest(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); return res.end(); }

  const name = pathname.slice('/api/'.length);
  if (sse[name]) return sse[name](req, res, parsed.query);

  const handler = api[name];
  if (!handler) return sendJSON(res, 404, { error: `unknown endpoint: ${name}` });
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    sendJSON(res, 200, await handler(parsed.query, body));
  } catch (err) {
    sendError(res, err, err.status || 500);
  }
}

module.exports = { handleRequest, api };
