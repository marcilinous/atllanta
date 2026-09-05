// Analytics home — the library of saved questions and dashboards, plus entry
// points to build a new one. Metabase-style: questions are reusable queries,
// dashboards arrange them into a grid.

import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, timeAgo, toast } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { MODELS } from '../../js/analytics/models.js';
import { VIZ_TYPES } from '../../js/analytics/charts.js';

const vizIcon = v => (VIZ_TYPES.find(t => t.id === v)?.icon) || '▦';

export default async function analyticsHome(container) {
  const org = getOrg();
  if (!org) { container.innerHTML = '<div class="empty-state"><h3 class="empty-state-title">No organization</h3></div>'; return; }

  container.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading analytics…</div>`;

  const [{ data: questions, error: qErr }, { data: dashboards, error: dErr }] = await Promise.all([
    sb.from('analytics_questions').select('id, name, description, mode, viz, spec, updated_at').order('updated_at', { ascending: false }),
    sb.from('analytics_dashboards').select('id, name, description, cards, updated_at').order('updated_at', { ascending: false }),
  ]);
  if (qErr || dErr) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3 class="empty-state-title">Couldn't load analytics</h3><p class="empty-state-desc">${esc((qErr || dErr).message)}</p></div>`;
    return;
  }

  const modelLabel = k => MODELS[k]?.label || (k === undefined ? 'Custom SQL' : k);

  container.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-6);flex-wrap:wrap">
      <div>
        <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-1)">Analytics</h1>
        <p style="font-size:var(--text-base);color:var(--color-text-secondary);margin:0">Explore your data, save questions, and build dashboards.</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-secondary" id="new-dashboard">+ Dashboard</button>
        <button class="btn btn-primary" id="new-question">+ New question</button>
      </div>
    </div>

    <div class="tabs" style="margin-bottom:var(--space-5)">
      <button class="tab active" data-tab="questions">Questions <span style="color:var(--color-text-tertiary)">${(questions || []).length}</span></button>
      <button class="tab" data-tab="dashboards">Dashboards <span style="color:var(--color-text-tertiary)">${(dashboards || []).length}</span></button>
    </div>

    <div data-panel="questions">
      ${(questions || []).length ? `<div class="stat-grid">${(questions || []).map(q => `
        <a href="#/analytics/question?id=${q.id}" class="card" style="text-decoration:none;cursor:pointer">
          <div class="card-body" style="display:flex;flex-direction:column;gap:var(--space-2)">
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <span style="font-size:var(--text-lg)">${vizIcon(q.viz)}</span>
              <h3 class="card-title" style="margin:0;color:var(--color-text-primary)">${esc(q.name)}</h3>
            </div>
            <p style="margin:0;font-size:var(--text-sm);color:var(--color-text-secondary);min-height:18px">${esc(q.description || modelLabel(q.spec?.model))}</p>
            <span style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-1)">${q.mode === 'sql' ? 'SQL · ' : ''}Updated ${timeAgo(q.updated_at)}</span>
          </div>
        </a>`).join('')}</div>`
        : emptyState('No saved questions yet', 'Build your first question to start exploring.', 'new-question-2', '+ New question')}
    </div>

    <div data-panel="dashboards" hidden>
      ${(dashboards || []).length ? `<div class="stat-grid">${(dashboards || []).map(d => `
        <a href="#/analytics/dashboard?id=${d.id}" class="card" style="text-decoration:none;cursor:pointer">
          <div class="card-body" style="display:flex;flex-direction:column;gap:var(--space-2)">
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <span style="font-size:var(--text-lg)">📊</span>
              <h3 class="card-title" style="margin:0;color:var(--color-text-primary)">${esc(d.name)}</h3>
            </div>
            <p style="margin:0;font-size:var(--text-sm);color:var(--color-text-secondary);min-height:18px">${esc(d.description || '')}</p>
            <span style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-1)">${(d.cards || []).length} card${(d.cards || []).length === 1 ? '' : 's'} · Updated ${timeAgo(d.updated_at)}</span>
          </div>
        </a>`).join('')}</div>`
        : emptyState('No dashboards yet', 'Group saved questions into a dashboard.', 'new-dashboard-2', '+ New dashboard')}
    </div>`;

  // Tabs
  container.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    container.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    container.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== t.dataset.tab; });
  }));

  const goNewQuestion = () => navigate('analytics/question');
  container.querySelector('#new-question')?.addEventListener('click', goNewQuestion);
  container.querySelector('#new-question-2')?.addEventListener('click', goNewQuestion);
  const goNewDashboard = () => createDashboard(org.id);
  container.querySelector('#new-dashboard')?.addEventListener('click', goNewDashboard);
  container.querySelector('#new-dashboard-2')?.addEventListener('click', goNewDashboard);
}

function emptyState(title, desc, btnId, btnLabel) {
  return `<div class="empty-state" style="padding:var(--space-12)">
    <div class="empty-state-icon">📈</div>
    <h3 class="empty-state-title">${esc(title)}</h3>
    <p class="empty-state-desc">${esc(desc)}</p>
    <button class="btn btn-primary" id="${btnId}" style="margin-top:var(--space-3)">${esc(btnLabel)}</button>
  </div>`;
}

async function createDashboard(orgId) {
  const name = prompt('Dashboard name');
  if (!name) return;
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb.from('analytics_dashboards')
    .insert({ org_id: orgId, name: name.trim(), created_by: user?.id, cards: [] })
    .select('id').single();
  if (error) { toast('Could not create dashboard: ' + error.message); return; }
  navigate('analytics/dashboard?id=' + data.id);
}
