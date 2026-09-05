// Question editor — build a query visually or in read-only SQL, preview it live
// as any of six chart types, and save it as a reusable question.
//
// One editor, two modes (like Metabase's notebook + native query): the visual
// builder assembles a spec the semantic-layer compiler turns into SQL; the SQL
// mode runs the user's own read-only SELECT. Both go through the
// analytics_run_sql RPC (SECURITY INVOKER), so neither can surface a row the
// user couldn't see in the UI.

import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { navigate, routeParams } from '../../js/router.js';
import { MODELS, AGGREGATIONS, GRANULARITIES, getModel, getField, operatorsForType } from '../../js/analytics/models.js';
import { runBuilder, runSql } from '../../js/analytics/engine.js';
import { measureAlias, measureLabelFor } from '../../js/analytics/compiler.js';
import { renderChart, VIZ_TYPES, CHART_THEMES } from '../../js/analytics/charts.js';
import { askAI } from '../../js/analytics/nl.js';
import { mountLab } from '../../js/analytics/duck.js';

const firstModel = Object.keys(MODELS)[0];

function blankQuestion() {
  return {
    id: null, name: '', description: '', mode: 'builder', viz: 'table',
    spec: { model: firstModel, dimensions: [], measures: [{ agg: 'count' }], filters: [], sort: null, limit: 50, sql: '', maxRows: 1000, vizTheme: 'mono' },
  };
}

