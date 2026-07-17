'use strict';
/*
 * Pod resolution shared by log aggregation, streaming, and bulk operations.
 */

const { kubectlJSON } = require('../infra/kubectl');
const { validSelector, badRequest, compileRegex, nsArgs } = require('../util');

// Resolve pods matching a filter (namespace + optional label selector + name regex).
async function resolvePods({ ns, selector, regex }) {
  if (selector && !validSelector(selector)) throw badRequest('invalid label selector');
  const re = compileRegex(regex);
  const args = ['get', 'pods', ...nsArgs(ns), '-o', 'json'];
  if (selector) args.push('-l', selector);
  const data = await kubectlJSON(args);
  return data.items
    .filter((p) => !re || re.test(p.metadata.name))
    .map((p) => ({
      namespace: p.metadata.namespace,
      name: p.metadata.name,
      containers: ((p.spec && p.spec.containers) || []).map((c) => c.name),
      phase: p.status && p.status.phase,
    }));
}

module.exports = { resolvePods };
