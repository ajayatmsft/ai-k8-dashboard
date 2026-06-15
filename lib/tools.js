'use strict';
/*
 * Tool registry.
 * --------------
 * The ONLY surface the AI agent is allowed to act through. Each tool has a
 * name, a human description, a JSON-schema for its arguments, and a handler
 * that runs validated `kubectl` calls. The AI proposes tool calls by name; the
 * backend validates + executes them here and returns structured results.
 *
 * `buildToolRegistry(ctx)` receives the kubectl helpers from server.js so this
 * module stays dependency-free and easy to unit test.
 */

function buildToolRegistry(ctx) {
  const { kubectl, kubectlJSON, nsArgs, validName, age, ensureWritable } = ctx;

  function reqName(label, v) {
    if (!validName(v)) { const e = new Error(`valid ${label} required`); e.status = 400; throw e; }
    return v;
  }

  const tools = [
    {
      name: 'getNamespaces',
      description: 'List all namespaces in the cluster with status and age.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async handler() {
        const data = await kubectlJSON(['get', 'namespaces', '-o', 'json']);
        return { namespaces: data.items.map((i) => ({ name: i.metadata.name, status: i.status && i.status.phase, age: age(i.metadata.creationTimestamp) })) };
      },
    },
    {
      name: 'getDeployments',
      description: 'List deployments in a namespace (or all namespaces). Use to locate a service by name.',
      parameters: { type: 'object', properties: { namespace: { type: 'string', description: 'Namespace, or omit for all.' } } },
      async handler({ namespace } = {}) {
        const data = await kubectlJSON(['get', 'deployments', ...nsArgs(namespace), '-o', 'json']);
        return { items: data.items.map((d) => {
          const s = d.status || {};
          return {
            namespace: d.metadata.namespace, name: d.metadata.name,
            desired: (d.spec && d.spec.replicas) || 0, ready: s.readyReplicas || 0,
            available: s.availableReplicas || 0, updated: s.updatedReplicas || 0,
            unavailable: s.unavailableReplicas || 0, age: age(d.metadata.creationTimestamp),
            images: ((d.spec && d.spec.template.spec.containers) || []).map((c) => c.image),
            selector: (d.spec && d.spec.selector && d.spec.selector.matchLabels) || {},
            conditions: (s.conditions || []).map((c) => ({ type: c.type, status: c.status, reason: c.reason, message: c.message })),
          };
        }) };
      },
    },
    {
      name: 'getDeployment',
      description: 'Get a single deployment by name, including replica health and rollout conditions.',
      parameters: { type: 'object', required: ['namespace', 'name'], properties: { namespace: { type: 'string' }, name: { type: 'string' } } },
      async handler({ namespace, name }) {
        reqName('namespace', namespace); reqName('deployment name', name);
        const d = await kubectlJSON(['get', 'deployment', name, '-n', namespace, '-o', 'json']);
        const s = d.status || {};
        return {
          namespace: d.metadata.namespace, name: d.metadata.name,
          desired: (d.spec && d.spec.replicas) || 0, ready: s.readyReplicas || 0,
          available: s.availableReplicas || 0, unavailable: s.unavailableReplicas || 0,
          age: age(d.metadata.creationTimestamp),
          selector: (d.spec && d.spec.selector && d.spec.selector.matchLabels) || {},
          containers: ((d.spec && d.spec.template.spec.containers) || []).map((c) => ({
            name: c.name, image: c.image, resources: c.resources || {},
            readinessProbe: !!c.readinessProbe, livenessProbe: !!c.livenessProbe,
          })),
          conditions: (s.conditions || []).map((c) => ({ type: c.type, status: c.status, reason: c.reason, message: c.message })),
        };
      },
    },
    {
      name: 'getPods',
      description: 'List pods in a namespace, optionally filtered by label selector (e.g. "app=payment"). Returns phase, readiness, restart counts and container states.',
      parameters: { type: 'object', required: ['namespace'], properties: {
        namespace: { type: 'string' }, selector: { type: 'string', description: 'Label selector like app=foo.' },
      } },
      async handler({ namespace, selector } = {}) {
        const args = ['get', 'pods', ...nsArgs(namespace), '-o', 'json'];
        if (selector) args.push('-l', selector);
        const data = await kubectlJSON(args);
        return { items: data.items.map(summarizePod) };
      },
    },
    {
      name: 'getPod',
      description: 'Get detailed status for one pod: container states, waiting/terminated reasons (CrashLoopBackOff, OOMKilled, ImagePullBackOff), restart counts and conditions.',
      parameters: { type: 'object', required: ['namespace', 'name'], properties: { namespace: { type: 'string' }, name: { type: 'string' } } },
      async handler({ namespace, name }) {
        reqName('namespace', namespace); reqName('pod name', name);
        const p = await kubectlJSON(['get', 'pod', name, '-n', namespace, '-o', 'json']);
        return summarizePod(p, true);
      },
    },
    {
      name: 'getServices',
      description: 'List services in a namespace (type, clusterIP, ports, selector). Useful for connectivity checks.',
      parameters: { type: 'object', properties: { namespace: { type: 'string' } } },
      async handler({ namespace } = {}) {
        const data = await kubectlJSON(['get', 'services', ...nsArgs(namespace), '-o', 'json']);
        return { items: data.items.map((s) => ({
          namespace: s.metadata.namespace, name: s.metadata.name, type: s.spec && s.spec.type,
          clusterIP: s.spec && s.spec.clusterIP, selector: (s.spec && s.spec.selector) || {},
          ports: ((s.spec && s.spec.ports) || []).map((p) => ({ port: p.port, targetPort: p.targetPort, protocol: p.protocol })),
        })) };
      },
    },
    {
      name: 'getEvents',
      description: 'List recent cluster events (newest first), optionally filtered to a named object. Surfaces FailedScheduling, Unhealthy probes, BackOff, OOMKilling, FailedMount, etc.',
      parameters: { type: 'object', properties: {
        namespace: { type: 'string' }, name: { type: 'string', description: 'Filter to events about this object name.' },
      } },
      async handler({ namespace, name } = {}) {
        const data = await kubectlJSON(['get', 'events', ...nsArgs(namespace), '-o', 'json']);
        let items = data.items.map((e) => ({
          namespace: e.metadata.namespace, type: e.type, reason: e.reason,
          object: e.involvedObject && `${e.involvedObject.kind}/${e.involvedObject.name}`,
          objectName: e.involvedObject && e.involvedObject.name,
          message: e.message, count: e.count, lastSeen: e.lastTimestamp || e.eventTime,
        }));
        if (name) items = items.filter((e) => e.objectName && e.objectName.includes(name));
        items.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
        return { items: items.slice(0, 100) };
      },
    },
    {
      name: 'getLogs',
      description: 'Fetch recent log lines for a pod (optionally a container). Set previous=true to read logs from the last crashed container instance — essential for CrashLoopBackOff.',
      parameters: { type: 'object', required: ['namespace', 'pod'], properties: {
        namespace: { type: 'string' }, pod: { type: 'string' }, container: { type: 'string' },
        tail: { type: 'integer', description: 'Lines to fetch (default 200, max 2000).' },
        previous: { type: 'boolean', description: 'Read the previous (crashed) container instance.' },
      } },
      async handler({ namespace, pod, container, tail, previous } = {}) {
        reqName('namespace', namespace); reqName('pod name', pod);
        const args = ['logs', pod, '-n', namespace];
        if (container && validName(container)) args.push('-c', container);
        const n = Math.min(parseInt(tail, 10) || 200, 2000);
        args.push(`--tail=${n}`);
        if (previous === true || previous === 'true') args.push('--previous');
        try {
          const out = await kubectl(args, { timeout: 60000 });
          const lines = out.split('\n').filter(Boolean);
          return { pod, container: container || null, previous: !!previous, lineCount: lines.length, lines: lines.slice(-n) };
        } catch (e) { return { pod, error: e.message, lines: [] }; }
      },
    },
    {
      name: 'getPodMetrics',
      description: 'CPU/memory usage per pod via metrics-server (kubectl top pods). Returns availability=false if metrics-server is absent.',
      parameters: { type: 'object', properties: { namespace: { type: 'string' } } },
      async handler({ namespace } = {}) {
        const args = ['top', 'pods', ...nsArgs(namespace), '--no-headers'];
        try {
          const out = await kubectl(args);
          const rows = out.trim().split('\n').filter(Boolean).map((l) => {
            const c = l.trim().split(/\s+/);
            // all-namespaces => [ns, name, cpu, mem]; single ns => [name, cpu, mem]
            return c.length >= 4 ? { namespace: c[0], pod: c[1], cpu: c[2], memory: c[3] } : { pod: c[0], cpu: c[1], memory: c[2] };
          });
          return { available: true, rows };
        } catch (e) { return { available: false, error: e.message, rows: [] }; }
      },
    },
    {
      name: 'getNodeMetrics',
      description: 'CPU/memory usage per node via metrics-server (kubectl top nodes). Useful for cluster-wide resource exhaustion.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async handler() {
        try {
          const out = await kubectl(['top', 'nodes', '--no-headers']);
          const rows = out.trim().split('\n').filter(Boolean).map((l) => {
            const c = l.trim().split(/\s+/);
            return { node: c[0], cpu: c[1], cpuPct: c[2], memory: c[3], memoryPct: c[4] };
          });
          return { available: true, rows };
        } catch (e) { return { available: false, error: e.message, rows: [] }; }
      },
    },

    // --- safe mutating operations (gated by READ_ONLY) -----------------------
    {
      name: 'restartDeployment',
      description: 'Trigger a rolling restart of a deployment. Mutating — disabled in READ_ONLY mode. Only use when the user explicitly asks to remediate.',
      mutating: true,
      parameters: { type: 'object', required: ['namespace', 'name'], properties: { namespace: { type: 'string' }, name: { type: 'string' } } },
      async handler({ namespace, name }) {
        ensureWritable();
        reqName('namespace', namespace); reqName('deployment name', name);
        ctx.audit('restartDeployment', { namespace, name, via: 'agent' });
        return { output: (await kubectl(['rollout', 'restart', 'deployment', name, '-n', namespace])).trim() };
      },
    },
    {
      name: 'scaleDeployment',
      description: 'Scale a deployment to N replicas. Mutating — disabled in READ_ONLY mode. Only use when the user explicitly asks to remediate.',
      mutating: true,
      parameters: { type: 'object', required: ['namespace', 'name', 'replicas'], properties: {
        namespace: { type: 'string' }, name: { type: 'string' }, replicas: { type: 'integer', minimum: 0, maximum: 1000 },
      } },
      async handler({ namespace, name, replicas }) {
        ensureWritable();
        reqName('namespace', namespace); reqName('deployment name', name);
        const r = parseInt(replicas, 10);
        if (!Number.isInteger(r) || r < 0 || r > 1000) { const e = new Error('replicas must be 0-1000'); e.status = 400; throw e; }
        ctx.audit('scaleDeployment', { namespace, name, replicas: r, via: 'agent' });
        return { output: (await kubectl(['scale', 'deployment', name, '-n', namespace, `--replicas=${r}`])).trim() };
      },
    },
  ];

  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    list: () => tools,
    get: (name) => byName.get(name),
    // OpenAI / Ollama tool schema (function-calling format).
    toOpenAITools: () => tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
  };
}