export default async function questionEditor(container) {
  const org = getOrg();
  const params = routeParams();
  let q = blankQuestion();

  if (params.id) {
    const { data, error } = await sb.from('analytics_questions').select('*').eq('id', params.id).single();
    if (error || !data) { container.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Question not found</h3></div>`; return; }
    q = { ...blankQuestion(), ...data, spec: { ...blankQuestion().spec, ...(data.spec || {}) } };
  }
  // Seed a card straight onto a dashboard after saving, if we came from one.
  const returnDashboard = params.dashboard || null;

  let lastResult = null;
  let debounce = null;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-4);flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:var(--space-3)">
        <button class="btn btn-ghost btn-sm" id="back">← Back</button>
        <h1 style="font-size:var(--text-xl);font-weight:var(--font-weight-semibold);margin:0">${q.id ? esc(q.name) : 'New question'}</h1>
      </div>
      <div style="display:flex;gap:var(--space-2);align-items:center">
        <div class="tabs" style="margin:0;border:none">
          <button class="tab ${q.mode === 'builder' ? 'active' : ''}" data-mode="builder">Visual</button>
          <button class="tab ${q.mode === 'sql' ? 'active' : ''}" data-mode="sql">SQL</button>
        </div>
        <button class="btn btn-primary btn-sm" id="save">Save</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card-body" style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
        <span title="Ask in plain English" style="font-size:var(--text-lg)">✨</span>
        <input class="form-input" id="ai-ask" placeholder="Ask in plain English — e.g. “win rate by owner this quarter”, “headcount by department”" style="flex:1;min-width:220px" autocomplete="off">
        <button class="btn btn-primary btn-sm" id="ai-go">Ask AI</button>
        <span id="ai-note" style="font-size:var(--text-xs);color:var(--color-text-tertiary)"></span>
      </div>
    </div>
    <div id="editor-body"></div>
    <div class="card" style="margin-top:var(--space-4)">
      <div class="card-header" style="justify-content:space-between;flex-wrap:wrap;gap:var(--space-2)">
        <span class="card-title">Preview</span>
        <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
          <div id="theme-picker" style="display:flex;gap:4px"></div>
          <div id="viz-picker" style="display:flex;gap:4px"></div>
        </div>
      </div>
      <div class="card-body" id="preview-out" style="min-height:160px"></div>
    </div>
    <div id="analytics-lab"></div>`;

  mountLab(container.querySelector('#analytics-lab'), () => lastResult);

  container.querySelector('#back').addEventListener('click', () => navigate(returnDashboard ? 'analytics/dashboard?id=' + returnDashboard : 'analytics'));
  container.querySelectorAll('.tab[data-mode]').forEach(t => t.addEventListener('click', () => {
    q.mode = t.dataset.mode;
    container.querySelectorAll('.tab[data-mode]').forEach(x => x.classList.toggle('active', x === t));
    renderBody(); runPreview();
  }));
  container.querySelector('#save').addEventListener('click', () => saveQuestion(q, org, returnDashboard));

  // Ask AI → validated builder spec.
  const askInput = container.querySelector('#ai-ask');
  const askNote = container.querySelector('#ai-note');
  const askBtn = container.querySelector('#ai-go');
  async function runAsk() {
    const question = askInput.value.trim();
    if (!question) return;
    askBtn.disabled = true; askNote.textContent = 'Thinking…';
    try {
      const { spec, viz, explanation } = await askAI(question);
      q.mode = 'builder';
      q.spec = { ...blankQuestion().spec, ...spec };
      q.viz = viz;
      container.querySelectorAll('.tab[data-mode]').forEach(x => x.classList.toggle('active', x.dataset.mode === 'builder'));
      renderVizPicker(); renderThemePicker(); renderBody();
      askNote.textContent = explanation || '';
      await runPreview();
    } catch (e) {
      askNote.textContent = '';
      toast(e.message || 'Could not build that query');
    } finally {
      askBtn.disabled = false;
    }
  }
  askBtn.addEventListener('click', runAsk);
  askInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runAsk(); } });

  const bodyEl = container.querySelector('#editor-body');
  const outEl = container.querySelector('#preview-out');
  const vizEl = container.querySelector('#viz-picker');
  const themeEl = container.querySelector('#theme-picker');

  function renderVizPicker() {
    vizEl.innerHTML = VIZ_TYPES.map(v => `
      <button class="btn btn-sm ${q.viz === v.id ? 'btn-primary' : 'btn-ghost'}" data-viz="${v.id}" title="${v.label}">${v.icon}</button>`).join('');
    vizEl.querySelectorAll('[data-viz]').forEach(b => b.addEventListener('click', () => {
      q.viz = b.dataset.viz; renderVizPicker(); paint();
    }));
  }

  function renderThemePicker() {
    themeEl.innerHTML = CHART_THEMES.map(t => `
      <button class="btn btn-sm ${(q.spec.vizTheme || 'mono') === t.id ? 'btn-secondary' : 'btn-ghost'}" data-theme="${t.id}" title="${t.label} palette">${t.label}</button>`).join('');
    themeEl.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => {
      q.spec.vizTheme = b.dataset.theme; renderThemePicker(); paint();
    }));
  }

  async function paint() { await renderChart(outEl, q.viz, lastResult, { theme: q.spec.vizTheme }); }

  async function runPreview() {
    outEl.innerHTML = `<div style="color:var(--color-text-tertiary);font-size:var(--text-sm);padding:var(--space-4)">Running…</div>`;
    try {
      lastResult = q.mode === 'sql'
        ? await runSql(q.spec.sql || '', q.spec.maxRows || 1000)
        : await runBuilder(q.spec);
      const note = lastResult.capped ? ` · showing first ${lastResult.rows.length} (capped)` : '';
      await paint();
      const meta = container.querySelector('#preview-meta');
      if (meta) meta.textContent = `${lastResult.rows.length} row${lastResult.rows.length === 1 ? '' : 's'}${note}`;
    } catch (e) {
      outEl.innerHTML = `<div style="color:var(--color-error);font-size:var(--text-sm);padding:var(--space-4);white-space:pre-wrap">${esc(e.message)}</div>`;
    }
  }
  function scheduleRun() { clearTimeout(debounce); debounce = setTimeout(runPreview, 350); }

  // ---- body renderers -------------------------------------------------------
  function renderBody() {
    if (q.mode === 'sql') return renderSqlBody();
    renderBuilderBody();
  }

  function renderSqlBody() {
    bodyEl.innerHTML = `
      <div class="card"><div class="card-body">
        <div class="form-group" style="margin:0">
          <label class="form-label">Read-only SQL <span style="color:var(--color-text-tertiary);font-weight:400">— SELECT / WITH only; rows limited to what you may see</span></label>
          <textarea class="form-input" id="sql-text" spellcheck="false" style="font-family:var(--font-mono);min-height:140px;resize:vertical" placeholder="select status, count(*) as n from crm_opportunities group by status order by n desc">${esc(q.spec.sql || '')}</textarea>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-3);margin-top:var(--space-3)">
          <button class="btn btn-secondary btn-sm" id="run-sql">Run</button>
          <label style="font-size:var(--text-sm);color:var(--color-text-secondary);display:flex;align-items:center;gap:6px">Row limit
            <input class="form-input form-input-sm" id="sql-max" type="number" min="1" max="5000" value="${q.spec.maxRows || 1000}" style="width:90px">
          </label>
          <span id="preview-meta" style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-left:auto"></span>
        </div>
      </div></div>`;
    const ta = bodyEl.querySelector('#sql-text');
    ta.addEventListener('input', () => { q.spec.sql = ta.value; });
    bodyEl.querySelector('#sql-max').addEventListener('change', e => { q.spec.maxRows = Math.min(Math.max(Number(e.target.value) || 1000, 1), 5000); });
    bodyEl.querySelector('#run-sql').addEventListener('click', runPreview);
    ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runPreview(); } });
  }

  function renderBuilderBody() {
    const model = getModel(q.spec.model);
    const dimFields = model.fields.filter(f => f.dimension);
    const opt = (val, label, sel) => `<option value="${esc(val)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;

    // Column choices for sort include dimensions + measures.
    const sortChoices = [
      ...q.spec.dimensions.map((d, i) => ({ key: `dim${i}`, label: getField(model.key, d.field)?.label || d.field })),
      ...(q.spec.measures.length ? q.spec.measures : [{ agg: 'count' }]).map(m => ({
        key: measureAlias(m), label: measureLabelFor(model, m),
      })),
    ];

    bodyEl.innerHTML = `
    <div class="card"><div class="card-body" style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="form-group" style="margin:0;max-width:340px">
        <label class="form-label">Data</label>
        <select class="form-input" id="model-sel">
          ${Object.values(MODELS).map(m => opt(m.key, `${m.icon} ${m.label}`, m.key === q.spec.model)).join('')}
        </select>
      </div>

      <div>
        <label class="form-label">Summarize (measures)</label>
        <div id="measures" style="display:flex;flex-direction:column;gap:var(--space-2)">
          ${(q.spec.measures.length ? q.spec.measures : [{ agg: 'count' }]).map((m, i) => measureRow(m, i, model)).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" id="add-measure" style="margin-top:var(--space-2)">+ Add measure</button>
      </div>

      <div>
        <label class="form-label">Group by (dimensions)</label>
        <div id="dimensions" style="display:flex;flex-direction:column;gap:var(--space-2)">
          ${q.spec.dimensions.map((d, i) => dimensionRow(d, i, dimFields)).join('') || '<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">No grouping — a single total.</div>'}
        </div>
        <button class="btn btn-ghost btn-sm" id="add-dim" style="margin-top:var(--space-2)">+ Add grouping</button>
      </div>

      <div>
        <label class="form-label">Filters</label>
        <div id="filters" style="display:flex;flex-direction:column;gap:var(--space-2)">
          ${q.spec.filters.map((f, i) => filterRow(f, i, model)).join('') || '<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">No filters — all rows you can see.</div>'}
        </div>
        <button class="btn btn-ghost btn-sm" id="add-filter" style="margin-top:var(--space-2)">+ Add filter</button>
      </div>

      <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:flex-end">
        <div class="form-group" style="margin:0">
          <label class="form-label">Sort by</label>
          <select class="form-input form-input-sm" id="sort-by" style="width:180px">
            ${sortChoices.map(c => opt(c.key, c.label, q.spec.sort?.by === c.key)).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Direction</label>
          <select class="form-input form-input-sm" id="sort-dir" style="width:130px">
            ${opt('desc', 'High → low', (q.spec.sort?.dir || 'desc') === 'desc')}${opt('asc', 'Low → high', q.spec.sort?.dir === 'asc')}
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Row limit</label>
          <input class="form-input form-input-sm" id="limit" type="number" min="1" max="1000" value="${q.spec.limit || 50}" style="width:100px">
        </div>
        <span id="preview-meta" style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-left:auto"></span>
      </div>
    </div></div>`;

    // model change resets fields that no longer exist
    bodyEl.querySelector('#model-sel').addEventListener('change', e => {
      q.spec.model = e.target.value;
      q.spec.dimensions = []; q.spec.filters = []; q.spec.measures = [{ agg: 'count' }]; q.spec.sort = null;
      renderBuilderBody(); runPreview();
    });

    // measures
    bodyEl.querySelector('#add-measure').addEventListener('click', () => { q.spec.measures.push({ agg: 'count' }); renderBuilderBody(); runPreview(); });
    bodyEl.querySelectorAll('[data-measure]').forEach(rowEl => {
      const i = Number(rowEl.dataset.measure);
      rowEl.querySelector('.m-agg').addEventListener('change', e => {
        q.spec.measures[i] = { agg: e.target.value };
        const def = AGGREGATIONS.find(a => a.id === e.target.value);
        if (def?.needsField) {
          const cand = model.fields.filter(f => f.measure && (!def.types || def.types.includes(f.type)));
          q.spec.measures[i].field = cand[0]?.name;
        }
        q.spec.sort = null; // aliases changed
        renderBuilderBody(); runPreview();
      });
      rowEl.querySelector('.m-field')?.addEventListener('change', e => { q.spec.measures[i].field = e.target.value; runPreview(); });
      rowEl.querySelector('.m-del')?.addEventListener('click', () => { q.spec.measures.splice(i, 1); if (!q.spec.measures.length) q.spec.measures = [{ agg: 'count' }]; renderBuilderBody(); runPreview(); });
    });

    // dimensions
    bodyEl.querySelector('#add-dim').addEventListener('click', () => { q.spec.dimensions.push({ field: dimFields[0]?.name }); renderBuilderBody(); runPreview(); });
    bodyEl.querySelectorAll('[data-dim]').forEach(rowEl => {
      const i = Number(rowEl.dataset.dim);
      rowEl.querySelector('.d-field').addEventListener('change', e => {
        q.spec.dimensions[i] = { field: e.target.value };
        const f = getField(model.key, e.target.value);
        if (f && (f.type === 'date' || f.type === 'datetime')) q.spec.dimensions[i].granularity = 'month';
        renderBuilderBody(); runPreview();
      });
      rowEl.querySelector('.d-gran')?.addEventListener('change', e => { q.spec.dimensions[i].granularity = e.target.value; runPreview(); });
      rowEl.querySelector('.d-del').addEventListener('click', () => { q.spec.dimensions.splice(i, 1); renderBuilderBody(); runPreview(); });
    });

    // filters
    bodyEl.querySelector('#add-filter').addEventListener('click', () => {
      const f0 = model.fields[0];
      q.spec.filters.push({ field: f0.name, op: operatorsForType(f0.type)[0].id, value: '' });
      renderBuilderBody(); runPreview();
    });
    bodyEl.querySelectorAll('[data-filter]').forEach(rowEl => {
      const i = Number(rowEl.dataset.filter);
      rowEl.querySelector('.f-field').addEventListener('change', e => {
        const f = getField(model.key, e.target.value);
        q.spec.filters[i] = { field: e.target.value, op: operatorsForType(f.type)[0].id, value: '' };
        renderBuilderBody(); runPreview();
      });
      rowEl.querySelector('.f-op').addEventListener('change', e => { q.spec.filters[i].op = e.target.value; renderBuilderBody(); runPreview(); });
      rowEl.querySelector('.f-val')?.addEventListener('input', e => { q.spec.filters[i].value = e.target.value; scheduleRun(); });
      rowEl.querySelector('.f-del').addEventListener('click', () => { q.spec.filters.splice(i, 1); renderBuilderBody(); runPreview(); });
    });

    // sort / limit
    bodyEl.querySelector('#sort-by').addEventListener('change', e => { q.spec.sort = { by: e.target.value, dir: bodyEl.querySelector('#sort-dir').value }; runPreview(); });
    bodyEl.querySelector('#sort-dir').addEventListener('change', e => { q.spec.sort = { by: bodyEl.querySelector('#sort-by').value, dir: e.target.value }; runPreview(); });
    bodyEl.querySelector('#limit').addEventListener('change', e => { q.spec.limit = Math.min(Math.max(Number(e.target.value) || 50, 1), 1000); runPreview(); });
  }

  function measureRow(m, i, model) {
    const isNamed = (m.agg || '').startsWith('m:');
    const def = AGGREGATIONS.find(a => a.id === m.agg) || AGGREGATIONS[0];
    const named = model.measures || [];
    const fieldSel = (!isNamed && def.needsField) ? `<select class="form-input form-input-sm m-field" style="width:170px">
        ${model.fields.filter(f => f.measure && (!def.types || def.types.includes(f.type))).map(f => `<option value="${esc(f.name)}" ${f.name === m.field ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
      </select>` : '';
    const namedGroup = named.length ? `<optgroup label="Metrics">
        ${named.map(nm => `<option value="m:${esc(nm.key)}" ${m.agg === 'm:' + nm.key ? 'selected' : ''}>${esc(nm.label)}</option>`).join('')}
      </optgroup>` : '';
    return `<div data-measure="${i}" style="display:flex;gap:var(--space-2);align-items:center">
      <select class="form-input form-input-sm m-agg" style="width:190px">
        ${AGGREGATIONS.map(a => `<option value="${a.id}" ${a.id === m.agg ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
        ${namedGroup}
      </select>
      ${fieldSel}
      <button class="btn btn-ghost btn-sm m-del" title="Remove" style="padding:0 8px">✕</button>
    </div>`;
  }

  function dimensionRow(d, i, dimFields) {
    const f = dimFields.find(x => x.name === d.field);
    const gran = (f && (f.type === 'date' || f.type === 'datetime')) ? `<select class="form-input form-input-sm d-gran" style="width:130px">
        ${GRANULARITIES.map(g => `<option value="${g.id}" ${g.id === (d.granularity || 'month') ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}
      </select>` : '';
    return `<div data-dim="${i}" style="display:flex;gap:var(--space-2);align-items:center">
      <select class="form-input form-input-sm d-field" style="width:200px">
        ${dimFields.map(x => `<option value="${esc(x.name)}" ${x.name === d.field ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
      </select>
      ${gran}
      <button class="btn btn-ghost btn-sm d-del" title="Remove" style="padding:0 8px">✕</button>
    </div>`;
  }

  function filterRow(f, i, model) {
    const field = getField(model.key, f.field) || model.fields[0];
    const ops = operatorsForType(field.type);
    const op = ops.find(o => o.id === f.op) || ops[0];
    let valInput = '';
    if (op.value === 1) valInput = `<input class="form-input form-input-sm f-val" style="width:170px" type="${field.type === 'number' || field.type === 'money' ? 'number' : field.type === 'date' && op.id !== 'last_n_days' ? 'date' : 'text'}" value="${esc(f.value ?? '')}" placeholder="${op.id === 'last_n_days' ? 'days' : 'value'}">`;
    else if (op.value === 'n') valInput = `<input class="form-input form-input-sm f-val" style="width:200px" value="${esc(f.value ?? '')}" placeholder="a, b, c">`;
    return `<div data-filter="${i}" style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
      <select class="form-input form-input-sm f-field" style="width:170px">
        ${model.fields.map(x => `<option value="${esc(x.name)}" ${x.name === f.field ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
      </select>
      <select class="form-input form-input-sm f-op" style="width:150px">
        ${ops.map(o => `<option value="${o.id}" ${o.id === f.op ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
      ${valInput}
      <button class="btn btn-ghost btn-sm f-del" title="Remove" style="padding:0 8px">✕</button>
    </div>`;
  }

  renderVizPicker();
  renderThemePicker();
  renderBody();
  runPreview();
}

// ---- save -------------------------------------------------------------------
async function saveQuestion(q, org, returnDashboard) {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-group"><label class="form-label">Name</label>
      <input class="form-input" id="q-name" value="${esc(q.name || '')}" placeholder="e.g. Deals by stage"></div>
    <div class="form-group" style="margin-bottom:0"><label class="form-label">Description <span style="color:var(--color-text-tertiary)">(optional)</span></label>
      <input class="form-input" id="q-desc" value="${esc(q.description || '')}"></div>`;
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-4)';
  footer.innerHTML = `<button class="btn btn-secondary" id="q-cancel">Cancel</button><button class="btn btn-primary" id="q-save">Save question</button>`;
  body.appendChild(footer);
  openModal(q.id ? 'Save changes' : 'Save question', body);

  body.querySelector('#q-cancel').addEventListener('click', closeModal);
  body.querySelector('#q-name').focus();
  body.querySelector('#q-save').addEventListener('click', async () => {
    const name = body.querySelector('#q-name').value.trim();
    if (!name) { toast('Give it a name'); return; }
    const description = body.querySelector('#q-desc').value.trim() || null;
    const { data: { user } } = await sb.auth.getUser();
    const payload = { name, description, mode: q.mode, viz: q.viz, spec: q.spec, updated_at: new Date().toISOString() };

    let savedId = q.id;
    if (q.id) {
      const { error } = await sb.from('analytics_questions').update(payload).eq('id', q.id);
      if (error) { toast('Save failed: ' + error.message); return; }
    } else {
      const { data, error } = await sb.from('analytics_questions')
        .insert({ ...payload, org_id: org.id, created_by: user?.id }).select('id').single();
      if (error) { toast('Save failed: ' + error.message); return; }
      savedId = data.id;
    }
    closeModal();
    toast('Question saved');
    if (returnDashboard) {
      await addToDashboard(returnDashboard, savedId);
      navigate('analytics/dashboard?id=' + returnDashboard);
    } else {
      navigate('analytics/question?id=' + savedId);
    }
  });
}

async function addToDashboard(dashId, questionId) {
  const { data } = await sb.from('analytics_dashboards').select('cards').eq('id', dashId).single();
  const cards = (data?.cards || []);
  if (!cards.some(c => c.question_id === questionId)) cards.push({ question_id: questionId, w: 1 });
  await sb.from('analytics_dashboards').update({ cards, updated_at: new Date().toISOString() }).eq('id', dashId);
}
