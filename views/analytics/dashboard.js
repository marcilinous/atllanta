// Dashboard — a grid of saved questions, each run live against the viewer's
// RLS-scoped data. Cards store only a question_id and a width; results are
// fetched fresh on view so every viewer sees their own permitted numbers.

import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { navigate, routeParams } from '../../js/router.js';
import { runQuestion } from '../../js/analytics/engine.js';
import { renderChart } from '../../js/analytics/charts.js';

export default async function dashboardView(container) {
  const org = getOrg();
  const { id } = routeParams();
  if (!id) { navigate('analytics'); return; }

  container.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading dashboard…</div>`;

  const { data: dash, error } = await sb.from('analytics_dashboards').select('*').eq('id', id).single();
  if (error || !dash) { container.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Dashboard not found</h3></div>`; return; }

  const { data: allQuestions } = await sb.from('analytics_questions').select('id, name, description, viz, mode, spec').order('name');
  const qById = Object.fromEntries((allQuestions || []).map(x => [x.id, x]));
  let cards = Array.isArray(dash.cards) ? [...dash.cards] : [];
  let editing = false;

  function shell() {
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-4);flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:var(--space-3)">
          <button class="btn btn-ghost btn-sm" id="back">← Analytics</button>
          <div>
            <h1 style="font-size:var(--text-xl);font-weight:var(--font-weight-semibold);margin:0">${esc(dash.name)}</h1>
            ${dash.description ? `<p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:2px 0 0">${esc(dash.description)}</p>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:var(--space-2)">
          <button class="btn btn-secondary btn-sm" id="add-card">+ Add question</button>
          <button class="btn ${editing ? 'btn-primary' : 'btn-secondary'} btn-sm" id="toggle-edit">${editing ? 'Done' : 'Edit'}</button>
          ${editing ? '<button class="btn btn-ghost btn-sm" id="rename">Rename</button><button class="btn btn-danger btn-sm" id="delete-dash">Delete</button>' : ''}
        </div>
      </div>
      <div id="grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-4)"></div>`;

    container.querySelector('#back').addEventListener('click', () => navigate('analytics'));
    container.querySelector('#add-card').addEventListener('click', pickQuestion);
    container.querySelector('#toggle-edit').addEventListener('click', () => { editing = !editing; shell(); });
    container.querySelector('#rename')?.addEventListener('click', renameDash);
    container.querySelector('#delete-dash')?.addEventListener('click', deleteDash);
    renderGrid();
  }

  function renderGrid() {
    const grid = container.querySelector('#grid');
    if (!cards.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:var(--space-12)">
        <div class="empty-state-icon">📊</div>
        <h3 class="empty-state-title">Empty dashboard</h3>
        <p class="empty-state-desc">Add saved questions to build it out.</p>
        <button class="btn btn-primary" id="add-card-2" style="margin-top:var(--space-3)">+ Add question</button>
      </div>`;
      grid.querySelector('#add-card-2').addEventListener('click', pickQuestion);
      return;
    }
    grid.innerHTML = cards.map((c, i) => {
      const q = qById[c.question_id];
      const span = (Number(c.w) === 2) ? 'grid-column:1/-1' : '';
      if (!q) return `<div class="card" style="${span}"><div class="card-body" style="color:var(--color-text-tertiary);font-size:var(--text-sm)">This question was deleted. ${editing ? '<button class="btn btn-ghost btn-sm" data-remove="' + i + '">Remove</button>' : ''}</div></div>`;
      return `<div class="card" style="${span}">
        <div class="card-header" style="justify-content:space-between">
          <a href="#/analytics/question?id=${q.id}" class="card-title" style="text-decoration:none;color:var(--color-text-primary)">${esc(q.name)}</a>
          ${editing ? `<div style="display:flex;gap:4px">
            <button class="btn btn-ghost btn-sm" data-width="${i}" title="Toggle width">${Number(c.w) === 2 ? '▭' : '▬'}</button>
            <button class="btn btn-ghost btn-sm" data-remove="${i}" title="Remove">✕</button>
          </div>` : ''}
        </div>
        <div class="card-body" id="card-out-${i}" style="min-height:120px"><div style="color:var(--color-text-tertiary);font-size:var(--text-sm)">Loading…</div></div>
      </div>`;
    }).join('');

    grid.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => { cards.splice(Number(b.dataset.remove), 1); persist(); renderGrid(); }));
    grid.querySelectorAll('[data-width]').forEach(b => b.addEventListener('click', () => { const i = Number(b.dataset.width); cards[i].w = Number(cards[i].w) === 2 ? 1 : 2; persist(); renderGrid(); }));

    // Run each card's query.
    cards.forEach(async (c, i) => {
      const q = qById[c.question_id];
      const out = container.querySelector(`#card-out-${i}`);
      if (!q || !out) return;
      try { out.innerHTML = renderChart(q.viz, await runQuestion(q), { theme: q.spec?.vizTheme }); }
      catch (e) { out.innerHTML = `<div style="color:var(--color-error);font-size:var(--text-sm)">${esc(e.message)}</div>`; }
    });
  }

  async function persist() {
    const { error } = await sb.from('analytics_dashboards').update({ cards, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) toast('Could not save layout: ' + error.message);
  }

  function pickQuestion() {
    const available = (allQuestions || []);
    const body = document.createElement('div');
    if (!available.length) {
      body.innerHTML = `<p style="color:var(--color-text-secondary);font-size:var(--text-sm)">No saved questions yet.</p>`;
      const b = document.createElement('button'); b.className = 'btn btn-primary'; b.textContent = '+ New question';
      b.addEventListener('click', () => { closeModal(); navigate('analytics/question?dashboard=' + id); });
      body.appendChild(b);
      openModal('Add a question', body);
      return;
    }
    body.innerHTML = `
      <p style="color:var(--color-text-secondary);font-size:var(--text-sm);margin:0 0 var(--space-3)">Pick a saved question, or build a new one.</p>
      <div style="display:flex;flex-direction:column;gap:var(--space-2);max-height:340px;overflow:auto">
        ${available.map(q => `<button class="btn btn-secondary" data-q="${q.id}" style="justify-content:flex-start;text-align:left">${esc(q.name)}</button>`).join('')}
      </div>
      <button class="btn btn-ghost btn-block" id="new-q" style="margin-top:var(--space-3)">+ Build a new question</button>`;
    openModal('Add a question', body);
    body.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
      if (!cards.some(c => c.question_id === b.dataset.q)) cards.push({ question_id: b.dataset.q, w: 1 });
      persist(); closeModal(); renderGrid();
    }));
    body.querySelector('#new-q').addEventListener('click', () => { closeModal(); navigate('analytics/question?dashboard=' + id); });
  }

  async function renameDash() {
    const name = prompt('Dashboard name', dash.name);
    if (!name) return;
    const { error } = await sb.from('analytics_dashboards').update({ name: name.trim(), updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast('Rename failed: ' + error.message); return; }
    dash.name = name.trim(); shell();
  }

  async function deleteDash() {
    if (!confirm('Delete this dashboard? Saved questions are not affected.')) return;
    const { error } = await sb.from('analytics_dashboards').delete().eq('id', id);
    if (error) { toast('Delete failed: ' + error.message); return; }
    toast('Dashboard deleted'); navigate('analytics');
  }

  shell();
}
