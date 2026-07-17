'use strict';
/*
 * Agent orchestrator.
 * -------------------
 * Turns a natural-language question into a structured root-cause analysis.
 *
 * Design principle: the AI NEVER talks to Kubernetes. It only proposes tool
 * calls (by name); this orchestrator validates + executes them through the
 * registry and feeds results back. A bounded loop prevents runaways.
 *
 * Two modes:
 *   - With an AI provider: dynamic tool-calling loop, seeded with heuristic
 *     hints, concluding in a JSON RCA.
 *   - Without a provider (offline): a scripted gather + deterministic
 *     heuristic RCA. Same output shape either way.
 */

const heur = require('../domain/heuristics');

const STOPWORDS = new Set(['investigate', 'why', 'is', 'are', 'the', 'a', 'an', 'service',
  'failing', 'failed', 'down', 'unhealthy', 'pod', 'pods', 'deployment', 'deployments',
  'namespace', 'show', 'me', 'what', 'whats', 'crashing', 'restarting', 'frequently',
  'check', 'find', 'in', 'on', 'of', 'for', 'my', 'app', 'and', 'or', 'to', 'with',
  'problem', 'issue', 'error', 'errors', 'broken', 'not', 'working', 'status', 'health']);

const NAME_TOKEN = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/i;

// Best-effort: pull a likely resource name and namespace out of the question.
function extractTarget(question) {
  const tokens = String(question || '').split(/\s+/).map((t) => t.replace(/[^\w.-]/g, ''));
  let namespace = null;
  const m = String(question).match(/\b(?:ns|namespace)[:= ]+([a-z0-9][-a-z0-9.]*)/i);
  if (m) namespace = m[1];
  const candidates = tokens.filter((t) => t && !STOPWORDS.has(t.toLowerCase()) && NAME_TOKEN.test(t) && t.length > 1);
  // Prefer tokens that look service-y (contain a dash or known suffix).
  candidates.sort((a, b) => (b.includes('-') ? 1 : 0) - (a.includes('-') ? 1 : 0));
  return { target: candidates[0] || '', namespace };
}

const SYSTEM_PROMPT = `You are a senior Kubernetes SRE assistant embedded in a cluster dashboard.
You diagnose problems by calling the provided tools — you have NO other access to the cluster.
Work methodically: locate the workload, inspect pod states, read events, then logs (use previous=true for crash loops), and check metrics if relevant. Correlate findings across sources.
Be efficient: do not call more tools than necessary. Stop as soon as you can explain the issue.
When you are confident, STOP calling tools and reply with ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{"summary": string, "root_cause": string, "evidence": string[], "suggested_fix": string, "confidence": number /*0-100*/}
Base every claim on tool output you actually observed. If healthy, say so with lower confidence.`;

