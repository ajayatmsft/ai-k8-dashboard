'use strict';
/*
 * AI provider abstraction.
 * ------------------------
 * One small interface (`chat`) with a pluggable backend. The MVP ships an
 * OpenAI implementation that talks to the Chat Completions REST API using
 * Node's built-in `https` module (no SDK, zero npm dependencies). Stubs for
 * Ollama / Claude / Gemini are wired so they can drop in later.
 *
 * The provider NEVER touches Kubernetes. It only proposes tool calls; the
 * backend executes approved tools and feeds results back (see lib/agent.js).
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// --- low level JSON POST (works on Node 16+; no global fetch needed) --------

function postJSON(endpoint, headers, payload, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(endpoint); } catch (e) { return reject(new Error('invalid AI endpoint: ' + endpoint)); }
    const body = Buffer.from(JSON.stringify(payload));
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let parsed;
          try { parsed = data ? JSON.parse(data) : {}; } catch (_) { parsed = { raw: data }; }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg = (parsed && parsed.error && parsed.error.message) || parsed.raw || `HTTP ${res.statusCode}`;
            return reject(new Error('AI provider error: ' + msg));
          }
          resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error('AI request timed out')); });
    req.end(body);
  });
}

// --- OpenAI (and any OpenAI-compatible endpoint, incl. Azure OpenAI) ---------

function openAIProvider(cfg) {
  const base = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = cfg.model || 'gpt-4o-mini';
  return {
    name: 'openai',
    model,
    async chat(messages, tools) {
      const payload = { model, messages, temperature: 0.1 };
      if (tools && tools.length) { payload.tools = tools; payload.tool_choice = 'auto'; }
      const resp = await postJSON(`${base}/chat/completions`, {
        Authorization: `Bearer ${cfg.apiKey}`,
      }, payload);
      const choice = resp.choices && resp.choices[0];
      if (!choice) throw new Error('AI provider returned no choices');
      return choice.message; // { role, content, tool_calls? }
    },
  };
}

// --- Ollama (local, OpenAI-compatible chat endpoint) -------------------------

function ollamaProvider(cfg) {
  const base = (cfg.baseUrl || 'http://127.0.0.1:11434/v1').replace(/\/$/, '');
  const model = cfg.model || 'llama3.1';
  return {
    name: 'ollama',
    model,
    async chat(messages, tools) {
      const payload = { model, messages, temperature: 0.1, stream: false };
      if (tools && tools.length) { payload.tools = tools; }
      const resp = await postJSON(`${base}/chat/completions`, {}, payload);
      const choice = resp.choices && resp.choices[0];
      if (!choice) throw new Error('Ollama returned no choices');
      return choice.message;
    },
  };
}

// Future providers — wired so the rest of the app doesn't change.
function notImplemented(name) {
  return { name, model: '', async chat() { throw new Error(`AI provider '${name}' is not implemented yet`); } };
}

/**
 * Build a provider from environment. Returns null when no provider is
 * configured, which lets the agent fall back to heuristic-only investigation.
 *
 *   AI_PROVIDER   openai | ollama | claude | gemini   (default: openai)
 *   OPENAI_API_KEY / OPENAI_MODEL / OPENAI_BASE_URL
 *   OLLAMA_BASE_URL / OLLAMA_MODEL
 */
function createAIProvider(env = process.env) {
  const which = (env.AI_PROVIDER || 'openai').toLowerCase();
  switch (which) {
    case 'openai':
      if (!env.OPENAI_API_KEY) return null;
      return openAIProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, baseUrl: env.OPENAI_BASE_URL });
    case 'ollama':
      return ollamaProvider({ model: env.OLLAMA_MODEL, baseUrl: env.OLLAMA_BASE_URL });
    case 'claude':
      return notImplemented('claude');
    case 'gemini':
      return notImplemented('gemini');
    default:
      return null;
  }
}

module.exports = { createAIProvider, openAIProvider, ollamaProvider };

