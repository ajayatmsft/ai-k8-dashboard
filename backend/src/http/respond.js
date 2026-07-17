'use strict';
/*
 * HTTP response/request helpers shared by the router and SSE streams.
 * CORS headers are only emitted when CORS_ORIGIN is configured (for a
 * separately hosted frontend); the default remains same-origin only.
 */

const { CORS_ORIGIN } = require('../config');

function corsHeaders() {
  if (!CORS_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(),
  });
  res.end(body);
}

function sendError(res, err, status = 500) {
  sendJSON(res, status, { error: err.message || String(err), stderr: err.stderr });
}

// SSE preamble; returns a send(event, data) function bound to the response.
function startSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    ...corsHeaders(),
  });
  return (event, data) => { res.write(`event: ${event}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`); };
}

function readBody(req) {
  return new Promise((resolve) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; if (chunks.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(chunks ? JSON.parse(chunks) : {}); } catch (_) { resolve({}); } });
  });
}

module.exports = { sendJSON, sendError, startSSE, readBody, corsHeaders };
