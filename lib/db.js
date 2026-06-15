'use strict';
/*
 * Investigation persistence.
 * --------------------------
 * Stores ONLY investigation metadata (never logs). Two backends, chosen
 * automatically to honour the project's zero-npm-dependency design:
 *
 *   - PostgreSQL  : when DATABASE_URL is set AND the `psql` CLI is available.
 *                   We shell out to `psql` (same pattern as kubectl). Values are
 *                   passed via `-v name=value` and referenced as :'name', which
 *                   psql quotes safely — so there is no SQL injection from
 *                   user/LLM text.
 *   - JSON file   : fallback (investigations.json) so the app runs offline.
 *
 * Schema (Phase 1):
 *   investigations(id, question, namespace, target, summary, root_cause,
 *                  confidence, evidence, suggested_fix, provider, created_at)
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PSQL = process.env.PSQL_PATH || 'psql';
const DATABASE_URL = process.env.DATABASE_URL || '';
const JSON_FILE = path.join(__dirname, '..', 'investigations.json');

let mode = 'json'; // 'pg' | 'json'

function execPsql(args, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(PSQL, [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', ...args],
      { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) { const e = new Error((stderr || err.message || '').trim()); e.stderr = stderr; return reject(e); }
        resolve(stdout);
      });
  });
}

// Run a query that returns a single JSON value (tuples-only, unaligned).
async function pgQueryJSON(sql, vars = []) {
  const args = [];
  for (const [k, v] of vars) args.push('-v', `${k}=${v == null ? '' : v}`);
  args.push('-t', '-A', '-c', sql);
  const out = (await execPsql(args)).trim();
  if (!out || out === '') return null;
  try { return JSON.parse(out); } catch (_) { return null; }
}

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS investigations (
  id            TEXT PRIMARY KEY,
  question      TEXT NOT NULL,
  namespace     TEXT,
  target        TEXT,
  summary       TEXT,
  root_cause    TEXT,
  confidence    INTEGER,
  evidence      JSONB,
  suggested_fix TEXT,
  provider      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

async function init() {
  if (DATABASE_URL) {
    try {
      await execPsql(['-c', CREATE_SQL]);
      mode = 'pg';
      return { mode, ok: true };
    } catch (e) {
      mode = 'json';
      return { mode, ok: true, warning: `PostgreSQL unavailable (${e.message}); using JSON file fallback.` };
    }
  }
  mode = 'json';
  return { mode, ok: true };
}

// --- JSON fallback ----------------------------------------------------------

function jsonReadAll() {
  try { return JSON.parse(fs.readFileSync(JSON_FILE, 'utf8')); } catch (_) { return []; }
}
function jsonWriteAll(rows) { fs.writeFileSync(JSON_FILE, JSON.stringify(rows, null, 2)); }

// --- public API -------------------------------------------------------------

function newId() {
  return 'inv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function saveInvestigation(rec) {
  const row = {
    id: rec.id || newId(),
    question: rec.question || '',
    namespace: rec.namespace || null,
    target: rec.target || null,
    summary: rec.summary || '',
    root_cause: rec.root_cause || '',
    confidence: Number.isFinite(rec.confidence) ? Math.round(rec.confidence) : null,
    evidence: rec.evidence || [],
    suggested_fix: rec.suggested_fix || '',
    provider: rec.provider || 'heuristic',
    created_at: rec.created_at || new Date().toISOString(),
  };
  if (mode === 'pg') {
    const vars = [
      ['id', row.id], ['q', row.question], ['ns', row.namespace], ['tg', row.target],
      ['sum', row.summary], ['rc', row.root_cause], ['conf', row.confidence == null ? '' : row.confidence],
      ['ev', JSON.stringify(row.evidence)], ['fix', row.suggested_fix], ['prov', row.provider],
    ];
    const sql = `INSERT INTO investigations
      (id, question, namespace, target, summary, root_cause, confidence, evidence, suggested_fix, provider)
      VALUES (:'id', :'q', NULLIF(:'ns',''), NULLIF(:'tg',''), :'sum', :'rc',
              NULLIF(:'conf','')::int, :'ev'::jsonb, :'fix', :'prov');`;
    const args = [];
    for (const [k, v] of vars) args.push('-v', `${k}=${v == null ? '' : v}`);
    args.push('-c', sql);
    await execPsql(args);
  } else {
    const rows = jsonReadAll();
    rows.unshift(row);
    jsonWriteAll(rows.slice(0, 500));
  }
  return row;
}

async function listInvestigations(limit = 50) {
  if (mode === 'pg') {
    const sql = `SELECT COALESCE(json_agg(t), '[]') FROM (
      SELECT id, question, namespace, target, summary, root_cause, confidence, suggested_fix, provider, created_at
      FROM investigations ORDER BY created_at DESC LIMIT ${parseInt(limit, 10) || 50}) t;`;
    return (await pgQueryJSON(sql)) || [];
  }
  return jsonReadAll().slice(0, limit);
}

async function getInvestigation(id) {
  if (mode === 'pg') {
    const sql = `SELECT row_to_json(t) FROM (SELECT * FROM investigations WHERE id = :'id') t;`;
    return (await pgQueryJSON(sql, [['id', id]])) || null;
  }
  return jsonReadAll().find((r) => r.id === id) || null;
}

function status() { return { mode, databaseUrlSet: !!DATABASE_URL }; }

module.exports = { init, saveInvestigation, listInvestigations, getInvestigation, status, newId };

