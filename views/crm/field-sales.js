import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, initials, avColor } from '../../js/ui.js';

// CRM › Distribution command center. A single operating surface for a Tally
// distribution head running a region through their BDEs (field reps): the
// region's health up top, per-BDE coverage, the partners to act on today, and
// territory-by-territory pressure. Reads the bespoke crm_* analytics RPCs through
// the anon+RLS client, so each org sees only its own data.
// (First of the RTcompu distribution suite; partner-360 + telecaller console follow.)

// Indian money: ₹84.9L, ₹1.2Cr — far more readable than raw rupees here.
function inr(n) {
  n = Number(n) || 0;
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + 'Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + 'L';
  if (n >= 1e3) return '₹' + Math.round(n / 1e3) + 'K';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
const pct = (a, b) => !b ? 0 : Math.round((a / b) * 100);
const num = (n) => n == null ? '—' : Number(n).toLocaleString('en-IN');

// Machine reason keys → human labels + severity token.
const REASON = {
  stopped_buying: { label: 'Stopped buying', sev: 'error' },
  tss_overdue: { label: 'TSS overdue', sev: 'error' },
  not_visited: { label: 'Not visited', sev: 'warning' },
  not_called: { label: 'Not called', sev: 'warning' },
  base_no_buy: { label: 'Base · no buy', sev: 'warning' },
  never_bought: { label: 'Never bought', sev: 'neutral' },
};
const reasonLabel = (k) => REASON[k]?.label || String(k).replace(/_/g, ' ');
const reasonSev = (k) => REASON[k]?.sev || 'neutral';

export default async function crmDistribution(container) {
  const org = getOrg();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title" style="margin:0">Distribution</h1>
        <p class="page-subtitle" style="margin:0">${esc(org?.name || 'Region')} · run the region through your BDEs</p>
      </div>
      <a href="#/crm" class="btn btn-secondary">← CRM</a>
    </div>
    <div id="fs-body"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
  `;

  if (!org) { document.getElementById('fs-body').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  const [coverageRes, territoryRes, actionsRes, usersRes] = await Promise.all([
    sb.rpc('crm_coverage'),
    sb.rpc('crm_territory_potential'),
    sb.rpc('crm_partner_actions'),
    sb.from('users').select('id, full_name, email'),
  ]);

  const body = document.getElementById('fs-body');
  const err = coverageRes.error || territoryRes.error || actionsRes.error;
  if (err) { body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">Couldn't load distribution data</div><div class="empty-state-desc">${esc(err.message)}</div></div>`; toast('Distribution: ' + err.message); return; }

  const coverageRows = coverageRes.data || [];
  const territories = (territoryRes.data || []).slice().sort((a, b) => (Number(b.open_value) || 0) - (Number(a.open_value) || 0));
  const actions = actionsRes.data || [];
  const nameOf = {};
  (usersRes.data || []).forEach(u => { nameOf[u.id] = u.full_name || u.email; });

  const total = coverageRows.reduce((a, r) => ({
    total: a.total + (Number(r.total) || 0), called: a.called + (Number(r.called) || 0),
    visited: a.visited + (Number(r.visited) || 0), sold: a.sold + (Number(r.sold) || 0),
    touched: a.touched + (Number(r.touched) || 0),
  }), { total: 0, called: 0, visited: 0, sold: 0, touched: 0 });

  if (!total.total && !territories.length && !actions.length) {
    body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M3 3v18h18M18 17V9M13 17V5M8 17v-3"/></svg></div>
      <div class="empty-state-title">No distribution data yet</div>
      <div class="empty-state-desc">This command center lights up once partner accounts and a sales report are imported.</div>
    </div>`;
    return;
  }

  // BDEs, ranked by book size. Null owner → an "Unassigned" bucket.
  const bdes = coverageRows.slice()
    .map(r => ({ ...r, name: r.owner_id ? (nameOf[r.owner_id] || 'BDE') : 'Unassigned' }))
    .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));

  const openValue = territories.reduce((s, t) => s + (Number(t.open_value) || 0), 0);
  const maxTerr = Math.max(1, ...territories.map(t => Number(t.open_value) || 0));

  const hero = [
    { label: 'Partners', value: num(total.total), sub: 'in the base' },
    { label: 'Buying this FY', value: num(total.sold), sub: `${pct(total.sold, total.total)}% of base`, accent: true },
    { label: 'Open value', value: inr(openValue), sub: 'across territories' },
    { label: 'BDEs', value: num(bdes.filter(b => b.owner_id).length), sub: 'covering the region' },
    { label: 'To act on', value: num(actions.length), sub: 'flagged partners', warn: true },
  ];

  body.innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:var(--space-3)">
      ${hero.map(h => `<div class="card"><div class="card-body">
        <div class="u-meta">${esc(h.label)}</div>
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);line-height:1.1;margin:var(--space-1) 0;color:${h.accent ? 'var(--color-accent)' : h.warn ? 'var(--color-warning)' : 'var(--color-text-primary)'}">${h.value}</div>
        <div class="u-sm-muted">${esc(h.sub)}</div>
      </div></div>`).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);align-items:start;margin-bottom:var(--space-4)">
      <!-- BDE coverage -->
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:var(--font-weight-semibold)">BDE coverage</span>
          <span class="u-sm-muted">${pct(total.touched, total.total)}% region touched</span>
        </div>
        <div class="table-wrap" style="max-height:52vh;overflow-y:auto"><table class="table">
          <thead><tr><th>BDE</th><th style="text-align:right">Partners</th><th>Coverage</th><th style="text-align:right">Buying</th></tr></thead>
          <tbody>${bdes.length ? bdes.map(b => {
            const cov = pct(b.touched, b.total);
            return `<tr>
              <td><div class="u-row-3">
                <div style="width:28px;height:28px;border-radius:var(--radius-full);background:${avColor(b.name)};display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(b.name)}</div>
                <span style="font-weight:var(--font-weight-medium)">${esc(b.name)}</span>
              </div></td>
              <td style="text-align:right">${num(b.total)}</td>
              <td>
                <div style="display:flex;align-items:center;gap:var(--space-2)">
                  <div style="flex:1;height:6px;min-width:44px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);overflow:hidden"><div style="height:100%;width:${cov}%;background:${cov >= 60 ? 'var(--color-success)' : cov >= 35 ? 'var(--color-accent)' : 'var(--color-warning)'}"></div></div>
                  <span class="u-meta" style="width:34px;text-align:right">${cov}%</span>
                </div>
              </td>
              <td style="text-align:right">${num(b.sold)}</td>
            </tr>`;
          }).join('') : '<tr><td colspan="4" class="u-sm-muted" style="padding:var(--space-4)">No BDE coverage data.</td></tr>'}</tbody>
        </table></div>
      </div>

      <!-- Territory pressure -->
      <div class="card">
        <div class="card-header" style="font-weight:var(--font-weight-semibold)">Territories</div>
        <div style="max-height:52vh;overflow-y:auto">
          ${territories.length ? territories.map(t => {
            const w = Math.round((Number(t.open_value) || 0) / maxTerr * 100);
            return `<div style="padding:var(--space-3);border-bottom:1px solid var(--color-border)">
              <div style="display:flex;justify-content:space-between;gap:var(--space-2);margin-bottom:var(--space-1)">
                <span style="font-weight:var(--font-weight-medium)">${esc(t.territory || '(none)')}</span>
                <span style="font-weight:var(--font-weight-semibold)">${inr(t.open_value)}</span>
              </div>
              <div style="height:6px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);overflow:hidden;margin-bottom:var(--space-2)">
                <div style="height:100%;width:${w}%;background:var(--color-accent)"></div>
              </div>
              <div class="u-meta">${num(t.partners)} partners · ${num(t.stopped_buying)} stopped · ${num(t.not_visited)} not visited</div>
            </div>`;
          }).join('') : '<div class="u-sm-muted" style="padding:var(--space-4)">No territory data.</div>'}
        </div>
      </div>
    </div>

    <!-- Act today -->
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        <span style="font-weight:var(--font-weight-semibold)">Act today</span>
        <input type="text" class="form-input" id="fs-search" placeholder="Search partner, BDE, region, hub..." style="flex:1;min-width:200px;height:34px">
        <span class="u-meta" id="fs-count"></span>
      </div>
      <div id="fs-actions"></div>
    </div>
  `;

  const searchEl = document.getElementById('fs-search');
  const LIMIT = 100;

  function renderActions() {
    const wrap = document.getElementById('fs-actions');
    const q = (searchEl.value || '').toLowerCase();
    let rows = actions;
    if (q) rows = rows.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.region || '').toLowerCase().includes(q) ||
      (a.hub || '').toLowerCase().includes(q) ||
      (a.external_id || '').toLowerCase().includes(q) ||
      (nameOf[a.owner_id] || '').toLowerCase().includes(q) ||
      (a.telecaller || '').toLowerCase().includes(q));

    document.getElementById('fs-count').textContent = `${rows.length.toLocaleString('en-IN')}${rows.length > LIMIT ? ` · top ${LIMIT}` : ''}`;

    if (!rows.length) { wrap.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">No matching partners</div></div>`; return; }

    wrap.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Partner</th><th>BDE</th><th>Why</th><th style="text-align:right">Last buy</th><th style="text-align:right">Value FY</th></tr></thead>
      <tbody>${rows.slice(0, LIMIT).map(a => `<tr class="fs-row" data-id="${a.account_id}" style="cursor:pointer">
        <td>
          <div style="font-weight:var(--font-weight-medium)">${esc(a.name || '—')}</div>
          <div class="u-meta">${esc([a.hub, a.region].filter(Boolean).join(' · ') || '—')}${a.tier ? ` · ${esc(a.tier)}` : ''}</div>
        </td>
        <td class="u-sm-muted">${esc(nameOf[a.owner_id] || a.telecaller || '—')}</td>
        <td><div class="u-row-wrap">${(a.reasons || []).map(r => `<span class="badge badge-${reasonSev(r)}">${esc(reasonLabel(r))}</span>`).join('') || '—'}</div></td>
        <td style="text-align:right">${a.days_since_purchase == null ? 'no buy' : esc(String(a.days_since_purchase)) + 'd'}</td>
        <td style="text-align:right;font-weight:var(--font-weight-semibold)">${inr(a.value_this_fy)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;

    wrap.querySelectorAll('.fs-row').forEach(row => {
      if (row.dataset.id && row.dataset.id !== 'null') row.addEventListener('click', () => { window.location.hash = `#/crm/account?id=${row.dataset.id}`; });
    });
  }

  renderActions();
  searchEl.addEventListener('input', renderActions);
}