function summarizePod(p, detailed = false) {
  const cs = (p.status && p.status.containerStatuses) || [];
  const containers = cs.map((c) => {
    const state = c.state || {};
    const cur = state.waiting ? { kind: 'waiting', reason: state.waiting.reason, message: state.waiting.message }
      : state.terminated ? { kind: 'terminated', reason: state.terminated.reason, exitCode: state.terminated.exitCode }
      : state.running ? { kind: 'running', startedAt: state.running.startedAt } : { kind: 'unknown' };
    const last = c.lastState && c.lastState.terminated
      ? { reason: c.lastState.terminated.reason, exitCode: c.lastState.terminated.exitCode } : null;
    return { name: c.name, ready: !!c.ready, restartCount: c.restartCount || 0, image: c.image, state: cur, lastTerminated: last };
  });
  const out = {
    namespace: p.metadata.namespace, name: p.metadata.name,
    phase: (p.status && p.status.phase) || 'Unknown',
    ready: `${containers.filter((c) => c.ready).length}/${containers.length}`,
    restarts: containers.reduce((a, c) => a + c.restartCount, 0),
    node: p.spec && p.spec.nodeName, podIP: p.status && p.status.podIP,
    reason: p.status && p.status.reason, message: p.status && p.status.message,
    containers,
  };
  if (detailed) {
    out.conditions = ((p.status && p.status.conditions) || []).map((c) => ({ type: c.type, status: c.status, reason: c.reason, message: c.message }));
    out.containerNames = ((p.spec && p.spec.containers) || []).map((c) => c.name);
  }
  return out;
}

module.exports = { buildToolRegistry, summarizePod };

