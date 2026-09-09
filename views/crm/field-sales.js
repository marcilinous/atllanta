import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';

// CRM › Field Sales. A clean resurfacing of the bespoke distribution analytics
// (partner action list, territory health, coverage) that were custom-built in
// the DB for the RTcompu tenant. Reads the existing crm_* RPCs through the
// anon+RLS client — so each org sees only its own data, and orgs without an
// imported sales report see an empty state.
export default async function crmFieldSales(container) {
  const org = getOrg();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Field Sales</h1>
        <p class="page-subtitle">Partners to act on, by territory</p>
      </div>
      <a href="#/crm" class="btn btn-secondary">← CRM</a>
    </div>
    <div id="fs-body"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
  `;

  if (!org) { document.getElementById('fs-body').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  const [actionsRes, territoryRes, inactiveRes] = await Promise.all([
    sb.rpc('crm_partner_actions'),
    sb.rpc('crm_territory_potential'),
    sb.rpc('crm_inactive_but_buying'),
  ]);

  const body = document.getElementById('fs-body');
  const err = actionsRes.error || territoryRes.error || inactiveRes.error;
  if (err) { body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">Couldn't load field-sales data</div><div class="empty-state-desc">${esc(err.message)}</div></div>`; toast('Field Sales: ' + err.message); return; }

  const actions = actionsRes.data || [];
  const territories = territoryRes.data || [];
  const inactive = inactiveRes.data || [];

  if (!actions.length && !territories.length) {
    body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M3 3v18h18M18 17V9M13 17V5M8 17v-3"/></svg></div>
      <div class="empty-state-title">No field-sales data yet</div>
      <div class="empty-state-desc">This view lights up once partner accounts and a sales report have been imported.</div>
    </div>`;
    return;
  }

  const num = (n) => n == null ? '—' : Number(n).toLocaleString();
  const money = (n) => n == null || Number(n) === 0 ? '—' : '₹' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const openValue = territories.reduce((s, t) => s + (Number(t.open_value) || 0), 0);

  const kpis = [
    { label: 'Partners to act on', value: num(actions.length) },
    { label: 'Territories', value: num(territories.length) },
    { label: 'Open value', value: money(openValue) },
    { label: 'Inactive but buying', value: num(inactive.length) },
  ];

  body.innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-bottom:var(--space-4)">
      ${kpis.map(k => `<div class="card"><div class="card-body">
        <div class="u-meta">${esc(k.label)}</div>
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);margin-top:var(--space-1)">${k.value}</div>
      </div></div>`).join('')}
    </div>

    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card-header" style="font-weight:var(--font-weight-semibold)">Territory health</div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Territory</th><th style="text-align:right">Partners</th><th style="text-align:right">Open value</th><th style="text-align:right">TSS overdue</th><th style="text-align:right">Stopped buying</th><th style="text-align:right">Not visited</th></tr></thead>
        <tbody>${territories.length ? territories.map(t => `<tr>
          <td style="font-weight:var(--font-weight-medium)">${esc(t.territory || '(none)')}</td>
          <td style="text-align:right">${num(t.partners)}</td>
          <td style="text-align:right">${money(t.open_value)}</td>
          <td style="text-align:right">${num(t.tss_overdue)}</td>
          <td style="text-align:right">${num(t.stopped_buying)}</td>
          <td style="text-align:right">${num(t.not_visited)}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="u-sm-muted" style="padding:var(--space-4)">No territory data.</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        <span style="font-weight:var(--font-weight-semibold)">Partners to act on</span>
        <input type="text" class="form-input" id="fs-search" placeholder="Search partner, region, hub..." style="max-width:280px;height:34px;flex:1;min-width:180px">
        <span class="u-meta" id="fs-count"></span>
      </div>
      <div id="fs-actions"></div>
    </div>
  `;

  const searchEl = document.getElementById('fs-search');
  const LIMIT = 150;

  function renderActions() {
    const wrap = document.getElementById('fs-actions');
    const q = (searchEl.value || '').toLowerCase();
    let rows = actions;
    if (q) rows = rows.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.region || '').toLowerCase().includes(q) ||
      (a.hub || '').toLowerCase().includes(q) ||
      (a.external_id || '').toLowerCase().includes(q));

    document.getElementById('fs-count').textContent = `${rows.length.toLocaleString()} partner${rows.length === 1 ? '' : 's'}${rows.length > LIMIT ? ` · showing ${LIMIT}` : ''}`;

    if (!rows.length) { wrap.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">No matching partners</div></div>`; return; }

    wrap.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Partner</th><th>Territory</th><th>Tier</th><th>Why</th><th style="text-align:right">Last buy</th><th style="text-align:right">Value FY</th></tr></thead>
      <tbody>${rows.slice(0, LIMIT).map(a => `<tr>
        <td>
          <div style="font-weight:var(--font-weight-medium)">${esc(a.name || '—')}</div>
          ${a.external_id ? `<div class="u-meta">${esc(a.external_id)}</div>` : ''}
        </td>
        <td>${esc([a.region, a.hub].filter(Boolean).join(' · ') || '—')}</td>
        <td>${a.tier ? `<span class="badge badge-info">${esc(a.tier)}</span>` : '—'}</td>
        <td><div class="u-row-wrap">${(a.reasons || []).map(r => `<span class="badge badge-warning">${esc(r)}</span>`).join(' ') || '—'}</div></td>
        <td style="text-align:right">${a.days_since_purchase == null ? '—' : esc(String(a.days_since_purchase)) + 'd'}</td>
        <td style="text-align:right">${money(a.value_this_fy)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  renderActions();
  searchEl.addEventListener('input', renderActions);
}
