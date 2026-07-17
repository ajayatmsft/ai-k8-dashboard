'use strict';
/*
 * Input validation, HTTP-friendly errors, and small formatting helpers shared
 * across routes and domain services. All user-supplied names/selectors/regexes
 * pass through these validators before reaching a kubectl argv.
 */

const NAME_RE = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/i;
function validName(v) { return typeof v === 'string' && v.length > 0 && v.length <= 253 && NAME_RE.test(v); }

// Label selectors like app=foo,tier in (a,b). Allow a conservative charset.
const SELECTOR_RE = /^[a-zA-Z0-9_.,()!= /-]*$/;
function validSelector(v) { return typeof v === 'string' && v.length <= 512 && SELECTOR_RE.test(v); }

function nsArgs(ns) { return (!ns || ns === '_all') ? ['--all-namespaces'] : ['-n', ns]; }

function age(creationTimestamp) {
  if (!creationTimestamp) return '';
  let s = Math.max(0, Math.floor((Date.now() - new Date(creationTimestamp).getTime()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }
function forbidden(msg) { const e = new Error(msg); e.status = 403; return e; }
function notFound(msg) { const e = new Error(msg); e.status = 404; return e; }

function compileRegex(src) {
  if (!src) return null;
  try { return new RegExp(src, 'i'); }
  catch (_) { throw badRequest('invalid regex: ' + src); }
}

module.exports = {
  validName, validSelector, nsArgs, age,
  badRequest, forbidden, notFound, compileRegex,
};