function extractJSON(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{'); const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch (_) { return null; }
}

// --- scripted gather (used for offline RCA and to seed the AI with hints) ---

async function gatherContext(registry, { question, namespace, onStep }) {
  const step = (m) => { try { onStep && onStep(m); } catch (_) {} };
  const run = (name, args) => registry.get(name).handler(args || {});
  const { target, namespace: nsFromQ } = extractTarget(question);
  let ns = namespace || nsFromQ || null;

  step({ phase: 'locate', message: `Locating workload "${target || '(all)'}"…` });
  let deployment = null, selector = null;
  try {
    const deps = await run('getDeployments', { namespace: ns });
    const match = deps.items.find((d) => d.name === target)
      || deps.items.find((d) => target && d.name.includes(target));
    if (match) {
      deployment = match; ns = match.namespace;
      selector = Object.entries(match.selector || {}).map(([k, v]) => `${k}=${v}`).join(',') || null;
    }
  } catch (_) { /* cluster may be unreachable; continue best-effort */ }

  step({ phase: 'pods', message: 'Reading pod health…' });
  let pods = [];
  try {
    const res = await run('getPods', { namespace: ns || '_all', selector });
    pods = res.items;
    if (target && !selector) pods = pods.filter((p) => p.name.includes(target));
  } catch (_) {}

  step({ phase: 'events', message: 'Collecting events…' });
  let events = [];
  try { events = (await run('getEvents', { namespace: ns, name: target || undefined })).items; } catch (_) {}

  step({ phase: 'logs', message: 'Sampling logs…' });
  const logBundles = [];
  const unhealthy = pods.filter((p) => p.restarts > 0 || p.phase !== 'Running' || (p.ready && p.ready.split('/')[0] !== p.ready.split('/')[1]));
  for (const p of (unhealthy.length ? unhealthy : pods).slice(0, 4)) {
    const crashed = (p.containers || []).some((c) => c.restartCount > 0 || (c.lastTerminated));
    try { logBundles.push(await run('getLogs', { namespace: p.namespace, pod: p.name, tail: 200, previous: crashed })); } catch (_) {}
  }

  step({ phase: 'metrics', message: 'Checking metrics…' });
  let podMetrics = null, nodeMetrics = null;
  try { podMetrics = await run('getPodMetrics', { namespace: ns }); } catch (_) {}
  try { nodeMetrics = await run('getNodeMetrics', {}); } catch (_) {}

  const signals = heur.analyzeAll({ pods, events, logBundles, nodeMetrics });
  return { target, namespace: ns, deployment, pods, events, logBundles, podMetrics, nodeMetrics, signals };
}

// --- AI tool-calling loop ---------------------------------------------------

async function runWithAI({ question, namespace, registry, ai, onStep, maxSteps, allowMutations }) {
  const step = (m) => { try { onStep && onStep(m); } catch (_) {} };

  // Seed the model with heuristic hints from a quick scripted gather.
  const ctx = await gatherContext(registry, { question, namespace, onStep });
  const hints = ctx.signals.slice(0, 8).map((s) => `- [${s.severity}] ${s.title}: ${s.detail || ''}`).join('\n');

  let tools = registry.toOpenAITools();
  if (!allowMutations) {
    const mutating = new Set(registry.list().filter((t) => t.mutating).map((t) => t.name));
    tools = tools.filter((t) => !mutating.has(t.function.name));
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content:
        `Question: ${question}\n` +
        (ctx.namespace ? `Resolved namespace: ${ctx.namespace}\n` : '') +
        (ctx.target ? `Likely target: ${ctx.target}\n` : '') +
        (hints ? `\nDetected signals (hints from a quick scan — verify with tools):\n${hints}\n` : '\nNo obvious problems detected in a quick scan; verify with tools.\n') },
  ];

  step({ phase: 'ai', message: 'Asking the AI to plan the investigation…' });
  for (let i = 0; i < (maxSteps || 8); i++) {
    let msg;
    try { msg = await ai.chat(messages, tools); }
    catch (e) {
      step({ phase: 'ai', message: `AI error: ${e.message}. Falling back to heuristic analysis.` });
      return finalizeHeuristic(ctx, 'heuristic-fallback');
    }
    messages.push(msg);

    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const parsed = extractJSON(msg.content);
      if (parsed) { step({ phase: 'done', message: 'AI produced a root-cause analysis.' }); return normalizeReport(parsed, ctx, ai.name); }
      // No tool calls and no JSON — nudge once, else fall back.
      messages.push({ role: 'user', content: 'Reply with ONLY the final JSON object now.' });
      continue;
    }

    for (const call of calls) {
      const fn = call.function || {};
      const tool = registry.get(fn.name);
      let args = {};
      try { args = fn.arguments ? JSON.parse(fn.arguments) : {}; } catch (_) {}
      step({ phase: 'tool', tool: fn.name, args, message: `Running ${fn.name}(${shortArgs(args)})…` });
      let result;
      if (!tool) result = { error: `unknown tool: ${fn.name}` };
      else { try { result = await tool.handler(args); } catch (e) { result = { error: e.message }; } }
      messages.push({ role: 'tool', tool_call_id: call.id, name: fn.name, content: JSON.stringify(result).slice(0, 12000) });
    }
  }

  step({ phase: 'done', message: 'Step budget reached; synthesizing from collected data.' });
  return finalizeHeuristic(ctx, ai.name + '+heuristic');
}

function shortArgs(a) { return Object.entries(a || {}).map(([k, v]) => `${k}=${v}`).join(', ').slice(0, 80); }

function normalizeReport(parsed, ctx, provider) {
  return {
    summary: String(parsed.summary || '').slice(0, 1000),
    root_cause: String(parsed.root_cause || '').slice(0, 2000),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 12) : [],
    suggested_fix: String(parsed.suggested_fix || '').slice(0, 2000),
    confidence: clampPct(parsed.confidence),
    target: ctx.target || null, namespace: ctx.namespace || null,
    provider, signals: ctx.signals.map((s) => ({ code: s.code, severity: s.severity, title: s.title })),
  };
}

function finalizeHeuristic(ctx, provider) {
  const rep = heur.synthesizeReport(ctx.target || ctx.namespace || 'the selected scope', ctx.signals);
  return { ...rep, target: ctx.target || null, namespace: ctx.namespace || null, provider };
}

function clampPct(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50; }

/**
 * Public entry point. Returns a structured RCA report.
 * onStep(stepObj) is called as the investigation progresses (for SSE UI).
 */
async function runInvestigation({ question, namespace, registry, ai, onStep, maxSteps, allowMutations = false }) {
  if (!question || !String(question).trim()) { const e = new Error('question required'); e.status = 400; throw e; }
  if (ai) return runWithAI({ question, namespace, registry, ai, onStep, maxSteps, allowMutations });
  // Offline: scripted gather + deterministic heuristics.
  const ctx = await gatherContext(registry, { question, namespace, onStep });
  if (onStep) onStep({ phase: 'done', message: 'Generated heuristic root-cause analysis (no AI provider configured).' });
  return finalizeHeuristic(ctx, 'heuristic');
}

module.exports = { runInvestigation, extractTarget, extractJSON, gatherContext, SYSTEM_PROMPT };

