/* k8s-local-dashboard frontend (vanilla JS, no build step) */
'use strict';

// Backend base URL. Empty = same origin (backend serves these files). Set
// window.K8S_DASH_API_BASE before this script loads to host the frontend
// separately (the backend must then set CORS_ORIGIN).
const API_BASE = window.K8S_DASH_API_BASE || '';

const state = {
  ns: 'default',
  view: 'overview',
  readOnly: false,
  namespaces: [],
};

// --- tiny helpers -----------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
};
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function api(name, query = {}, opts = {}) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${API_BASE}/api/${name}${qs ? '?' + qs : ''}`, opts);
  const data = await res.json().catch(() => ({ error: 'bad response' }));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function post(name, body) {
  return api(name, {}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  setTimeout(() => { t.className = 'toast hidden'; }, 4000);
}

function phasePill(phase) {
  const map = { Running: 'green', Succeeded: 'green', Pending: 'yellow', Failed: 'red', Unknown: 'gray' };
  return `<span class="pill ${map[phase] || 'gray'}">${esc(phase)}</span>`;
}
function requireWrite() {
  if (state.readOnly) { toast('READ-ONLY mode: action disabled', 'err'); return false; }
  return true;
}

// --- chrome (topbar / config / tabs / namespace) ----------------------------

async function loadConfig() {
  const kcSel = $('#kubeconfigSelect');
  const ctxSel = $('#contextSelect');
  try {
    const cfg = await api('config');
    state.readOnly = cfg.readOnly;
    state.execEnabled = cfg.execEnabled !== false;
    $('#roBanner').classList.toggle('hidden', !cfg.readOnly);

    kcSel.innerHTML = '';
    kcSel.appendChild(el('option', { value: '' }, '(default kubeconfig)'));
    for (const p of cfg.kubeconfigs) kcSel.appendChild(el('option', { value: p }, shortPath(p)));
    if (cfg.kubeconfig && !cfg.kubeconfigs.includes(cfg.kubeconfig)) {
      kcSel.appendChild(el('option', { value: cfg.kubeconfig }, shortPath(cfg.kubeconfig)));
    }
    kcSel.value = cfg.kubeconfig || '';

    ctxSel.innerHTML = '';
    for (const c of cfg.contexts) ctxSel.appendChild(el('option', { value: c }, c));
    if (cfg.context) ctxSel.value = cfg.context;
  } catch (e) {
    kcSel.innerHTML = '<option value="">(default)</option>';
  }
}
function shortPath(p) {
  const parts = p.split(/[\\/]/);
  return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : p;
}

async function applyConfig(patch, msg) {
  const info = $('#ctxInfo');
  info.textContent = 'switching…'; info.className = 'ctx';
  try {
    const r = await post('setConfig', patch);
    if (!r.ok) { info.textContent = 'error: ' + (r.error || 'unknown'); info.className = 'ctx err'; toast(r.error || 'switch failed', 'err'); return; }
    if (msg) toast(msg, 'ok');
    await Promise.all([loadConfig(), loadHealth(), loadNamespaces()]);
    await render();
  } catch (e) { info.textContent = e.message; info.className = 'ctx err'; toast(e.message, 'err'); }
}
function shortPath(p) { // kept for potential future use
  const parts = p.split(/[\\/]/);
  return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : p;
}
// eslint-disable-next-line no-unused-vars
async function applyConfig(patch, msg) {
  // Legacy local-kubeconfig switch; no longer wired up (auth is always on).
  const info = $('#ctxInfo');
  info.textContent = 'switching…'; info.className = 'ctx';
  try {
    const r = await post('setConfig', patch);
    if (!r.ok) { info.textContent = 'error: ' + (r.error || 'unknown'); info.className = 'ctx err'; toast(r.error || 'switch failed', 'err'); return; }
    if (msg) toast(msg, 'ok');
    await Promise.all([loadConfig(), loadHealth(), loadNamespaces()]);
    await render();
  } catch (e) { info.textContent = e.message; info.className = 'ctx err'; toast(e.message, 'err'); }
}

async function loadHealth() {
  const info = $('#ctxInfo');
  try {
    const h = await api('health');
    info.textContent = `${h.context}  •  ${h.server}`;
    info.className = 'ctx ok';
    info.title = `${h.context}\n${h.server}`;
  } catch (e) {
    info.textContent = 'kubectl error: ' + e.message;
    info.className = 'ctx err';
  }
}

async function loadNamespaces() {
  const sel = $('#nsSelect');
  try {
    const { namespaces } = await api('namespaces');
    state.namespaces = namespaces;
    const prev = state.ns;
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '_all' }, 'All namespaces'));
    for (const n of namespaces) sel.appendChild(el('option', { value: n.name }, n.name));
    // Prefer last selection; otherwise default to "default" namespace if present; else "_all".
    let next;
    if (prev && (prev === '_all' || namespaces.some((n) => n.name === prev))) next = prev;
    else if (namespaces.some((n) => n.name === 'default')) next = 'default';
    else next = '_all';
    sel.value = next;
    state.ns = sel.value;
  } catch (e) {
    sel.innerHTML = '<option value="_all">All namespaces</option>';
  }
}

function setupChrome() {
  $('#nsSelect').addEventListener('change', (e) => { state.ns = e.target.value; render(); });
  $('#refreshBtn').addEventListener('click', render);
  $('#kubeconfigSelect').addEventListener('change', (e) => applyConfig({ kubeconfig: e.target.value }, 'Kubeconfig switched'));
  $('#kubeconfigBrowse').addEventListener('click', () => {
    const p = prompt('Enter full path to a kubeconfig file:');
    if (p) applyConfig({ kubeconfig: p.trim() }, 'Kubeconfig switched');
  });
  $('#contextSelect').addEventListener('change', (e) => applyConfig({ context: e.target.value }, 'Context switched'));
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    for (const b of $('#tabs').querySelectorAll('button')) b.classList.toggle('active', b === btn);
    state.view = btn.dataset.view;
    document.body.classList.remove('sidebar-open'); // close drawer on mobile
    render();
  });
  const toggle = $('#sidebarToggle');
  if (toggle) toggle.addEventListener('click', () => {
    // Small screens use a slide-in drawer; large screens collapse the rail.
    if (window.matchMedia('(max-width: 860px)').matches) document.body.classList.toggle('sidebar-open');
    else document.body.classList.toggle('sidebar-collapsed');
  });
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
}

// --- views ------------------------------------------------------------------

const content = () => $('#content');
// Animated spinner with contextual text so the user always knows work is happening.
function spinner(text = 'Loading…') { return el('div', { class: 'spinner' }, text); }
function setLoading(text) { const c = content(); c.innerHTML = ''; c.appendChild(spinner(text)); }
function setError(e) { content().innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; }

async function render() {
  stopStream();
  setLoading();
  try { await views[state.view](); }
  catch (e) { setError(e); }
}

const views = {
  async overview() {
    const o = await api('overview', { ns: state.ns });
    const c = content();
    c.innerHTML = '';
    const cards = el('div', { class: 'cards' });
    const card = (label, value) => el('div', { class: 'card' }, [el('div', { class: 'label' }, label), el('div', { class: 'value' }, String(value))]);
    cards.append(
      card('Pods', o.totalPods),
      card('Running', o.phases.Running || 0),
      card('Pending', o.phases.Pending || 0),
      card('Failed', (o.phases.Failed || 0) + (o.phases.Unknown || 0)),
      card('Containers Ready', `${o.containersReady}/${o.containersTotal}`),
      card('Restarts', o.restarts),
      card('Nodes', o.nodes.length),
    );
    c.appendChild(cards);

    if (o.nodes.length) {
      const rows = o.nodes.map((n) => `<tr>
        <td class="mono">${esc(n.name)}</td>
        <td>${n.ready ? '<span class="pill green">Ready</span>' : '<span class="pill red">NotReady</span>'}</td>
        <td class="mono">${esc(n.version || '')}</td>
        <td class="mono">${n.usage ? esc(`${n.usage.cpu} (${n.usage.cpuPct})`) : '<span class="muted">—</span>'}</td>
        <td class="mono">${n.usage ? esc(`${n.usage.mem} (${n.usage.memPct})`) : '<span class="muted">—</span>'}</td>
      </tr>`).join('');
      c.appendChild(el('h3', {}, o.metrics ? 'Nodes (live usage)' : 'Nodes'));
      c.appendChild(el('table', { html: `<thead><tr><th>Name</th><th>Status</th><th>Version</th><th>CPU</th><th>Memory</th></tr></thead><tbody>${rows}</tbody>` }));
      if (!o.metrics) c.appendChild(el('div', { class: 'muted', style: 'margin-top:8px' }, 'metrics-server not detected — CPU/Memory unavailable.'));
    }
  },

  async health() { return renderHealth(); },

  async nodepools() { return renderNodePools(); },

  async deployments() {
    const { items } = await api('deployments', { ns: state.ns });
    const c = content();
    c.innerHTML = '';
    c.appendChild(toolbar('Filter deployments by name or image…', 'deployTable', {
      filters: [{ label: 'Namespace', col: 0, values: nsFilterValues(), all: 'All namespaces' }],
    }));
    if (!items.length) { c.appendChild(el('div', { class: 'empty' }, 'No deployments')); return; }
    const rows = items.map((d) => {
      const healthy = d.ready === d.desired && d.desired > 0;
      const pill = `<span class="pill ${healthy ? 'green' : 'yellow'}">${d.ready}/${d.desired}</span>`;
      return `<tr>
        <td class="mono">${esc(d.namespace)}</td>
        <td class="mono"><a class="link" data-act="manifest" data-type="deployment" data-ns="${esc(d.namespace)}" data-name="${esc(d.name)}">${esc(d.name)}</a></td>
        <td>${pill}</td>
        <td>${d.available}</td>
        <td>${d.images.map((i) => `<span class="tag">${esc(i)}</span>`).join('')}</td>
        <td>${esc(d.age)}</td>
        <td class="row-actions">
          <button data-act="describe" data-type="deployment" data-ns="${esc(d.namespace)}" data-name="${esc(d.name)}">Describe</button>
          <button data-act="edit" data-type="deployment" data-ns="${esc(d.namespace)}" data-name="${esc(d.name)}">Edit</button>
          <button data-act="logs-agg" data-ns="${esc(d.namespace)}" data-name="${esc(d.name)}">Logs</button>
          <button data-act="scale" data-ns="${esc(d.namespace)}" data-name="${esc(d.name)}" data-replicas="${d.desired}">Scale</button>
          <button data-act="restart" data-ns="${esc(d.namespace)}" data-name="${esc(d.name)}">Restart</button>
        </td></tr>`;
    }).join('');
    const table = el('table', { id: 'deployTable', html: `<thead><tr><th>Namespace</th><th>Name</th><th>Ready</th><th>Avail</th><th>Images</th><th>Age</th><th>Actions</th></tr></thead><tbody>${rows}</tbody>` });
    table.addEventListener('click', onTableAction);
    c.appendChild(table);
  },

  async pods() {
    const { items } = await api('pods', { ns: state.ns });
    const c = content();
    c.innerHTML = '';
    const phases = [...new Set(items.map((p) => p.phase).filter(Boolean))].sort();
    c.appendChild(toolbar('Filter pods by name, node or IP…', 'podTable', {
      filters: [
        { label: 'Namespace', col: 0, values: nsFilterValues(), all: 'All namespaces' },
        { label: 'Phase', col: 2, values: phases, all: 'All phases' },
      ],
    }));
    if (!items.length) { c.appendChild(el('div', { class: 'empty' }, 'No pods')); return; }
    const rows = items.map((p) => `<tr>
      <td class="mono">${esc(p.namespace)}</td>
      <td class="mono"><a class="link" data-act="manifest" data-type="pod" data-ns="${esc(p.namespace)}" data-name="${esc(p.name)}">${esc(p.name)}</a></td>
      <td>${phasePill(p.phase)}</td>
      <td>${esc(p.ready)}</td>
      <td>${p.restarts > 0 ? `<span class="pill ${p.restarts > 5 ? 'red' : 'yellow'}">${p.restarts}</span>` : '0'}</td>
      <td class="mono">${esc(p.node || '')}</td>
      <td class="mono">${esc(p.podIP || '')}</td>
      <td>${esc(p.age)}</td>
      <td class="row-actions">
        <button data-act="logs-pod" data-ns="${esc(p.namespace)}" data-name="${esc(p.name)}">Logs</button>
        <button data-act="describe" data-type="pod" data-ns="${esc(p.namespace)}" data-name="${esc(p.name)}">Describe</button>
        ${state.execEnabled ? `<button data-act="exec" data-ns="${esc(p.namespace)}" data-name="${esc(p.name)}" data-containers="${esc(p.containers.join(','))}">Debug</button>` : ''}
        <button data-act="delete-pod" data-ns="${esc(p.namespace)}" data-name="${esc(p.name)}">Delete</button>
      </td></tr>`).join('');
    const table = el('table', { id: 'podTable', html: `<thead><tr><th>Namespace</th><th>Name</th><th>Phase</th><th>Ready</th><th>Restarts</th><th>Node</th><th>IP</th><th>Age</th><th>Actions</th></tr></thead><tbody>${rows}</tbody>` });
    table.addEventListener('click', onTableAction);
    c.appendChild(table);
  },

  async helm() {
    const { items, source, error } = await api('helm', { ns: state.ns });
    const c = content();
    c.innerHTML = '';
    c.appendChild(toolbar('Filter releases…', 'helmTable'));
    const note = source === 'helm'
      ? 'Source: helm binary'
      : source === 'secrets'
        ? 'Source: helm release secrets (helm binary not found — install helm for chart/values detail)'
        : 'Helm releases could not be listed';
    c.appendChild(el('div', { class: 'muted', style: 'margin:4px 0 8px' }, note + (error ? ' — ' + error : '')));
    if (!items.length) { c.appendChild(el('div', { class: 'empty' }, 'No Helm releases found')); return; }
    const statusPill = (s) => {
      const map = { deployed: 'green', superseded: 'gray', failed: 'red', 'pending-install': 'yellow', 'pending-upgrade': 'yellow', uninstalling: 'yellow' };
      return `<span class="pill ${map[String(s).toLowerCase()] || 'gray'}">${esc(s || '?')}</span>`;
    };
    const rows = items.map((r) => `<tr>
      <td class="mono">${esc(r.namespace)}</td>
      <td class="mono">${esc(r.name)}</td>
      <td>${statusPill(r.status)}</td>
      <td>${esc(r.revision)}</td>
      <td>${r.chart ? `<span class="tag">${esc(r.chart)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="mono">${esc(r.appVersion || '—')}</td>
      <td class="mono">${esc(r.updated ? new Date(r.updated).toLocaleString() : '')}</td>
      <td class="row-actions">
        <button data-act="helm-detail" data-ns="${esc(r.namespace)}" data-name="${esc(r.name)}">Details</button>
      </td></tr>`).join('');
    const table = el('table', { id: 'helmTable', html: `<thead><tr><th>Namespace</th><th>Release</th><th>Status</th><th>Rev</th><th>Chart</th><th>App ver</th><th>Updated</th><th></th></tr></thead><tbody>${rows}</tbody>` });
    table.addEventListener('click', onTableAction);
    c.appendChild(table);
  },

  async addons() {
    const { detected, crdGroups, systemWorkloads } = await api('addons');
    const c = content();
    c.innerHTML = '';

    c.appendChild(el('h3', {}, 'Detected add-ons'));
    if (!detected.length) {
      c.appendChild(el('div', { class: 'empty' }, 'No well-known add-ons detected'));
    } else {
      const cards = el('div', { class: 'cards' });
      for (const a of detected) {
        cards.appendChild(el('div', { class: 'card' }, [
          el('div', { class: 'label' }, a.category),
          el('div', { class: 'value', style: 'font-size:1rem' }, a.name),
          el('div', { class: 'muted', style: 'font-size:.75rem;margin-top:4px' }, (a.evidence || []).join(' · ')),
        ]));
      }
      c.appendChild(cards);
    }

    c.appendChild(el('h3', {}, `System workloads (${systemWorkloads.length})`));
    if (systemWorkloads.length) {
      const rows = systemWorkloads.map((w) => `<tr>
        <td class="mono">${esc(w.kind)}</td>
        <td class="mono">${esc(w.namespace)}</td>
        <td class="mono">${esc(w.name)}</td>
        <td>${(w.images || []).map((i) => `<span class="tag">${esc(i)}</span>`).join('')}</td></tr>`).join('');
      c.appendChild(el('table', { id: 'addonWlTable', html: `<thead><tr><th>Kind</th><th>Namespace</th><th>Name</th><th>Images</th></tr></thead><tbody>${rows}</tbody>` }));
    }

    c.appendChild(el('h3', {}, `Installed CRD API groups (${crdGroups.length})`));
    if (crdGroups.length) {
      const rows = crdGroups.map((g) => `<tr><td class="mono">${esc(g.group)}</td><td>${g.count}</td></tr>`).join('');
      c.appendChild(el('table', { html: `<thead><tr><th>API group</th><th>CRDs</th></tr></thead><tbody>${rows}</tbody>` }));
    } else {
      c.appendChild(el('div', { class: 'muted' }, 'No custom resource definitions found.'));
    }
  },

  async identities() {
    const data = await api('identities', { ns: state.ns });
    const c = content();
    c.innerHTML = '';

    c.appendChild(el('h3', {}, `Pods using a managed identity (${data.workloadIdentity.length})`));
    if (data.workloadIdentity.length) {
      const rows = data.workloadIdentity.map((w) => `<tr>
        <td class="mono">${esc(w.namespace)}</td>
        <td class="mono">${esc(w.pod)}</td>
        <td class="mono">${esc(w.serviceAccount)}</td>
        <td>${w.usesWorkloadIdentity ? '<span class="pill green">workload-identity</span>' : '<span class="muted">—</span>'}</td>
        <td class="mono">${w.identity ? esc(w.identity.azureClientId || w.identity.awsRoleArn || w.identity.gcpServiceAccount || JSON.stringify(w.identity)) : '<span class="muted">—</span>'}</td></tr>`).join('');
      c.appendChild(el('table', { html: `<thead><tr><th>Namespace</th><th>Pod</th><th>ServiceAccount</th><th>Workload Identity</th><th>Identity</th></tr></thead><tbody>${rows}</tbody>` }));
    } else {
      c.appendChild(el('div', { class: 'empty' }, 'No pods with managed identities detected'));
    }

    c.appendChild(el('h3', {}, `Service accounts with cloud identity (${data.serviceAccountsWithIdentity.length})`));
    if (data.serviceAccountsWithIdentity.length) {
      const rows = data.serviceAccountsWithIdentity.map((s) => `<tr>
        <td class="mono">${esc(s.namespace)}</td>
        <td class="mono">${esc(s.name)}</td>
        <td class="mono">${esc(Object.entries(s.identity).map(([k, v]) => `${k}=${v}`).join('  '))}</td></tr>`).join('');
      c.appendChild(el('table', { html: `<thead><tr><th>Namespace</th><th>ServiceAccount</th><th>Identity annotations</th></tr></thead><tbody>${rows}</tbody>` }));
    } else {
      c.appendChild(el('div', { class: 'muted' }, 'No service accounts annotated with a cloud identity.'));
    }

    if ((data.azureIdentities || []).length) {
      c.appendChild(el('h3', {}, `AzureIdentity resources (AAD Pod Identity) (${data.azureIdentities.length})`));
      const rows = data.azureIdentities.map((a) => `<tr>
        <td class="mono">${esc(a.namespace)}</td>
        <td class="mono">${esc(a.name)}</td>
        <td class="mono">${esc(a.clientId || '')}</td>
        <td class="mono">${esc(a.type === 0 ? 'UserAssignedMSI' : a.type === 1 ? 'ServicePrincipal' : (a.type ?? ''))}</td></tr>`).join('');
      c.appendChild(el('table', { html: `<thead><tr><th>Namespace</th><th>Name</th><th>Client ID</th><th>Type</th></tr></thead><tbody>${rows}</tbody>` }));
    }

    if ((data.podIdentityBindings || []).length) {
      c.appendChild(el('h3', {}, `Pods bound via aadpodidbinding (${data.podIdentityBindings.length})`));
      const rows = data.podIdentityBindings.map((b) => `<tr>
        <td class="mono">${esc(b.namespace)}</td>
        <td class="mono">${esc(b.pod)}</td>
        <td class="mono">${esc(b.binding)}</td></tr>`).join('');
      c.appendChild(el('table', { html: `<thead><tr><th>Namespace</th><th>Pod</th><th>Binding</th></tr></thead><tbody>${rows}</tbody>` }));
    }
  },

  async serviceaccounts() {
    const { items } = await api('serviceAccounts', { ns: state.ns });
    const c = content();
    c.innerHTML = '';
    c.appendChild(toolbar('Filter service accounts…', 'saTable'));
    if (!items.length) { c.appendChild(el('div', { class: 'empty' }, 'No service accounts')); return; }
    const rows = items.map((s) => {
      const idStr = s.hasIdentity ? Object.entries(s.identity).map(([k, v]) => `${k}=${v}`).join('  ') : '';
      return `<tr>
        <td class="mono">${esc(s.namespace)}</td>
        <td class="mono">${esc(s.name)}</td>
        <td>${s.hasIdentity ? `<span class="pill green" title="${esc(idStr)}">linked</span>` : '<span class="muted">—</span>'}</td>
        <td class="mono">${esc(idStr || '')}</td>
        <td>${s.automount ? '<span class="pill yellow">on</span>' : '<span class="pill gray">off</span>'}</td>
        <td>${(s.secrets || []).map((k) => `<span class="tag">${esc(k)}</span>`).join('') || '<span class="muted">—</span>'}</td>
        <td>${esc(s.age)}</td></tr>`;
    }).join('');
    const table = el('table', { id: 'saTable', html: `<thead><tr><th>Namespace</th><th>Name</th><th>Identity</th><th>Annotations</th><th>Automount</th><th>Secrets</th><th>Age</th></tr></thead><tbody>${rows}</tbody>` });
    c.appendChild(table);
  },

  async logs() {
    const c = content();
    c.innerHTML = '';
    let pods = [];
    try { pods = (await api('pods', { ns: state.ns })).items; } catch (_) {}

    // ---- header (selected pod summary + change-pod toggle) ----
    const selLabel = el('span', { class: 'mono' }, '— no pod selected —');
    const changeBtn = el('button', {}, 'Change pod');
    const header = el('div', { class: 'toolbar logs-header' }, [
      el('span', { class: 'muted' }, 'Pod:'), selLabel, changeBtn,
    ]);

    // ---- pod picker (filter + table). Collapsible. ----
    const picker = el('div', { class: 'logs-picker' });
    const podPhases = [...new Set(pods.map((p) => p.phase).filter(Boolean))].sort();
    const podNamespaces = [...new Set(pods.map((p) => p.namespace).filter(Boolean))].sort();
    picker.appendChild(toolbar('Filter pods by name or container…', 'logPodTable', {
      filters: [
        { label: 'Namespace', col: 0, values: podNamespaces, all: 'All namespaces' },
        { label: 'Phase', col: 2, values: podPhases, all: 'All phases' },
      ],
    }));

    if (!pods.length) {
      picker.appendChild(el('div', { class: 'empty' }, 'No pods'));
    }
    const rows = pods.map((p) => `<tr data-ns="${esc(p.namespace)}" data-name="${esc(p.name)}" data-containers="${esc(p.containers.join(','))}">
      <td class="mono">${esc(p.namespace)}</td>
      <td class="mono">${esc(p.name)}</td>
      <td>${phasePill(p.phase)}</td>
      <td>${esc(p.ready)}</td>
      <td class="mono">${esc(p.containers.join(', '))}</td>
      <td>${esc(p.age)}</td></tr>`).join('');
    const table = el('table', { id: 'logPodTable', class: 'selectable', html: `<thead><tr><th>Namespace</th><th>Name</th><th>Phase</th><th>Ready</th><th>Containers</th><th>Age</th></tr></thead><tbody>${rows}</tbody>` });
    if (pods.length) picker.appendChild(table);

    // ---- controls + log viewport ----
    const contSel = el('select', { id: 'logContainer' });
    const search = el('input', { type: 'text', id: 'logSearch', placeholder: 'Search in logs…', class: 'grow', value: logCtx.search || '' });
    const tail = el('input', { type: 'text', id: 'logTail', value: '500', style: 'width:70px', title: 'Tail lines' });
    const prev = el('label', {}, [el('input', { type: 'checkbox', id: 'logPrev' }), ' previous']);
    const goBtn = el('button', { class: 'primary' }, 'Reload');
    const controls = el('div', { class: 'toolbar logs-controls hidden' }, [
      el('span', { class: 'muted' }, 'Container:'), contSel, search, tail, prev, goBtn,
    ]);
    const box = el('div', { class: 'logbox logbox-tall', id: 'logBox' }, 'Pick a pod to view its logs.');

    c.append(header, picker, controls, box);

    // ---- selection / collapse logic ----
    let selected = null;
    function showPicker(show) {
      picker.classList.toggle('hidden', !show);
      changeBtn.classList.toggle('hidden', show);
      controls.classList.toggle('hidden', show || !selected);
    }
    function fillContainers() {
      const cs = (selected && selected.containers) || [];
      contSel.innerHTML = '';
      contSel.appendChild(el('option', { value: '' }, cs.length > 1 ? 'all / first' : '(default)'));
      for (const cn of cs) contSel.appendChild(el('option', { value: cn }, cn));
      if (logCtx.container && cs.includes(logCtx.container)) contSel.value = logCtx.container;
    }
    function selectRow(tr) {
      if (!tr) return;
      for (const r of table.tBodies[0].rows) r.classList.toggle('selected', r === tr);
      selected = {
        ns: tr.dataset.ns,
        name: tr.dataset.name,
        containers: (tr.dataset.containers || '').split(',').filter(Boolean),
      };
      selLabel.textContent = `${selected.ns}/${selected.name}`;
      fillContainers();
      showPicker(false); // collapse the list once a pod is chosen
    }

    table.addEventListener('click', (e) => {
      const tr = e.target.closest('tbody tr');
      if (!tr) return;
      selectRow(tr);
      load();
    });
    changeBtn.addEventListener('click', () => showPicker(true));

    async function load() {
      if (!selected) { box.textContent = 'Pick a pod first.'; return; }
      const { ns, name } = selected;
      logCtx.ns = ns; logCtx.pod = name; logCtx.container = contSel.value; logCtx.search = search.value;
      box.innerHTML = ''; box.appendChild(spinner('Loading logs…'));
      try {
        const r = await api('logs', { ns, pod: name, container: contSel.value, tail: tail.value || '500', search: search.value, previous: $('#logPrev').checked ? 'true' : 'false' });
        if (r.error) { box.textContent = r.error; return; }
        renderLogLines(box, r.lines.map((l) => ({ line: l })), search.value, r.truncated);
      } catch (e) { box.textContent = e.message; }
    }
    goBtn.addEventListener('click', load);
    contSel.addEventListener('change', load);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });

    // ---- initial state ----
    if (logCtx.pod && pods.length) {
      const tr = [...table.tBodies[0].rows].find((r) => r.dataset.ns === logCtx.ns && r.dataset.name === logCtx.pod);
      if (tr) { selectRow(tr); load(); return; }
    }
    showPicker(true); // no selection yet — show the picker
  },

  async aggregate() { renderAggregate(); },

  async bulk() { renderBulk(); },

  async assistant() { renderAssistant(); },

  async secrets() {
    const { items } = await api('secrets', { ns: state.ns });
    const c = content();
    c.innerHTML = '';
    const types = [...new Set(items.map((s) => s.type).filter(Boolean))].sort();
    c.appendChild(toolbar('Filter secrets by name or key…', 'secretTable', {
      filters: [
        { label: 'Namespace', col: 0, values: nsFilterValues(), all: 'All namespaces' },
        { label: 'Type', col: 2, values: types, all: 'All types' },
      ],
    }));
    if (!items.length) { c.appendChild(el('div', { class: 'empty' }, 'No secrets')); return; }
    const rows = items.map((s) => `<tr>
      <td class="mono">${esc(s.namespace)}</td>
      <td class="mono"><a class="link" data-act="secret" data-ns="${esc(s.namespace)}" data-name="${esc(s.name)}">${esc(s.name)}</a></td>
      <td class="mono">${esc(s.type)}</td>
      <td>${s.keys.map((k) => `<span class="tag">${esc(k)}</span>`).join('')}</td>
      <td>${esc(s.age)}</td></tr>`).join('');
    const table = el('table', { id: 'secretTable', html: `<thead><tr><th>Namespace</th><th>Name</th><th>Type</th><th>Keys</th><th>Age</th></tr></thead><tbody>${rows}</tbody>` });
    table.addEventListener('click', onTableAction);
    c.appendChild(table);
  },

  async events() {
    const { items } = await api('events', { ns: state.ns });
    const c = content();
    c.innerHTML = '';
    c.appendChild(toolbar('Filter events by object, reason or message…', 'evtTable', {
      filters: [
        { label: 'Type', col: 0, values: ['Warning', 'Normal'], all: 'All types' },
        { label: 'Namespace', col: 1, values: nsFilterValues(), all: 'All namespaces' },
      ],
    }));
    if (!items.length) { c.appendChild(el('div', { class: 'empty' }, 'No events')); return; }
    const rows = items.map((e) => `<tr>
      <td>${e.type === 'Warning' ? '<span class="pill yellow">Warning</span>' : '<span class="pill gray">Normal</span>'}</td>
      <td class="mono">${esc(e.namespace || '')}</td>
      <td class="mono">${esc(e.object || '')}</td>
      <td>${esc(e.reason || '')}</td>
      <td>${esc(e.message || '')}</td>
      <td>${e.count || 1}</td></tr>`).join('');
    const table = el('table', { id: 'evtTable', html: `<thead><tr><th>Type</th><th>Namespace</th><th>Object</th><th>Reason</th><th>Message</th><th>#</th></tr></thead><tbody>${rows}</tbody>` });
    c.appendChild(table);
  },
};

