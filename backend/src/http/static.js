'use strict';
/*
 * Static file serving for the frontend bundle. The frontend is a separate
 * concern (see frontend/); the backend merely serves its built/plain files so
 * the default single-process experience keeps working. Set FRONTEND_DIR to
 * point elsewhere, or host the frontend independently and use CORS_ORIGIN.
 */

const fs = require('fs');
const path = require('path');
const { FRONTEND_DIR } = require('../config');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(FRONTEND_DIR, safe);
  if (!file.startsWith(FRONTEND_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback: extension-less paths are client-side routes — serve the app.
      if (!path.extname(safe)) {
        return fs.readFile(path.join(FRONTEND_DIR, 'index.html'), (err2, index) => {
          if (err2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(index);
        });
      }
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

module.exports = { serveStatic };
