'use strict';
/*
 * Server-side dry-run enforcement for bulk operations. A dry-run response
 * carries an HMAC token over the exact filter + matched count; the execute
 * call must present it. The secret is random per process, so tokens cannot be
 * forged or reused across restarts, and a changed matched set invalidates the
 * preview (count is part of the payload).
 */

const crypto = require('crypto');

const SECRET = crypto.randomBytes(32);

function confirmToken(payload) {
  return crypto.createHmac('sha256', SECRET).update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

module.exports = { confirmToken };