// --- aggregate logs (snapshot + live tail) ----------------------------------

const logCtx = {};
const aggState = { ns: '', regex: '', selector: '', search: '', mode: 'name' };
let evtSource = null;

function stopStream() {
  if (evtSource) { evtSource.close(); evtSource = null; }
}

function renderAggregate(prefill) {
  stopStream();
  if (prefill) Object.assign(aggState, prefill);
  const c = content();
  c.innerHTML = '';

  const matcher = el('input', { type: 'text', class: 'grow', placeholder: 'Name regex (e.g. extension) or label selector', value: aggState.mode === 'label' ? aggState.selector : aggState.regex });
  const modeSel = el('select', {});
  modeSel.appendChild(el('option', { value: 'name' }, 'Name regex'));
  modeSel.appendChild(el('option', { value: 'label' }, 'Label selector'));
  modeSel.value = aggState.mode;
  const search = el('input', { type: 'text', placeholder: 'Highlight/filter…', value: aggState.search || '', style: 'min-width:160px' });
  const tail = el('input', { type: 'text', value: '100', style: 'width:60px', title: 'Tail lines per pod' });
  const snapBtn = el('button', {}, 'Snapshot');
  const liveBtn = el('button', { class: 'primary' }, '▶ Live tail');
  const stopBtn = el('button', {}, '■ Stop');
  const dlBtn = el('button', {}, '⤓ Download');
  const status = el('span', { class: 'muted', id: 'aggStatus' }, '');

  let nsValue = aggState.ns || state.ns;
  const nsSel = el('select', {});
  nsSel.appendChild(el('option', { value: '_all' }, 'All'));
  for (const n of state.namespaces) nsSel.appendChild(el('option', { value: n.name }, n.name));
  nsSel.value = nsValue;
  nsSel.addEventListener('change', () => { nsValue = nsSel.value; });

  const bar1 = el('div', { class: 'toolbar' }, [el('label', {}, 'Namespace: '), nsSel, modeSel, matcher, tail]);
  const bar2 = el('div', { class: 'toolbar' }, [search, snapBtn, liveBtn, stopBtn, dlBtn, status]);
  const box = el('div', { class: 'logbox', id: 'aggBox' }, 'Enter a matcher (e.g. "extension") and click Snapshot or Live tail.');
  c.append(bar1, bar2, box);

  function readFilter() {
    aggState.mode = modeSel.value;
    aggState.ns = nsValue;
    aggState.search = search.value;
    const q = { ns: nsValue, tail: tail.value || '100', search: search.value };
    if (modeSel.value === 'label') { aggState.selector = matcher.value; if (matcher.value) q.selector = matcher.value; }
    else { aggState.regex = matcher.value; if (matcher.value) q.regex = matcher.value; }
    return q;
  }

  let lastLines = [];
  async function snapshot() {
    stopStream();
    const q = readFilter();
    if (!q.regex && !q.selector) { box.textContent = 'Enter a matcher first.'; return; }
    box.innerHTML = ''; box.appendChild(spinner('Collecting logs across matching pods…'));
    try {
      const r = await api('aggregateLogs', q);
      status.textContent = `${r.podCount} pod(s)${r.capped ? ' (capped to 60)' : ''}`;
      lastLines = r.lines;
      renderLogLines(box, r.lines, search.value, r.truncated, true);
    } catch (e) { box.textContent = e.message; }
  }

  function live() {
    stopStream();
    const q = readFilter();
    if (!q.regex && !q.selector) { box.textContent = 'Enter a matcher first.'; return; }
    box.innerHTML = '';
    lastLines = [];
    status.textContent = 'connecting…';
    const es = new EventSource(API_BASE + '/api/streamLogs?' + new URLSearchParams(q).toString());
    evtSource = es;
    const colors = {};
    const colorFor = (pod) => (colors[pod] || (colors[pod] = `hsl(${Math.abs(hash(pod)) % 360} 70% 65%)`));
    es.addEventListener('meta', (ev) => {
      const m = JSON.parse(ev.data);
      status.textContent = `live • ${m.streaming || 0}/${m.podCount || 0} pod(s)${m.capped ? ' (capped)' : ''}`;
      if (m.message) box.appendChild(el('div', { class: 'muted' }, m.message));
    });
    es.addEventListener('log', (ev) => {
      const d = JSON.parse(ev.data);
      lastLines.push({ pod: d.pod, line: d.line });
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      const row = el('div', { class: 'logline' }, [
        el('span', { class: 'pfx', style: `color:${colorFor(d.pod)}` }, d.pod + ' '),
        document.createTextNode(d.line),
      ]);
      const n = (search.value || '').toLowerCase();
      if (n && d.line.toLowerCase().includes(n)) row.classList.add('hit');
      box.appendChild(row);
      if (box.childElementCount > 6000) box.removeChild(box.firstChild);
      if (atBottom) box.scrollTop = box.scrollHeight;
    });
    es.addEventListener('warn', (ev) => { const d = JSON.parse(ev.data); if (d.line) box.appendChild(el('div', { class: 'muted' }, `[${d.pod}] ${d.line}`)); });
    es.onerror = () => { status.textContent = 'stream closed'; };
  }

  snapBtn.addEventListener('click', snapshot);
  liveBtn.addEventListener('click', live);
  stopBtn.addEventListener('click', () => { stopStream(); status.textContent = 'stopped'; });
  dlBtn.addEventListener('click', () => downloadLog(lastLines, aggState));
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') snapshot(); });

  if ((aggState.regex || aggState.selector) && prefill) snapshot();
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0; return h; }

