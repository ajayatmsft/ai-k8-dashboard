'use strict';
/*
 * Audit trail + READ_ONLY gate. Every mutating action and secret view goes
 * through here so operations are attributable after the fact.
 */

const fs = require('fs');
const { AUDIT_FILE, READ_ONLY } = require('../config');
const { forbidden } = require('../util');

function ensureWritable() {
  if (READ_ONLY) throw forbidden('Dashboard is in READ_ONLY mode; mutating actions are disabled.');
}

function audit(action, detail) {
  const line = `${new Date().toISOString()}\t${action}\t${JSON.stringify(detail)}\n`;
  fs.appendFile(AUDIT_FILE, line, () => {});
}

module.exports = { audit, ensureWritable };
