// Opportunity engine — the five scored reasons to go see a partner.
//
// Reads crm_opportunity_signals(): one row per (partner, live signal), each
// with the rupees at stake (opportunity_value) and a winnability-weighted
// score. Ranking is on score so a pile of cheap coverage check-ins can never
// outrank a live renewal; the rupee figure is still shown, because that is
// the number a BDE argues about.
import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, showError, loadingSkeleton, toast, downloadCsv, timeAgo } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { fetchAllRpc, canManageData } from './common.js';

export const inr = (n) => {
  n = Math.round(+n || 0);
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
  return '₹' + n.toLocaleString('en-IN');
};

// Display metadata per signal. Order here is the order of the cards, which is
// the order the engine wants the day worked: cheapest wins first.
// Score is a priority index, not money: the 1.85x renewal multiplier can push
// it above the rupees actually at stake, and rendering that with a currency
// symbol reads as a bug. Money gets inr(); score gets this.
export const num = (n) => {
  n = Math.round(+n || 0);
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + ' L';
  return n.toLocaleString('en-IN');
};

export const SIGNALS = [
  { key: 'reactivation', title: 'Reactivation', color: 'var(--color-success)',
    desc: 'Bought TP last year, nothing this year, barely visited — the cheapest wins' },
  { key: 'renewal_risk', title: 'Renewal risk', color: 'var(--color-error)',
    desc: 'TSS lapsed this year. Uncontacted ones are weighted 1.85x' },
  { key: 'growth', title: 'Growth', color: 'var(--color-accent)',
    desc: 'Serves a real customer base but bills little through RT' },
  { key: 'different_approach', title: 'Different approach', color: 'var(--color-warning)',
    desc: 'Visited 3+ times with no sale — a pricing problem, not a coverage one' },
  { key: 'coverage_checkin', title: 'Coverage check-in', color: 'var(--color-text-secondary)',
    desc: 'No other trigger, but unvisited for 120+ days' },
];
const META = Object.fromEntries(SIGNALS.map(s => [s.key, s]));