// --- AI Assistant (investigation chat + root-cause analysis) ----------------

const asstState = { question: '', running: false, status: null };

async function renderAssistant() {
  stopStream();
  const c = content();
  c.innerHTML = '';

  // Provider / storage status line.
  const statusLine = el('div', { class: 'asst-status muted' }, 'checking AI status…');
  api('aiStatus').then((s) => {
    asstState.status = s;
    const prov = s.aiConfigured ? `${s.aiProvider} · ${esc(s.aiModel)}` : 'heuristic engine (no AI key set)';
    statusLine.innerHTML = `Mode: <b>${esc(s.mode)}</b> &nbsp;•&nbsp; Provider: <b>${esc(prov)}</b> &nbsp;•&nbsp; Storage: <b>${esc(s.storage.mode)}</b>${s.readOnly ? ' &nbsp;•&nbsp; <span class="pill yellow">READ-ONLY</span>' : ''}`;
  }).catch(() => { statusLine.textContent = 'AI status unavailable'; });

  const input = el('input', { type: 'text', class: 'grow', placeholder: 'Ask: "Investigate payment-service" · "Why is checkout failing?" · "Find pods restarting frequently"', value: asstState.question || '' });
  const runBtn = el('button', { class: 'primary' }, '🔎 Investigate');
  const examples = el('div', { class: 'asst-examples' }, [
    'Investigate payment-service', 'Why is checkout failing?', 'Show me unhealthy deployments', 'Find pods restarting frequently',
  ].map((q) => el('button', { class: 'chip', onclick: () => { input.value = q; run(); } }, q)));

  const bar = el('div', { class: 'toolbar' }, [input, runBtn]);
  const steps = el('div', { class: 'asst-steps', id: 'asstSteps' });
  const reportBox = el('div', { class: 'asst-report', id: 'asstReport' });
  const historyBox = el('div', { class: 'asst-history', id: 'asstHistory' });

  const layout = el('div', { class: 'asst-grid' }, [
    el('div', { class: 'asst-main' }, [bar, examples, steps, reportBox]),
    el('div', { class: 'asst-side' }, [el('h3', {}, 'Investigation history'), historyBox]),
  ]);
  c.append(statusLine, layout);

  loadHistory(historyBox, reportBox);

  function run() {
    const q = input.value.trim();
    if (!q) { toast('Enter a question', 'err'); return; }
    asstState.question = q;
    investigate(q, steps, reportBox, historyBox, runBtn);
  }
  runBtn.addEventListener('click', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
}

function investigate(question, steps, reportBox, historyBox, runBtn) {
  stopStream();
  steps.innerHTML = '';
  reportBox.innerHTML = '';
  runBtn.disabled = true; runBtn.textContent = '… investigating';

  const addStep = (text, kind) => {
    const row = el('div', { class: 'step ' + (kind || '') }, [el('span', { class: 'dot' }), el('span', {}, text)]);
    steps.appendChild(row);
    steps.scrollTop = steps.scrollHeight;
    return row;
  };
  const q = { question, ns: state.ns };
  const es = new EventSource(API_BASE + '/api/investigate?' + new URLSearchParams(q).toString());
  evtSource = es;

  es.addEventListener('meta', (ev) => {
    const m = JSON.parse(ev.data);
    addStep(`Starting investigation via ${m.provider}${m.model ? ' (' + m.model + ')' : ''}…`, 'meta');
  });
  es.addEventListener('step', (ev) => {
    const s = JSON.parse(ev.data);
    addStep(s.message || s.phase, s.phase === 'tool' ? 'tool' : '');
  });
  es.addEventListener('warn', (ev) => { const d = JSON.parse(ev.data); addStep('⚠️ ' + (d.message || ''), 'warn'); });
  es.addEventListener('report', (ev) => {
    const r = JSON.parse(ev.data);
    renderReport(reportBox, r);
    addStep('Done.', 'meta');
  });
  es.addEventListener('error', (ev) => {
    let msg = 'stream error';
    try { msg = JSON.parse(ev.data).error || msg; } catch (_) {}
    if (msg !== 'stream error') addStep('❌ ' + msg, 'warn');
  });
  const finish = () => { stopStream(); runBtn.disabled = false; runBtn.textContent = '🔎 Investigate'; loadHistory(historyBox, reportBox); };
  es.addEventListener('eof', finish);
  es.onerror = () => { runBtn.disabled = false; runBtn.textContent = '🔎 Investigate'; };
}

function confidenceClass(c) { return c >= 75 ? 'green' : c >= 50 ? 'yellow' : 'red'; }

function renderReport(box, r) {
  box.innerHTML = '';
  const conf = Number.isFinite(r.confidence) ? r.confidence : 50;
  const head = el('div', { class: 'rca-head' }, [
    el('div', { class: 'rca-title' }, [
      el('span', {}, r.target ? `Investigation: ${r.target}` : 'Investigation'),
      r.namespace ? el('span', { class: 'tag' }, 'ns: ' + r.namespace) : null,
      r.provider ? el('span', { class: 'tag' }, r.provider) : null,
    ]),
    el('div', { class: 'rca-conf' }, [
      el('span', { class: 'muted' }, 'Confidence'),
      el('div', { class: 'confbar' }, [el('div', { class: 'fill ' + confidenceClass(conf), style: `width:${conf}%` })]),
      el('b', {}, conf + '%'),
    ]),
  ]);

  const section = (label, node) => el('div', { class: 'rca-sec' }, [el('div', { class: 'rca-label' }, label), node]);
  const summary = section('Summary', el('div', {}, r.summary || '—'));
  const rootCause = section('Root cause', el('div', { class: 'rca-root' }, r.root_cause || '—'));

  const evList = el('ul', { class: 'rca-evidence' });
  for (const e of (r.evidence || [])) evList.appendChild(el('li', {}, [el('code', {}, String(e))]));
  if (!(r.evidence || []).length) evList.appendChild(el('li', { class: 'muted' }, 'No specific evidence captured.'));
  const evidence = section('Evidence', evList);

  const fix = section('Suggested fix', el('div', { class: 'rca-fix' }, r.suggested_fix || '—'));

  const sigWrap = el('div', { class: 'rca-signals' });
  for (const s of (r.signals || [])) sigWrap.appendChild(el('span', { class: 'pill ' + (s.severity === 'critical' || s.severity === 'high' ? 'red' : s.severity === 'medium' ? 'yellow' : 'gray') }, s.title || s.code));
  const signals = (r.signals || []).length ? section('Detected signals', sigWrap) : null;

  box.appendChild(el('div', { class: 'rca-card' }, [head, summary, rootCause, evidence, fix, signals]));
}

async function loadHistory(box, reportBox) {
  try {
    const { items } = await api('investigations');
    box.innerHTML = '';
    if (!items.length) { box.appendChild(el('div', { class: 'muted' }, 'No investigations yet.')); return; }
    for (const it of items) {
      const conf = Number.isFinite(it.confidence) ? it.confidence : null;
      const row = el('div', { class: 'hist-item', onclick: async () => {
        try { const full = await api('investigation', { id: it.id }); renderReport(reportBox, full); reportBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
        catch (e) { toast(e.message, 'err'); }
      } }, [
        el('div', { class: 'hist-q' }, it.question),
        el('div', { class: 'hist-meta muted' }, [
          el('span', {}, new Date(it.created_at).toLocaleString()),
          conf != null ? el('span', { class: 'pill ' + confidenceClass(conf) }, conf + '%') : null,
        ]),
      ]);
      box.appendChild(row);
    }
  } catch (e) { box.innerHTML = ''; box.appendChild(el('div', { class: 'muted' }, 'History unavailable.')); }
}

function downloadLog(lines, meta) {
  if (!lines || !lines.length) { toast('Nothing to download', 'err'); return; }
  const text = lines.map((l) => (l.pod ? `[${l.pod}] ` : '') + l.line).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `logs-${(meta.regex || meta.selector || 'all').replace(/[^a-z0-9]+/gi, '_')}-${Date.now()}.log` });
  document.body.appendChild(a); a.click(); a.remove();
}

