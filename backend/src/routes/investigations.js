'use strict';
/*
 * AI investigations: history endpoints + the live SSE investigation stream.
 * Investigations only ever READ the cluster — allowMutations is hardwired off.
 */

const { READ_ONLY } = require('../config');
const { badRequest, notFound } = require('../util');
const { startSSE } = require('../http/respond');
const agent = require('../ai/agent');
const stack = require('../ai/stack');
const store = require('../infra/store');

const api = {
  // List recent investigations (metadata only).
  async investigations() {
    return { items: await store.listInvestigations(50) };
  },

  // Fetch one investigation by id.
  async investigation(q) {
    if (!q.id) throw badRequest('id required');
    const row = await store.getInvestigation(q.id);
    if (!row) throw notFound('investigation not found');
    return row;
  },
};

// Runs the agent for a natural-language question, streaming each step to the
// browser, then emits the final report and persists its metadata.
async function investigate(req, res, query) {
  const send = startSSE(res);
  const aiProvider = stack.getAIProvider();

  const question = (query.question || query.q || '').toString();
  if (!question.trim()) { send('error', { error: 'question required' }); send('eof', {}); return res.end(); }

  let closed = false;
  req.on('close', () => { closed = true; });
  const hb = setInterval(() => { if (!closed) res.write(': hb\n\n'); }, 15000);

  send('meta', {
    question,
    provider: aiProvider ? aiProvider.name : 'heuristic',
    model: aiProvider ? aiProvider.model : null,
    readOnly: READ_ONLY,
  });

  try {
    const report = await agent.runInvestigation({
      question,
      namespace: query.ns && query.ns !== '_all' ? query.ns : null,
      registry: stack.getToolRegistry(),
      ai: aiProvider,
      maxSteps: parseInt(query.maxSteps, 10) || 8,
      allowMutations: false, // investigations never mutate the cluster
      onStep: (step) => { if (!closed) send('step', step); },
    });

    let saved = report;
    try {
      saved = await store.saveInvestigation({ question, ...report });
      report.id = saved.id; report.created_at = saved.created_at;
    } catch (e) { send('warn', { message: 'could not persist investigation: ' + e.message }); }

    send('report', report);
  } catch (e) {
    send('error', { error: e.message });
  } finally {
    clearInterval(hb);
    send('eof', {});
    res.end();
  }
}

module.exports = { api, sse: { investigate } };