export default async function crmOpportunityEngine(container) {
  const org = getOrg();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }
  const isAdmin = ['owner', 'admin'].includes(getMembership()?.role);

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Opportunity engine</h1>
      <p class="page-subtitle">Every partner worth a call or a visit right now, and why. Ranked by winnable value, not raw revenue.</p>
    </div>
    <div id="oe-meta" style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-4)"></div>
    <div id="oe-kpi" class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3);margin-bottom:var(--space-5)"></div>
    <div id="oe-cards" class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--space-3);margin-bottom:var(--space-6)">${loadingSkeleton(3)}</div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <span class="card-title" id="oe-title">Priority list</span>
        <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
          <select class="form-input" id="oe-hub" style="max-width:180px;height:32px"></select>
          <input type="text" class="form-input" id="oe-search" placeholder="Search partner / district" style="max-width:200px;height:32px">
          <button class="btn btn-ghost btn-sm" id="oe-all" style="display:none">Show all</button>
        </div>
      </div>
      <div id="oe-list">${loadingSkeleton(6)}</div>
    </div>
  `;

  const [{ data: rows, error }, computedAt] = await Promise.all([
    fetchAllRpc('crm_opportunity_signals'),
    sb.rpc('crm_opportunity_computed_at').then(r => r.data).catch(() => null),
  ]);
  if (error) {
    showError(container.querySelector('#oe-list'), 'Failed to load opportunities: ' + error.message, () => crmOpportunityEngine(container));
    return;
  }
  const data = rows || [];

  // Scores are only as fresh as the nightly refresh — say so rather than let
  // a stale number pass as live.
  const metaEl = container.querySelector('#oe-meta');
  const stamp = computedAt ? `Scores computed ${timeAgo(computedAt)}` : 'Scores not yet computed';
  metaEl.innerHTML = `${esc(stamp)}${isAdmin ? ` · <a id="oe-refresh" style="color:var(--color-accent);cursor:pointer">Recompute now</a>` : ''}`;
  container.querySelector('#oe-refresh')?.addEventListener('click', async (e) => {
    e.target.textContent = 'Recomputing…';
    const { error: rErr } = await sb.rpc('crm_refresh_opportunity_features');
    if (rErr) { toast('Could not recompute: ' + rErr.message); e.target.textContent = 'Recompute now'; return; }
    toast('Opportunity scores recomputed');
    crmOpportunityEngine(container);
  });

  if (!data.length) {
    container.querySelector('#oe-cards').innerHTML = '';
    container.querySelector('#oe-list').innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
      <div class="empty-state-title">No open opportunities</div>
      <div class="empty-state-desc">Either every partner in your patch is covered, or the activation reports have not been imported yet.</div></div>`;
    return;
  }

  const totalScore = data.reduce((t, r) => t + (+r.score || 0), 0);
  const totalValue = data.reduce((t, r) => t + (+r.opportunity_value || 0), 0);
  const partners = new Set(data.map(r => r.account_id)).size;
  const kpi = (l, v, s, c) => `<div class="card"><div class="card-body">
    <div style="font-size:var(--text-xs);color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.04em">${esc(l)}</div>
    <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);${c ? `color:${c}` : ''}">${v}</div>
    ${s ? `<div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(s)}</div>` : ''}</div></div>`;
  container.querySelector('#oe-kpi').innerHTML =
    kpi('Partners to work', partners.toLocaleString('en-IN'), `${data.length.toLocaleString('en-IN')} signals`) +
    kpi('Value at stake', inr(totalValue), 'rupees in play', 'var(--color-success)') +
    kpi('Priority score', num(totalScore), 'value x winnability', 'var(--color-accent)');

  // Hub filter — the same territories the PJP calendar plans against.
  const hubs = [...new Set(data.map(r => r.hub).filter(Boolean))].sort();
  const hubSel = container.querySelector('#oe-hub');
  hubSel.innerHTML = `<option value="">All territories</option>` +
    hubs.map(h => `<option value="${esc(h)}">${esc(h)}</option>`).join('');

  let filterKey = null, search = '', hub = '';
  const titleEl = container.querySelector('#oe-title');
  const allBtn = container.querySelector('#oe-all');

  function renderCards() {
    const scope = hub ? data.filter(r => r.hub === hub) : data;
    container.querySelector('#oe-cards').innerHTML = SIGNALS.map(sgn => {
      const list = scope.filter(r => r.opportunity_type === sgn.key);
      const val = list.reduce((t, r) => t + (+r.opportunity_value || 0), 0);
      return `<div class="card oe-card" data-key="${sgn.key}" style="cursor:pointer;border-left:3px solid ${sgn.color};${filterKey === sgn.key ? 'box-shadow:var(--shadow-md)' : ''}">
        <div class="card-body">
          <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold)">${list.length.toLocaleString('en-IN')}</div>
          <div style="font-weight:var(--font-weight-medium);margin-top:var(--space-1)">${esc(sgn.title)}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:2px">${esc(sgn.desc)}</div>
          <div style="font-size:var(--text-sm);color:${sgn.color};font-weight:var(--font-weight-semibold);margin-top:var(--space-2)">${inr(val)}</div>
        </div>
      </div>`;
    }).join('');
    container.querySelectorAll('.oe-card').forEach(c => c.addEventListener('click', () => {
      filterKey = filterKey === c.dataset.key ? null : c.dataset.key;
      renderCards(); renderList();
    }));
  }

  function currentList() {
    let list = data;
    if (hub) list = list.filter(r => r.hub === hub);
    if (filterKey) list = list.filter(r => r.opportunity_type === filterKey);
    if (search) list = list.filter(r =>
      (r.name || '').toLowerCase().includes(search) ||
      (r.district_new || '').toLowerCase().includes(search) ||
      (r.external_id || '').toLowerCase().includes(search));
    return list;
  }

  function renderList() {
    const list = currentList();
    titleEl.textContent = (filterKey ? META[filterKey].title : 'Priority list') + ` (${list.length.toLocaleString('en-IN')})`;
    allBtn.style.display = (filterKey || hub || search) ? '' : 'none';
    const el = container.querySelector('#oe-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">Nothing matches</div></div>`;
      return;
    }
    el.innerHTML = `<div class="table-wrap" style="max-height:64vh;overflow:auto"><table class="table">
      <thead><tr>
        <th>Partner</th><th>Territory</th><th>Why</th><th>Owner</th>
        <th style="text-align:right">Value at stake</th><th style="text-align:right">Priority</th><th style="text-align:right">Last visit</th>
      </tr></thead>
      <tbody>${list.slice(0, 300).map(r => {
        const m = META[r.opportunity_type] || { color: 'var(--color-text-secondary)', title: r.opportunity_type };
        return `<tr>
          <td style="font-weight:var(--font-weight-medium)">
            <a data-acc="${r.account_id}" style="color:var(--color-accent);cursor:pointer">${esc(r.name)}</a>
            ${r.external_id ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);font-family:var(--font-mono)">${esc(r.external_id)}</div>` : ''}
          </td>
          <td>${r.hub ? esc(r.hub) : '—'}${r.district_new ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(r.district_new)}</div>` : ''}</td>
          <td>
            <span class="badge" style="font-size:10px;background:${m.color}22;color:${m.color}">${esc(m.title)}</span>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:2px">${esc(r.reason || '')}</div>
          </td>
          <td style="font-size:var(--text-xs)">${esc(r.route_to || '—')}</td>
          <td style="text-align:right">${inr(r.opportunity_value)}</td>
          <td style="text-align:right;font-weight:var(--font-weight-semibold)" title="Value x winnability weight — a priority index, not rupees">${num(r.score)}</td>
          <td style="text-align:right;font-size:var(--text-xs);color:${(r.days_since_visit ?? 999) > 120 ? 'var(--color-warning)' : 'var(--color-text-secondary)'}">
            ${r.days_since_visit == null ? 'never' : r.days_since_visit + 'd ago'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div style="padding:var(--space-3) var(--space-4);display:flex;justify-content:space-between;align-items:center;font-size:var(--text-sm);color:var(--color-text-secondary)">
      <span>Showing ${Math.min(300, list.length).toLocaleString('en-IN')} of ${list.length.toLocaleString('en-IN')}, highest score first.</span>
      ${canManageData() ? `<button class="btn btn-secondary btn-sm" id="oe-export">Export</button>` : ''}
    </div>`;
    el.querySelectorAll('[data-acc]').forEach(a => a.addEventListener('click', () => navigate(`crm/account?id=${a.dataset.acc}`)));
    el.querySelector('#oe-export')?.addEventListener('click', () => downloadCsv(`opportunities_${filterKey || 'all'}.csv`,
      list.map(r => ({
        'Site ID': r.external_id || '', Partner: r.name, Territory: r.hub || '', District: r.district_new || '',
        Type: r.opportunity_type, Why: r.reason || '', 'Route to': r.route_to || '',
        Value: Math.round(+r.opportunity_value || 0), Score: Math.round(+r.score || 0),
        Customers: r.customer_count ?? '', 'Rev LFY': Math.round(+r.rev_lfy || 0), 'Rev CFY': Math.round(+r.rev_cfy || 0),
        'Days since visit': r.days_since_visit ?? '', 'Contacted this cycle': r.telecaller_contacted_this_cycle ? 'yes' : 'no',
      }))));
  }

  renderCards();
  renderList();
  hubSel.addEventListener('change', () => { hub = hubSel.value; renderCards(); renderList(); });
  container.querySelector('#oe-search').addEventListener('input', (e) => { search = e.target.value.toLowerCase().trim(); renderList(); });
  allBtn.addEventListener('click', () => { filterKey = null; hub = ''; search = ''; hubSel.value = ''; container.querySelector('#oe-search').value = ''; renderCards(); renderList(); });
}