function renderLogLines(box, lines, needle, truncated, withPrefix) {
  box.innerHTML = '';
  if (!lines.length) { box.textContent = '(no log lines)'; return; }
  const frag = document.createDocumentFragment();
  if (truncated) frag.appendChild(el('div', { class: 'muted' }, '… output truncated to last lines …'));
  const low = (needle || '').toLowerCase();
  const colors = {};
  const colorFor = (pod) => (colors[pod] || (colors[pod] = `hsl(${Math.abs(hash(pod)) % 360} 70% 65%)`));
  for (const item of lines) {
    const row = el('div', { class: 'logline' });
    if (withPrefix && item.pod) row.appendChild(el('span', { class: 'pfx', style: `color:${colorFor(item.pod)}` }, item.pod + ' '));
    row.appendChild(document.createTextNode(item.line));
    if (low && item.line.toLowerCase().includes(low)) row.classList.add('hit');
    frag.appendChild(row);
  }
  box.appendChild(frag);
  box.scrollTop = box.scrollHeight;
}

// --- bulk ops ---------------------------------------------------------------

function renderBulk() {
  const c = content();
  c.innerHTML = '';
  if (state.readOnly) c.appendChild(el('div', { class: 'empty' }, 'READ-ONLY mode — bulk operations are disabled.'));

  const opSel = el('select', {});
  opSel.appendChild(el('option', { value: 'restart' }, 'Rollout restart (deploy/sts/ds)'));
  opSel.appendChild(el('option', { value: 'deletePods' }, 'Delete pods (force recreate)'));
  const modeSel = el('select', {});
  modeSel.appendChild(el('option', { value: 'name' }, 'Name regex'));
  modeSel.appendChild(el('option', { value: 'label' }, 'Label selector'));
  const matcher = el('input', { type: 'text', class: 'grow', placeholder: 'e.g. extension   (matches names containing "extension")' });

  const nsSel = el('select', {});
  nsSel.appendChild(el('option', { value: '_all' }, 'All namespaces'));
  for (const n of state.namespaces) nsSel.appendChild(el('option', { value: n.name }, n.name));
  nsSel.value = state.ns;

  const kinds = el('span', {}, [
    cb('deployment', true), ' deploy ', cb('statefulset', false), ' sts ', cb('daemonset', false), ' ds',
  ]);
  function cb(v, checked) { const i = el('input', { type: 'checkbox', value: v }); i.checked = checked; i.className = 'kindcb'; return i; }

  const previewBtn = el('button', {}, 'Preview (dry-run)');
  const runBtn = el('button', { class: 'danger' }, 'Execute');
  runBtn.disabled = true;
  const out = el('div', { class: 'bulk-out' });

  const kindsRow = el('div', { class: 'toolbar', id: 'kindsRow' }, [el('label', {}, 'Kinds:'), kinds]);
  opSel.addEventListener('change', () => { kindsRow.style.display = opSel.value === 'restart' ? '' : 'none'; });

  c.append(
    el('div', { class: 'toolbar' }, [el('label', {}, 'Operation:'), opSel, el('label', {}, 'Namespace:'), nsSel]),
    kindsRow,
    el('div', { class: 'toolbar' }, [modeSel, matcher]),
    el('div', { class: 'toolbar' }, [previewBtn, runBtn]),
    out,
  );

  let matched = [];
  let confirmToken = null; // from the last dry-run; execute must present it
  function body(dryRun) {
    const b = { ns: nsSel.value, dryRun };
    if (modeSel.value === 'label') b.selector = matcher.value.trim();
    else b.regex = matcher.value.trim();
    if (opSel.value === 'restart') b.kinds = [...c.querySelectorAll('.kindcb')].filter((x) => x.checked).map((x) => x.value);
    if (!dryRun) b.confirmToken = confirmToken;
    return b;
  }

  // Any filter change invalidates the preview — force a fresh dry-run.
  const invalidate = () => { confirmToken = null; runBtn.disabled = true; };
  for (const input of [opSel, modeSel, matcher, nsSel]) input.addEventListener('input', invalidate);
  c.addEventListener('change', (e) => { if (e.target.classList && e.target.classList.contains('kindcb')) invalidate(); });

  async function preview() {
    if (!matcher.value.trim()) { toast('Enter a matcher', 'err'); return; }
    out.innerHTML = '<div class="loading">Matching…</div>';
    runBtn.disabled = true;
    try {
      const ep = opSel.value === 'restart' ? 'bulkRestart' : 'bulkDeletePods';
      const r = await post(ep, body(true));
      matched = r.matched || [];
      confirmToken = r.confirmToken || null;
      if (!matched.length) { out.innerHTML = '<div class="empty">No resources matched.</div>'; return; }
      const rows = matched.map((m) => `<tr><td class="mono">${esc(m.kind || 'pod')}</td><td class="mono">${esc(m.namespace)}</td><td class="mono">${esc(m.name)}</td></tr>`).join('');
      out.innerHTML = '';
      out.appendChild(el('div', { class: 'muted', style: 'margin:8px 0' }, `${matched.length} resource(s) will be affected:`));
      out.appendChild(el('table', { html: `<thead><tr><th>Kind</th><th>Namespace</th><th>Name</th></tr></thead><tbody>${rows}</tbody>` }));
      runBtn.disabled = state.readOnly;
    } catch (e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function execute() {
    if (!requireWrite()) return;
    if (!confirm(`${opSel.options[opSel.selectedIndex].text} on ${matched.length} resource(s)?`)) return;
    out.innerHTML = '<div class="loading">Executing…</div>';
    try {
      const ep = opSel.value === 'restart' ? 'bulkRestart' : 'bulkDeletePods';
      const r = await post(ep, body(false));
      const list = r.restarted || r.deleted || [];
      const ok = list.filter((x) => x.ok).length;
      toast(`Done: ${ok}/${list.length} succeeded`, ok === list.length ? 'ok' : 'err');
      const rows = list.map((m) => `<tr><td>${m.ok ? '<span class="pill green">ok</span>' : '<span class="pill red">fail</span>'}</td><td class="mono">${esc(m.namespace)}</td><td class="mono">${esc(m.name)}</td><td>${esc(m.error || '')}</td></tr>`).join('');
      out.innerHTML = '';
      out.appendChild(el('table', { html: `<thead><tr><th>Result</th><th>Namespace</th><th>Name</th><th>Error</th></tr></thead><tbody>${rows}</tbody>` }));
      runBtn.disabled = true;
    } catch (e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  previewBtn.addEventListener('click', preview);
  runBtn.addEventListener('click', execute);
}

// --- cluster health (memory / CPU / crash / OOM detection) ------------------

function barClass(pct) { return pct >= 90 ? 'b-red' : pct >= 75 ? 'b-yellow' : 'b-green'; }
function gaugeColor(score) { return score >= 90 ? 'var(--green)' : score >= 70 ? 'var(--yellow)' : 'var(--red)'; }
function sevPill(sev) {
  const map = { critical: 'red', high: 'yellow', medium: 'gray', low: 'gray' };
  return `<span class="pill ${map[sev] || 'gray'}">${esc(sev)}</span>`;
}

function meterCard(title, pct, sub) {
  const has = pct != null;
  return el('div', { class: 'meter-card' }, [
    el('div', { class: 'm-title' }, title),
    el('div', { class: 'm-val' }, has ? pct + '%' : '—'),
    el('div', { class: 'bar' }, [el('span', { class: has ? barClass(pct) : '', style: `width:${has ? pct : 0}%` })]),
    el('div', { class: 'm-sub' }, sub || ''),
  ]);
}

async function renderHealth() {
  stopStream();
  const c = content();
  c.innerHTML = '<div class="loading">Analyzing cluster health…</div>';
  let h;
  try { h = await api('clusterHealth', { ns: state.ns }); }
  catch (e) { setError(e); return; }
  c.innerHTML = '';

  // ---- top row: health score gauge + CPU/memory meters ----
  const gauge = el('div', { class: 'gauge', style: `--v:${h.score};--c:${gaugeColor(h.score)}` }, [
    el('div', { class: 'g-num' }, String(h.score)),
    el('div', { class: 'g-sub' }, '/ 100'),
  ]);
  const scoreCard = el('div', { class: 'score-card' }, [
    gauge,
    el('div', { class: 'score-grade', style: `color:${gaugeColor(h.score)}` }, h.grade),
    el('div', { class: 'muted', style: 'font-size:12px' }, `${h.counts.critical} critical · ${h.counts.high} high`),
  ]);
  const cpuCard = meterCard('Cluster CPU', h.cluster.cpuPct, h.cluster.cpuText);
  const memCard = meterCard('Cluster Memory', h.cluster.memPct, h.cluster.memText);
  c.appendChild(el('div', { class: 'health-top' }, [scoreCard, cpuCard, memCard]));

  // ---- summary banner ----
  const tone = h.counts.critical ? 'bad' : h.counts.high ? 'warn' : 'good';
  c.appendChild(el('div', { class: 'health-summary ' + tone }, [
    el('span', {}, h.counts.critical ? '🔴' : h.counts.high ? '🟡' : '🟢'),
    el('span', {}, h.summary),
  ]));

  if (!h.metricsAvailable) {
    c.appendChild(el('div', { class: 'metrics-warn' }, '⚠️ metrics-server not detected — CPU/memory usage and leak detection are limited. Crash/OOM analysis still works from pod status. Install metrics-server for full insight.'));
  }

  // ---- detected issues (the actionable core) ----
  c.appendChild(el('h3', {}, `Detected issues (${h.issues.length})`));
  if (!h.issues.length) {
    c.appendChild(el('div', { class: 'empty' }, '✅ No memory, CPU, crash, or OOM issues in this scope.'));
  } else {
    const list = el('div', { class: 'issue-list' });
    for (const it of h.issues) list.appendChild(issueCard(it));
    c.appendChild(list);
  }

  // ---- top memory consumers (leak hunting) ----
  if (h.topMemory && h.topMemory.length) {
    c.appendChild(el('h3', {}, 'Top memory consumers'));
    const rows = h.topMemory.map((m) => {
      const pctCell = m.memPctOfLimit != null
        ? `<div class="bar mini"><span class="${barClass(m.memPctOfLimit)}" style="width:${Math.min(100, m.memPctOfLimit)}%"></span></div> ${m.memPctOfLimit}%`
        : '<span class="muted">no limit</span>';
      return `<tr>
        <td class="mono">${esc(m.namespace || '')}</td>
        <td class="mono">${esc(m.pod)}</td>
        <td class="mono">${esc(m.container)}</td>
        <td class="mono">${esc(m.memText)}</td>
        <td class="mono">${esc(m.memLimitText || '—')}</td>
        <td>${pctCell}</td>
        <td>${m.restarts > 0 ? `<span class="pill ${m.restarts > 4 ? 'red' : 'yellow'}">${m.restarts}</span>` : '0'}</td></tr>`;
    }).join('');
    c.appendChild(el('table', { html: `<thead><tr><th>Namespace</th><th>Pod</th><th>Container</th><th>Memory</th><th>Limit</th><th>% of limit</th><th>Restarts</th></tr></thead><tbody>${rows}</tbody>` }));
  }

  // ---- per-node CPU/memory ----
  if (h.nodes && h.nodes.length) {
    c.appendChild(el('h3', {}, 'Nodes'));
    const rows = h.nodes.map((n) => {
      const cpuBar = n.cpuPct != null ? `<div class="bar mini"><span class="${barClass(n.cpuPct)}" style="width:${n.cpuPct}%"></span></div> ${n.cpuPct}%` : '<span class="muted">—</span>';
      const memBar = n.memPct != null ? `<div class="bar mini"><span class="${barClass(n.memPct)}" style="width:${n.memPct}%"></span></div> ${n.memPct}%` : '<span class="muted">—</span>';
      return `<tr>
        <td class="mono">${esc(n.name)}</td>
        <td class="mono">${n.pool ? esc(n.pool) : '<span class="muted">—</span>'}</td>
        <td class="mono">${n.sku ? `<span class="tag">${esc(n.sku)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${n.ready ? '<span class="pill green">Ready</span>' : '<span class="pill red">NotReady</span>'}</td>
        <td>${cpuBar} <span class="muted mono">${esc(n.cpuText || '')}</span></td>
        <td>${memBar} <span class="muted mono">${esc(n.memText || '')}</span></td>
        <td>${(n.pressure || []).length ? `<span class="pill red">${esc(n.pressure.join(', '))}</span>` : '<span class="muted">none</span>'}</td></tr>`;
    }).join('');
    c.appendChild(el('table', { html: `<thead><tr><th>Node</th><th>Pool</th><th>SKU</th><th>Status</th><th>CPU</th><th>Memory</th><th>Pressure</th></tr></thead><tbody>${rows}</tbody>` }));
  }
}

// One actionable issue card with a suggested fix and quick remediation buttons.
function issueCard(it) {
  const head = el('div', { class: 'issue-head', html: sevPill(it.severity) });
  head.appendChild(el('span', { class: 'issue-title' }, it.title));
  const target = [it.namespace, it.pod, it.container].filter(Boolean).join(' / ');
  if (target) head.appendChild(el('span', { class: 'tag mono' }, target));

  const card = el('div', { class: 'issue sev-' + it.severity }, [
    head,
    el('div', { class: 'issue-detail' }, it.detail || ''),
    el('div', { class: 'issue-fix', html: `<b>Suggested fix:</b> ${esc(it.fix || '—')}` }),
  ]);

  // "What is causing this node's memory?" — attribution breakdown for node issues.
  if (it.consumers && it.consumers.length) {
    const cons = el('div', { class: 'consumers' });
    cons.appendChild(el('div', { class: 'consumers-title' }, 'Top memory consumers on this node'));
    for (const x of it.consumers) {
      const row = el('div', { class: 'consumer-row' }, [
        el('span', { class: 'mono grow' }, `${x.namespace}/${x.pod} · ${x.container}`),
        el('span', { class: 'mono consumer-mem' }, x.memText + (x.memPctOfNode != null ? `  (${x.memPctOfNode}%)` : '')),
      ]);
      const acts = el('span', { class: 'consumer-acts' }, [
        el('button', { title: 'Show the running processes/programs inside this container', onclick: () => openProcs(x.namespace, x.pod, x.container) }, '🔬 Top processes'),
        el('button', { title: 'View logs', onclick: () => { logCtx.ns = x.namespace; logCtx.pod = x.pod; logCtx.container = x.container || ''; logCtx.search = ''; switchTab('logs'); } }, '📜 Logs'),
      ]);
      row.appendChild(acts);
      cons.appendChild(row);
    }
    card.appendChild(cons);
  }

  // Quick actions to help debug/fix without leaving the view.
  const actions = el('div', { class: 'issue-actions' });
  if (it.pod && it.namespace) {
    actions.appendChild(el('button', { onclick: () => {
      logCtx.ns = it.namespace; logCtx.pod = it.pod; logCtx.container = it.container || ''; logCtx.search = '';
      switchTab('logs');
    } }, it.previousLogs ? '📜 Previous logs' : '📜 Logs'));
    // Reveal the actual process/program using memory — no source code needed.
    if (it.container) actions.appendChild(el('button', { title: 'Show the running processes/programs inside this container, sorted by memory', onclick: () => openProcs(it.namespace, it.pod, it.container) }, '🔬 Top processes'));
    actions.appendChild(el('button', { onclick: () => openDescribe('pod', it.namespace, it.pod) }, '🔍 Describe'));
    if (!state.readOnly) {
      actions.appendChild(el('button', { class: 'danger', onclick: () => doDeletePod(it.namespace, it.pod) }, '♻️ Restart pod'));
    }
  }
  // Always allow an AI deep-dive seeded with the affected target.
  const q = it.pod ? `Investigate ${it.pod}` : it.node ? `Investigate node ${it.node}` : 'Investigate cluster health';
  actions.appendChild(el('button', { class: 'primary', onclick: () => {
    asstState.question = q;
    switchTab('assistant');
    setTimeout(() => { const i = $('.asst-main input'); if (i) { i.value = q; } }, 60);
  } }, '🤖 Ask AI'));
  card.appendChild(actions);
  return card;
}

// --- node pools / SKUs / node selectors -------------------------------------

async function renderNodePools() {
  stopStream();
  const c = content();
  c.innerHTML = '';
  c.appendChild(spinner('Loading node pools & SKUs…'));
  let d;
  try { d = await api('nodePools', { ns: state.ns }); }
  catch (e) { setError(e); return; }
  c.innerHTML = '';

  // ---- pool summary cards ----
  c.appendChild(el('h3', {}, `Node pools (${d.pools.length})`));
  if (!d.pools.length) {
    c.appendChild(el('div', { class: 'empty' }, 'No nodes found (or node labels unavailable).'));
  } else {
    const cards = el('div', { class: 'cards' });
    for (const p of d.pools) {
      const card = el('div', { class: 'card pool-card' }, [
        el('div', { class: 'pool-head' }, [
          el('div', { class: 'value', style: 'font-size:1.05rem' }, p.name),
          p.mode ? el('span', { class: 'pill ' + (p.mode === 'System' ? 'yellow' : 'gray') }, p.mode) : null,
        ]),
        el('div', { class: 'pool-meta' }, [
          kvline('SKU', (p.skus.length ? p.skus : ['—']).map((s) => `<span class="tag">${esc(s)}</span>`).join(' ')),
          kvline('Nodes', `${p.ready}/${p.count} ready`),
          kvline('Capacity', `${esc(p.totalCpu)} vCPU · ${esc(p.totalMemory)}`),
          kvline('Zones', p.zones.length ? p.zones.map((z) => `<span class="tag">${esc(z)}</span>`).join(' ') : '<span class="muted">—</span>'),
          kvline('OS / Arch', `${esc((p.os[0] || '—'))}${p.arch.length ? ' · ' + esc(p.arch.join(', ')) : ''}`),
        ]),
      ]);
      cards.appendChild(card);
    }
    c.appendChild(cards);
  }

  // ---- nodes table ----
  c.appendChild(el('h3', {}, `Nodes (${d.nodes.length})`));
  if (d.nodes.length) {
    const rows = d.nodes.map((n) => `<tr>
      <td class="mono"><a class="link" data-node="${esc(n.name)}">${esc(n.name)}</a></td>
      <td class="mono">${esc(n.pool)}</td>
      <td>${n.sku ? `<span class="tag">${esc(n.sku)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="mono">${esc(n.osSku || n.os || '')}${n.arch ? ' / ' + esc(n.arch) : ''}</td>
      <td class="mono">${esc(n.zone || '—')}</td>
      <td>${n.mode ? `<span class="pill ${n.mode === 'System' ? 'yellow' : 'gray'}">${esc(n.mode)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="mono">${esc(n.cpu || '')} / ${esc(n.memory || '')}</td>
      <td class="mono">${esc(String(n.pods))}${n.maxPods ? '/' + esc(String(n.maxPods)) : ''}</td>
      <td>${n.ready ? '<span class="pill green">Ready</span>' : '<span class="pill red">NotReady</span>'}</td>
      <td>${(n.taints || []).length ? n.taints.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ') : '<span class="muted">none</span>'}</td></tr>`).join('');
    const table = el('table', { id: 'nodePoolTable', html: `<thead><tr><th>Node</th><th>Pool</th><th>SKU</th><th>OS/Arch</th><th>Zone</th><th>Mode</th><th>CPU / Mem</th><th>Pods</th><th>Status</th><th>Taints</th></tr></thead><tbody>${rows}</tbody>` });
    table.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-node]');
      if (!a) return;
      const node = d.nodes.find((x) => x.name === a.dataset.node);
      if (node) openNodeDetails(node);
    });
    c.appendChild(table);
  }

  // ---- node selectors in use ----
  c.appendChild(el('h3', {}, `Node selectors in use (${d.scheduling.length})`));
  c.appendChild(el('div', { class: 'muted', style: 'margin:-4px 0 10px' }, 'Workloads that pin themselves to specific nodes/pools via nodeSelector, node affinity, or tolerations' + (state.ns && state.ns !== '_all' ? ` (namespace: ${esc(state.ns)})` : '') + '.'));
  if (!d.scheduling.length) {
    c.appendChild(el('div', { class: 'empty' }, 'No workloads use nodeSelector / affinity / tolerations in this scope.'));
  } else {
    const rows = d.scheduling.map((w) => {
      const sel = Object.entries(w.nodeSelector || {}).map(([k, v]) => `<span class="tag">${esc(k)}=${esc(v)}</span>`).join(' ') || '<span class="muted">—</span>';
      const aff = (w.affinity || []).length ? w.affinity.map((a) => `<span class="tag">${esc(a)}</span>`).join(' ') : '<span class="muted">—</span>';
      const tol = (w.tolerations || []).length ? w.tolerations.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ') : '<span class="muted">—</span>';
      return `<tr>
        <td class="mono">${esc(w.kind)}</td>
        <td class="mono">${esc(w.namespace)}</td>
        <td class="mono">${esc(w.name)}</td>
        <td>${sel}</td>
        <td>${aff}</td>
        <td>${tol}</td></tr>`;
    }).join('');
    c.appendChild(el('table', { html: `<thead><tr><th>Kind</th><th>Namespace</th><th>Name</th><th>nodeSelector</th><th>Node affinity</th><th>Tolerations</th></tr></thead><tbody>${rows}</tbody>` }));
  }
}

function kvline(k, htmlVal) {
  return el('div', { class: 'pool-kv' }, [el('span', { class: 'pk' }, k), el('span', { class: 'pv', html: htmlVal })]);
}

// Node detail modal built entirely from data we already have (nodes are not
// namespaced, so we avoid an extra describe call). Shows the labels a developer
// would use in a nodeSelector to target this node/pool.
function openNodeDetails(n) {
  openModal(`node ${n.name}`, {
    Details: () => {
      const grid = el('div', { class: 'kv' });
      const add = (k, v) => { grid.appendChild(el('div', { class: 'k' }, k)); grid.appendChild(el('div', { class: 'v mono' }, v == null || v === '' ? '—' : String(v))); };
      add('Node pool', n.pool);
      add('VM SKU / instance type', n.sku);
      add('AKS mode', n.mode);
      add('OS', n.osSku || n.os);
      add('Architecture', n.arch);
      add('Region / Zone', [n.region, n.zone].filter(Boolean).join(' / '));
      add('CPU / Memory', `${n.cpu || '—'} / ${n.memory || '—'}`);
      add('Pods', `${n.pods}${n.maxPods ? ' / ' + n.maxPods + ' max' : ''}`);
      add('Kubelet', n.kubelet);
      add('Ready', n.ready ? 'Yes' : 'No');
      add('Age', n.age);
      add('Taints', (n.taints || []).join('  ') || 'none');
      return grid;
    },
    'Selector labels': () => {
      const wrap = el('div', {});
      wrap.appendChild(el('div', { class: 'muted', style: 'margin-bottom:8px' }, 'Use any of these as a nodeSelector (key: value) to schedule pods onto this node/pool:'));
      const grid = el('div', { class: 'kv' });
      const labels = n.labels || {};
      if (!Object.keys(labels).length) grid.appendChild(el('div', { class: 'muted' }, 'No well-known selectable labels found.'));
      for (const [k, v] of Object.entries(labels)) {
        grid.appendChild(el('div', { class: 'k' }, k));
        grid.appendChild(el('div', { class: 'v mono' }, v));
      }
      wrap.appendChild(grid);
      return wrap;
    },
  });
}

// --- generic filter toolbar -------------------------------------------------

// toolbar(placeholder, tableId, opts?)
//   opts.filters: [{ label, col, values:[...], all?:string }]  — column dropdown filters
// Combines a free-text search with any number of exact-match column dropdowns.
function toolbar(placeholder, tableId, opts = {}) {
  const input = el('input', { type: 'text', placeholder, class: 'grow' });
  const selects = [];
  const controls = [input];
  for (const f of (opts.filters || [])) {
    if (!f.values || !f.values.length) continue;
    const s = el('select', {});
    s.appendChild(el('option', { value: '__all' }, f.all || `All ${f.label.toLowerCase()}s`));
    for (const v of f.values) s.appendChild(el('option', { value: v }, v));
    s.dataset.col = f.col;
    selects.push(s);
    controls.push(el('span', { class: 'filter-label' }, f.label), s);
  }
  function apply() {
    const q = input.value.toLowerCase();
    const tbl = document.getElementById(tableId);
    if (!tbl || !tbl.tBodies[0]) return;
    for (const tr of tbl.tBodies[0].rows) {
      let show = tr.textContent.toLowerCase().includes(q);
      if (show) {
        for (const s of selects) {
          if (s.value === '__all') continue;
          const cell = tr.cells[Number(s.dataset.col)];
          if (!cell || cell.textContent.trim() !== s.value) { show = false; break; }
        }
      }
      tr.style.display = show ? '' : 'none';
    }
  }
  input.addEventListener('input', apply);
  for (const s of selects) s.addEventListener('change', apply);
  return el('div', { class: 'toolbar' }, controls);
}

// Distinct namespace names for column filters (from the loaded namespace list).
function nsFilterValues() { return (state.namespaces || []).map((n) => n.name); }

// --- table action dispatch --------------------------------------------------

async function onTableAction(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const { act, ns, name, type, containers, replicas } = t.dataset;
  if (act === 'describe') return openDescribe(type, ns, name);
  if (act === 'manifest') return openManifest(type, ns, name);
  if (act === 'edit') return openEditYaml(type, ns, name);
  if (act === 'secret') return openSecret(ns, name);
  if (act === 'restart') return doRestart(ns, name);
  if (act === 'scale') return doScale(ns, name, replicas);
  if (act === 'delete-pod') return doDeletePod(ns, name);
  if (act === 'exec') return openExec(ns, name, (containers || '').split(',').filter(Boolean));
  if (act === 'helm-detail') return openHelmDetail(ns, name);
  if (act === 'logs-pod') {
    logCtx.ns = ns; logCtx.pod = name; logCtx.container = ''; logCtx.search = '';
    switchTab('logs'); return;
  }
  if (act === 'logs-agg') {
    // Aggregate logs for a deployment: pods are named <deploy>-*
    switchTab('aggregate');
    renderAggregate({ ns, mode: 'name', regex: '^' + name + '-', selector: '', search: '' });
  }
}

function switchTab(view) {
  state.view = view;
  for (const b of $('#tabs').querySelectorAll('button')) b.classList.toggle('active', b.dataset.view === view);
  if (view !== 'aggregate') render();
}

async function doRestart(ns, name) {
  if (!requireWrite()) return;
  if (!confirm(`Restart deployment ${ns}/${name}?`)) return;
  try { const r = await post('restart', { ns, name }); toast(r.output || 'Restart triggered', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
}
async function doScale(ns, name, current) {
  if (!requireWrite()) return;
  const v = prompt(`Scale ${ns}/${name} to how many replicas?`, current || '1');
  if (v == null) return;
  try { const r = await post('scale', { ns, name, replicas: v }); toast(r.output || 'Scaled', 'ok'); render(); }
  catch (e) { toast(e.message, 'err'); }
}
async function doDeletePod(ns, name) {
  if (!requireWrite()) return;
  if (!confirm(`Delete pod ${ns}/${name}? (controller will recreate it)`)) return;
  try { const r = await post('deletePod', { ns, pod: name }); toast(r.output || 'Deleted', 'ok'); render(); }
  catch (e) { toast(e.message, 'err'); }
}

// --- modal ------------------------------------------------------------------

function openModal(title, tabs) {
  $('#modalTitle').textContent = title;
  const tabBar = $('#modalTabs');
  const body = $('#modalBody');
  tabBar.innerHTML = '';
  body.innerHTML = '';
  body.appendChild(spinner('Loading…'));
  const tabNames = Object.keys(tabs);
  const activate = async (n, btn) => {
    for (const b of tabBar.children) b.classList.toggle('active', b === btn);
    body.innerHTML = '';
    body.appendChild(spinner(`Loading ${n.toLowerCase()}…`));
    try { body.innerHTML = ''; body.appendChild(await tabs[n]()); }
    catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  tabNames.forEach((n, i) => {
    const btn = el('button', { class: i === 0 ? 'active' : '' }, n);
    btn.addEventListener('click', () => activate(n, btn));
    tabBar.appendChild(btn);
  });
  $('#modal').classList.remove('hidden');
  if (tabNames.length) activate(tabNames[0], tabBar.children[0]);
}
function closeModal() { $('#modal').classList.add('hidden'); }
function preFrom(text) { return el('pre', {}, text); }

// Render `kubectl describe` output as tidy key/value lines: top-level headings
// (e.g. "Containers:", "Events:") are emphasised and every "Key:" is coloured,
// so the structure is scannable instead of a wall of text.
function describeNode(text) {
  const wrap = el('div', { class: 'desc' });
  for (const line of String(text == null ? '' : text).split('\n')) {
    const row = el('div', { class: 'desc-line' });
    const m = line.match(/^(\s*)([A-Za-z][\w()./,\-& ]*?):(\s*)(.*)$/);
    if (m) {
      if (m[1]) row.appendChild(document.createTextNode(m[1])); // preserve indentation
      const isSection = m[1].length === 0 && m[4] === '';
      row.appendChild(el('span', { class: isSection ? 'desc-key section' : 'desc-key' }, m[2] + ':'));
      if (m[3] || m[4]) row.appendChild(document.createTextNode(m[3] + m[4]));
    } else {
      row.textContent = line || '\u00a0';
    }
    wrap.appendChild(row);
  }
  return wrap;
}

// Render YAML with coloured keys and comments (read-only viewer).
function yamlNode(text) {
  const pre = el('pre', { class: 'yaml-view' });
  for (const line of String(text == null ? '' : text).split('\n')) {
    const row = el('div', {});
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) {
      row.appendChild(el('span', { class: 'y-comment' }, line || '\u00a0'));
    } else {
      const m = line.match(/^(\s*(?:- )?)([\w.\-/]+)(:)(.*)$/);
      if (m) {
        row.appendChild(document.createTextNode(m[1]));
        row.appendChild(el('span', { class: 'y-key' }, m[2]));
        row.appendChild(document.createTextNode(m[3] + m[4]));
      } else {
        row.textContent = line || '\u00a0';
      }
    }
    pre.appendChild(row);
  }
  return pre;
}

function openDescribe(type, ns, name) {
  openModal(`${type} ${ns}/${name}`, {
    Describe: async () => describeNode((await api('describe', { type, ns, name })).text),
    YAML: async () => yamlNode((await api('manifest', { type, ns, name })).text),
    Edit: () => editYamlTab(type, ns, name),
  });
}
function openManifest(type, ns, name) {
  openModal(`${type} ${ns}/${name}`, {
    YAML: async () => yamlNode((await api('manifest', { type, ns, name })).text),
    Edit: () => editYamlTab(type, ns, name),
    Describe: async () => describeNode((await api('describe', { type, ns, name })).text),
  });
}
function openEditYaml(type, ns, name) {
  openModal(`Edit ${type} ${ns}/${name}`, {
    Edit: () => editYamlTab(type, ns, name),
    YAML: async () => yamlNode((await api('manifest', { type, ns, name })).text),
    Describe: async () => describeNode((await api('describe', { type, ns, name })).text),
  });
}

// Returns a DOM node for the Edit tab: fetches current YAML, lets the user
// modify it, and applies via `kubectl apply -f -`. Only affects this resource.
function editYamlTab(type, ns, name) {
  const wrap = el('div', { class: 'edit-area' });
  const ta = el('textarea', { class: 'yaml-editor', spellcheck: 'false', placeholder: 'Loading manifest…' });
  const saveBtn = el('button', { class: 'primary' }, 'Apply changes');
  const revertBtn = el('button', {}, 'Revert');
  const status = el('span', { class: 'muted' }, '');
  const out = el('pre', { class: 'exec-out hidden' });

  let original = '';
  (async () => {
    try {
      const r = await api('manifest', { type, ns, name });
      original = r.text || '';
      ta.value = original;
      ta.placeholder = '';
    } catch (e) {
      ta.value = '# Failed to load manifest: ' + e.message;
    }
  })();

  if (state.readOnly) {
    saveBtn.disabled = true;
    status.textContent = 'READ-ONLY mode — apply disabled.';
  }

  revertBtn.addEventListener('click', () => { ta.value = original; status.textContent = 'reverted to last loaded version'; });

  saveBtn.addEventListener('click', async () => {
    if (!requireWrite()) return;
    if (ta.value.trim() === original.trim()) { toast('No changes to apply', 'err'); return; }
    if (!confirm(`Apply changes to ${type} ${ns}/${name}?`)) return;
    saveBtn.disabled = true; status.textContent = 'applying…';
    out.classList.add('hidden'); out.textContent = '';
    try {
      const r = await post('applyManifest', { yaml: ta.value });
      status.textContent = '✓ applied';
      out.classList.remove('hidden');
      out.textContent = r.output || '(no output)';
      toast('Applied: ' + (r.output || 'ok'), 'ok');
      original = ta.value;
      // Refresh the underlying list view in the background.
      render();
    } catch (e) {
      status.textContent = '✗ failed';
      out.classList.remove('hidden');
      out.textContent = e.message;
      toast('Apply failed: ' + e.message, 'err');
    } finally {
      saveBtn.disabled = state.readOnly;
    }
  });

  wrap.append(
    el('div', { class: 'muted', style: 'margin-bottom:6px' }, `Editing live manifest. "Apply changes" runs kubectl apply on this single resource (${type} ${ns}/${name}).`),
    ta,
    el('div', { class: 'toolbar', style: 'margin-top:8px' }, [saveBtn, revertBtn, status]),
    out,
  );
  return wrap;
}
function openSecret(ns, name) {
  openModal(`secret ${ns}/${name}`, {
    Decoded: async () => {
      const s = await api('secret', { ns, name });
      const grid = el('div', { class: 'kv' });
      if (s.redacted) grid.appendChild(el('div', { class: 'muted', style: 'grid-column:1/-1' }, 'Values are redacted in READ-ONLY mode.'));
      else grid.appendChild(el('div', { class: 'muted', style: 'grid-column:1/-1' }, 'Secret access is written to the audit log.'));
      for (const [k, v] of Object.entries(s.data)) {
        grid.appendChild(el('div', { class: 'k' }, k));
        const val = el('div', { class: 'v' });
        const masked = '••••••••';
        const span = el('span', {}, masked);
        const toggle = el('span', { class: 'reveal' }, ' reveal');
        let shown = false;
        toggle.addEventListener('click', () => { shown = !shown; span.textContent = shown ? v : masked; toggle.textContent = shown ? ' hide' : ' reveal'; });
        val.append(span, toggle);
        grid.appendChild(val);
      }
      return grid;
    },
    YAML: async () => yamlNode((await api('manifest', { type: 'secret', ns, name })).text),
  });
}
function openHelmDetail(ns, name) {
  openModal(`helm release ${ns}/${name}`, {
    Overview: async () => {
      const r = await api('helmRelease', { ns, name });
      const wrap = el('div', {});
      if (r.error && !r.helmAvailable) {
        wrap.appendChild(el('div', { class: 'muted', style: 'margin-bottom:8px' }, 'The helm binary is not installed on the dashboard host, so detailed status/values are unavailable. Set HELM_PATH or install helm to enable this.'));
      }
      const s = r.status || {};
      const info = s.info || {};
      const grid = el('div', { class: 'kv' });
      const add = (k, v) => { grid.appendChild(el('div', { class: 'k' }, k)); grid.appendChild(el('div', { class: 'v mono' }, v == null ? '—' : String(v))); };
      add('Name', r.name);
      add('Namespace', r.namespace);
      add('Status', info.status);
      add('Revision', s.version);
      add('Last deployed', info.last_deployed);
      if (s.chart && s.chart.metadata) { add('Chart', `${s.chart.metadata.name}-${s.chart.metadata.version}`); add('App version', s.chart.metadata.appVersion); }
      wrap.appendChild(grid);
      if (info.notes) wrap.appendChild(el('pre', { style: 'margin-top:10px' }, info.notes));
      return wrap;
    },
    History: async () => {
      const r = await api('helmRelease', { ns, name });
      if (!r.history || !r.history.length) return el('div', { class: 'muted' }, 'No history available (requires the helm binary).');
      const rows = r.history.map((h) => `<tr>
        <td>${esc(h.revision)}</td>
        <td>${esc(h.status)}</td>
        <td class="mono">${esc(h.chart || '')}</td>
        <td class="mono">${esc(h.app_version || '')}</td>
        <td class="mono">${esc(h.updated || '')}</td>
        <td>${esc(h.description || '')}</td></tr>`).join('');
      return el('table', { html: `<thead><tr><th>Rev</th><th>Status</th><th>Chart</th><th>App ver</th><th>Updated</th><th>Description</th></tr></thead><tbody>${rows}</tbody>` });
    },
    Values: async () => {
      const r = await api('helmRelease', { ns, name });
      return yamlNode(r.values || '(no user-supplied values, or helm binary unavailable)');
    },
  });
}

// Reveal the actual processes/programs running *inside* a container, sorted by
// memory — so a developer can see what is consuming RAM without reading code.
// Reads /proc directly (portable across distros/busybox) and renders a friendly
// table; a raw toggle shows the unparsed output.
function openProcs(ns, pod, container) {
  if (state.readOnly) { toast('READ-ONLY mode: process inspection disabled', 'err'); return; }
  // Emit tab-delimited "RSS(kB)\tPID\tNAME\tCMDLINE" per process from /proc.
  const cmd =
    'for d in /proc/[0-9]*; do ' +
    '[ -r "$d/status" ] || continue; ' +
    'rss=$(awk \'/^VmRSS:/{print $2}\' "$d/status" 2>/dev/null); ' +
    '[ -n "$rss" ] || continue; ' +
    'name=$(awk \'/^Name:/{print $2}\' "$d/status" 2>/dev/null); ' +
    'pid=${d#/proc/}; ' +
    'cmd=$(tr \'\\0\' \' \' < "$d/cmdline" 2>/dev/null); ' +
    'printf \'%s\\t%s\\t%s\\t%s\\n\' "$rss" "$pid" "$name" "$cmd"; ' +
    'done | sort -rn | head -30';

  openModal(`Processes in ${ns}/${pod}${container ? ' [' + container + ']' : ''}`, {
    Processes: () => {
      const wrap = el('div', {});
      wrap.appendChild(el('div', { class: 'proc-note' },
        'Live processes inside the container, sorted by resident memory (RSS). This shows which program is using RAM — a process whose RSS keeps climbing across refreshes is your leak. No source code needed.'));

      const refresh = el('button', {}, '↻ Refresh');
      const rawBtn = el('button', {}, 'View raw');
      const total = el('span', { class: 'proc-total' }, '');
      wrap.appendChild(el('div', { class: 'proc-toolbar' }, [refresh, rawBtn, el('span', { class: 'grow' }), total]));

      const mount = el('div', {});
      const rawBox = el('pre', { class: 'exec-out proc-raw hidden' });
      wrap.append(mount, rawBox);

      let showRaw = false;
      rawBtn.addEventListener('click', () => {
        showRaw = !showRaw;
        rawBox.classList.toggle('hidden', !showRaw);
        mount.classList.toggle('hidden', showRaw);
        rawBtn.textContent = showRaw ? 'View table' : 'View raw';
      });

      async function load() {
        mount.innerHTML = '';
        mount.appendChild(spinner('Inspecting running processes…'));
        total.textContent = '';
        try {
          const b = { ns, pod, command: cmd };
          if (container) b.container = container;
          const r = await post('exec', b);
          const text = (r.output || '').trim();
          rawBox.textContent = (text + (r.error ? '\n[stderr] ' + r.error : '')) || '(no output)';
          const procs = parseProcs(text);
          mount.innerHTML = '';
          if (!procs.length) {
            mount.appendChild(el('div', { class: 'empty' },
              r.error ? r.error : 'Could not read processes — this image may be distroless / have no shell or /proc. Try “View raw”.'));
            return;
          }
          let totalKb = 0; for (const p of procs) totalKb += p.rssKb;
          total.textContent = `${procs.length} process(es) · ${fmtKb(totalKb)} total RSS`;
          const rows = procs.map((p) => `<tr>
            <td class="mono rss">${esc(fmtKb(p.rssKb))}</td>
            <td class="mono">${esc(p.pid)}</td>
            <td class="mono">${esc(p.name || '')}</td>
            <td class="mono cmd" title="${esc(p.cmd || p.name || '')}">${esc(p.cmd || p.name || '')}</td></tr>`).join('');
          mount.appendChild(el('table', { class: 'proc-table', html: `<thead><tr><th>Memory (RSS)</th><th>PID</th><th>Process</th><th>Command</th></tr></thead><tbody>${rows}</tbody>` }));
        } catch (e) {
          mount.innerHTML = '';
          mount.appendChild(el('div', { class: 'empty' }, e.message));
        }
      }
      refresh.addEventListener('click', load);
      load();
      return wrap;
    },
    Describe: async () => describeNode((await api('describe', { type: 'pod', ns, name: pod })).text),
  });
}

// Parse the tab-delimited "RSS\tPID\tNAME\tCMD" lines emitted by openProcs' command.
function parseProcs(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    if (line.indexOf('\t') === -1) continue;
    const parts = line.split('\t');
    const rssKb = parseInt(parts[0], 10);
    if (!Number.isFinite(rssKb)) continue;
    rows.push({ rssKb, pid: parts[1], name: parts[2], cmd: parts.slice(3).join(' ').trim() });
  }
  return rows;
}

// Human-readable memory from a kB value (as reported by /proc VmRSS).
function fmtKb(kb) {
  let n = kb; const u = ['KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

function openExec(ns, name, containers) {
  if (state.readOnly) { toast('READ-ONLY mode: debug disabled', 'err'); return; }
  openModal(`debug ${ns}/${name}`, {
    Shell: () => {
      const wrap = el('div', { class: 'exec-area' });
      let contSel = null;
      if (containers.length > 1) {
        contSel = el('select', {});
        for (const cn of containers) contSel.appendChild(el('option', { value: cn }, cn));
        wrap.append(el('div', { class: 'muted', style: 'margin-bottom:6px' }, 'Container:'), contSel);
      }
      const ta = el('textarea', { placeholder: 'e.g. ls -la /  •  env  •  cat /etc/hosts   (Ctrl+Enter to run)' });
      const run = el('button', {}, 'Run in pod');
      const out = el('pre', { class: 'exec-out' }, 'Output will appear here.');
      run.addEventListener('click', async () => {
        const command = ta.value.trim();
        if (!command) return;
        out.textContent = 'Running…';
        try {
          const b = { ns, pod: name, command };
          if (contSel) b.container = contSel.value;
          const r = await post('exec', b);
          out.textContent = (r.output || '') + (r.error ? '\n[stderr] ' + r.error : '');
        } catch (e) { out.textContent = e.message; }
      });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run.click(); });
      wrap.append(ta, el('div', {}, run), out);
      return wrap;
    },
    Describe: async () => describeNode((await api('describe', { type: 'pod', ns, name })).text),
  });
}

// --- boot -------------------------------------------------------------------

async function init() {
  setupChrome();
  await loadConfig();
  await Promise.all([loadHealth(), loadNamespaces()]);
  await render();
}
init();
