/* k8s-local-dashboard frontend (vanilla JS, no build step) */
'use strict';

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
  const res = await fetch(`/api/${name}${qs ? '?' + qs : ''}`, opts);
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
    if (e.target.tagName !== 'BUTTON') return;
    for (const b of $('#tabs').children) b.classList.toggle('active', b === e.target);
    state.view = e.target.dataset.view;
    render();
  });
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
}

// --- views ------------------------------------------------------------------

const content = () => $('#content');
function setLoading() { content().innerHTML = '<div class="loading">Loading…</div>'; }
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

  async deployments() {
    const { items } = await api('deployments', { ns: state.ns });
    const c = content();
    c.innerHTML = '';
    c.appendChild(toolbar('Filter deployments…', 'deployTable'));
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
    c.appendChild(toolbar('Filter pods…', 'podTable'));
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
        <button data-act="exec" data-ns="${esc(p.namespace)}" data-name="${esc(p.name)}" data-containers="${esc(p.containers.join(','))}">Debug</button>
        <button data-act="delete-pod" data-ns="${esc(p.namespace)}" data-name="${esc(p.name)}">Delete</button>
      </td></tr>`).join('');
    const table = el('table', { id: 'podTable', html: `<thead><tr><th>Namespace</th><th>Name</th><th>Phase</th><th>Ready</th><th>Restarts</th><th>Node</th><th>IP</th><th>Age</th><th>Actions</th></tr></thead><tbody>${rows}</tbody>` });
    table.addEventListener('click', onTableAction);
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
    const filterInput = el('input', { type: 'text', placeholder: 'Filter pods…', class: 'grow' });
    picker.appendChild(el('div', { class: 'toolbar' }, [filterInput]));

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

    filterInput.addEventListener('input', () => {
      const q = filterInput.value.toLowerCase();
      if (!table.tBodies[0]) return;
      for (const tr of table.tBodies[0].rows) tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });

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
      box.textContent = 'Loading logs…';
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
    c.appendChild(toolbar('Filter secrets…', 'secretTable'));
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
    c.appendChild(toolbar('Filter events…', 'evtTable'));
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
    box.textContent = 'Collecting logs…';
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
    const es = new EventSource('/api/streamLogs?' + new URLSearchParams(q).toString());
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
  const es = new EventSource('/api/investigate?' + new URLSearchParams(q).toString());
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
  function body(dryRun) {
    const b = { ns: nsSel.value, dryRun };
    if (modeSel.value === 'label') b.selector = matcher.value.trim();
    else b.regex = matcher.value.trim();
    if (opSel.value === 'restart') b.kinds = [...c.querySelectorAll('.kindcb')].filter((x) => x.checked).map((x) => x.value);
    return b;
  }

  async function preview() {
    if (!matcher.value.trim()) { toast('Enter a matcher', 'err'); return; }
    out.innerHTML = '<div class="loading">Matching…</div>';
    runBtn.disabled = true;
    try {
      const ep = opSel.value === 'restart' ? 'bulkRestart' : 'bulkDeletePods';
      const r = await post(ep, body(true));
      matched = r.matched || [];
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

// --- generic filter toolbar -------------------------------------------------

function toolbar(placeholder, tableId) {
  const input = el('input', { type: 'text', placeholder, class: 'grow' });
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    const tbl = document.getElementById(tableId);
    if (!tbl) return;
    for (const tr of tbl.tBodies[0].rows) tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
  return el('div', { class: 'toolbar' }, [input]);
}

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
  for (const b of $('#tabs').children) b.classList.toggle('active', b.dataset.view === view);
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
  body.innerHTML = '<div class="loading">Loading…</div>';
  const tabNames = Object.keys(tabs);
  const activate = async (n, btn) => {
    for (const b of tabBar.children) b.classList.toggle('active', b === btn);
    body.innerHTML = '<div class="loading">Loading…</div>';
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

function openDescribe(type, ns, name) {
  openModal(`${type} ${ns}/${name}`, {
    Describe: async () => preFrom((await api('describe', { type, ns, name })).text),
    YAML: async () => preFrom((await api('manifest', { type, ns, name })).text),
    Edit: () => editYamlTab(type, ns, name),
  });
}
function openManifest(type, ns, name) {
  openModal(`${type} ${ns}/${name}`, {
    YAML: async () => preFrom((await api('manifest', { type, ns, name })).text),
    Edit: () => editYamlTab(type, ns, name),
    Describe: async () => preFrom((await api('describe', { type, ns, name })).text),
  });
}
function openEditYaml(type, ns, name) {
  openModal(`Edit ${type} ${ns}/${name}`, {
    Edit: () => editYamlTab(type, ns, name),
    YAML: async () => preFrom((await api('manifest', { type, ns, name })).text),
    Describe: async () => preFrom((await api('describe', { type, ns, name })).text),
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
    YAML: async () => preFrom((await api('manifest', { type: 'secret', ns, name })).text),
  });
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
    Describe: async () => preFrom((await api('describe', { type: 'pod', ns, name })).text),
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
