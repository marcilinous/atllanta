// Who to visit — a BDE's worklist.
//
// Every column is something on file: a date, a count, or rupees RT actually
// billed. Nothing is scored, weighted or estimated. In particular there is no
// expiry date anywhere in the source reports, so nothing here claims one — a
// partner is "no TSS 12m+" because 365 days have passed since a real
// activation date, not because anything says a subscription ran out.
import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, showError, loadingSkeleton, toast, downloadCsv } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { fetchAllRpc, canManageData } from './common.js';

export const inr = (n) => {
  n = Math.round(+n || 0);
  if (!n) return '—';
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
  return '₹' + n.toLocaleString('en-IN');
};

const d = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: '2-digit' }) : null;

// Reason keys come from crm_partner_actions(). Labels stay literal.
export const REASONS = [
  { key: 'tss_overdue',    label: 'No TSS 12m+',    color: 'var(--color-error)' },
  { key: 'stopped_buying', label: 'Stopped buying', color: 'var(--color-warning)' },
  { key: 'base_no_buy',    label: 'Base, no buy',   color: 'var(--color-accent)' },
  { key: 'not_visited',    label: 'Not visited',    color: 'var(--color-info)' },
];
export const REASON_BY_KEY = Object.fromEntries(REASONS.map(r => [r.key, r]));

export default async function crmToVisit(container) {
  const org = getOrg();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }
  const isAdmin = ['owner', 'admin'].includes(getMembership()?.role);

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Who to visit</h1>
      <p class="page-subtitle" id="tv-sub">Your partners that need attention, biggest business first.</p>
    </div>
    <div id="tv-chips" style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-4)"></div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <span class="card-title" id="tv-count">Loading…</span>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          <select class="form-input" id="tv-hub" style="max-width:170px;height:32px"></select>
          <input type="text" class="form-input" id="tv-search" placeholder="Search partner / town" style="max-width:190px;height:32px">
        </div>
      </div>
      <div id="tv-list">${loadingSkeleton(8)}</div>
    </div>
    <div id="tv-foot" style="margin-top:var(--space-3);font-size:var(--text-xs);color:var(--color-text-tertiary)"></div>
  `;

  const [{ data: rows, error }, win, computedAt] = await Promise.all([
    fetchAllRpc('crm_partner_actions'),
    sb.rpc('crm_report_windows').then(r => (r.data || [])[0]).catch(() => null),
    sb.rpc('crm_opportunity_computed_at').then(r => r.data).catch(() => null),
  ]);
  if (error) {
    showError(container.querySelector('#tv-list'), 'Could not load the list: ' + error.message, () => crmToVisit(container));
    return;
  }
  const data = rows || [];

  // Say plainly how far back the reports go, so "no visit this year" is never
  // mistaken for "never visited".
  const foot = [];
  if (win?.activations_from) foot.push(`Sales from ${d(win.activations_from)}`);
  if (win?.visits_from) foot.push(`visits from ${d(win.visits_from)}`);
  if (win?.calls_from) foot.push(`calls from ${d(win.calls_from)}`);
  if (computedAt) foot.push(`updated ${new Date(computedAt).toLocaleString('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`);
  container.querySelector('#tv-foot').innerHTML = esc(foot.join(' · ')) +
    (isAdmin ? ` · <a id="tv-refresh" style="color:var(--color-accent);cursor:pointer">Refresh now</a>` : '');
  container.querySelector('#tv-refresh')?.addEventListener('click', async (e) => {
    e.target.textContent = 'Refreshing…';
    const { error: rErr } = await sb.rpc('crm_refresh_opportunity_features');
    if (rErr) { toast('Could not refresh: ' + rErr.message); return; }
    toast('List refreshed');
    crmToVisit(container);
  });

  if (!data.length) {
    container.querySelector('#tv-chips').innerHTML = '';
    container.querySelector('#tv-list').innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
      <div class="empty-state-title">Nothing needs attention</div>
      <div class="empty-state-desc">No partner in your patch matched, or the reports have not been imported yet.</div></div>`;
    return;
  }

  const hubs = [...new Set(data.map(r => r.hub).filter(Boolean))].sort();
  const hubSel = container.querySelector('#tv-hub');
  hubSel.innerHTML = `<option value="">All areas</option>` + hubs.map(h => `<option value="${esc(h)}">${esc(h)}</option>`).join('');

  let filter = null, search = '', hub = '';

  function scoped() { return hub ? data.filter(r => r.hub === hub) : data; }

  function renderChips() {
    const s = scoped();
    const chip = (key, label, n, color, active) => `
      <button class="tv-chip" data-key="${key}" style="border:1px solid ${active ? color : 'var(--color-border)'};
        background:${active ? color + '18' : 'var(--color-surface)'};color:${active ? color : 'var(--color-text-primary)'};
        border-radius:var(--radius-full);padding:6px 14px;cursor:pointer;font-size:var(--text-sm);
        font-weight:var(--font-weight-medium)">${esc(label)} <span style="opacity:.7">${n.toLocaleString('en-IN')}</span></button>`;
    container.querySelector('#tv-chips').innerHTML =
      chip('', 'All', s.length, 'var(--color-text-primary)', !filter) +
      REASONS.map(r => chip(r.key, r.label, s.filter(x => (x.reasons || []).includes(r.key)).length, r.color, filter === r.key)).join('');
    container.querySelectorAll('.tv-chip').forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.key || null; renderChips(); renderList();
    }));
  }

  function current() {
    let list = scoped();
    if (filter) list = list.filter(r => (r.reasons || []).includes(filter));
    if (search) list = list.filter(r =>
      (r.name || '').toLowerCase().includes(search) ||
      (r.district_new || '').toLowerCase().includes(search) ||
      (r.external_id || '').toLowerCase().includes(search));
    return list;
  }

  function renderList() {
    const list = current();
    container.querySelector('#tv-count').textContent = `${list.length.toLocaleString('en-IN')} partners`;
    const el = container.querySelector('#tv-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">Nothing matches</div></div>`;
      return;
    }
    el.innerHTML = `<div class="table-wrap" style="max-height:66vh;overflow:auto"><table class="table">
      <thead><tr>
        <th>Partner</th><th>Why</th><th>Last bought</th><th>Last visit</th>
        <th style="text-align:right">Business</th>
      </tr></thead>
      <tbody>${list.slice(0, 300).map(r => {
        const stale = r.days_since_visit == null || r.days_since_visit > 120;
        // A partner who stopped buying has no 12-month figure, but last year's
        // is real and is exactly why they are on the list. Show the larger of
        // the two and label which period it came from.
        const v12 = +r.value_12m || 0, vlfy = +r.value_last_fy || 0;
        const biz = Math.max(v12, vlfy);
        const bizPeriod = biz === 0 ? '' : (v12 >= vlfy ? 'last 12 months' : 'last year');
        return `<tr>
          <td style="font-weight:var(--font-weight-medium)">
            <a data-acc="${r.account_id}" style="color:var(--color-accent);cursor:pointer">${esc(r.name)}</a>
            <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">
              ${r.district_new ? esc(r.district_new) : ''}${r.hub && r.hub !== r.district_new ? ' · ' + esc(r.hub) : ''}</div>
          </td>
          <td>${(r.reasons || []).map(k => {
            const m = REASON_BY_KEY[k]; if (!m) return '';
            return `<span class="badge" style="font-size:10px;background:${m.color}22;color:${m.color};margin-right:4px">${esc(m.label)}</span>`;
          }).join('')}
            ${r.customer_count ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:2px">${r.customer_count} customers</div>` : ''}
          </td>
          <td style="font-size:var(--text-sm)">
            ${r.last_activation_date
              ? `${esc(r.last_activation_type || '')}<div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(d(r.last_activation_date))}</div>`
              : '<span style="color:var(--color-text-tertiary)">none on record</span>'}
          </td>
          <td style="font-size:var(--text-sm);color:${stale ? 'var(--color-warning)' : 'var(--color-text-secondary)'}">
            ${r.last_visit_date ? esc(d(r.last_visit_date)) : 'none this year'}
          </td>
          <td style="text-align:right;font-weight:var(--font-weight-semibold)">${inr(biz)}
            ${bizPeriod ? `<div style="font-size:var(--text-xs);font-weight:var(--font-weight-normal);color:var(--color-text-tertiary)">${bizPeriod}</div>` : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div style="padding:var(--space-3) var(--space-4);display:flex;justify-content:space-between;align-items:center;font-size:var(--text-sm);color:var(--color-text-secondary)">
      <span>${list.length > 300 ? `Showing first 300 of ${list.length.toLocaleString('en-IN')}.` : 'Biggest business first.'}</span>
      ${canManageData() ? `<button class="btn btn-secondary btn-sm" id="tv-export">Export</button>` : ''}
    </div>`;
    el.querySelectorAll('[data-acc]').forEach(a => a.addEventListener('click', () => navigate(`crm/account?id=${a.dataset.acc}`)));
    el.querySelector('#tv-export')?.addEventListener('click', () => downloadCsv(`to_visit_${filter || 'all'}.csv`,
      list.map(r => ({
        'Site ID': r.external_id || '', Partner: r.name, Area: r.hub || '', District: r.district_new || '',
        Why: (r.reasons || []).join(' '), Customers: r.customer_count ?? '',
        'Last bought': r.last_activation_date || '', 'Type': r.last_activation_type || '',
        'Last TSS': r.last_tss_date || '', 'Last visit': r.last_visit_date || '', 'Last call': r.last_call_date || '',
        'Business 12mo': Math.round(+r.value_12m || 0),
        'Business shown': Math.round(Math.max(+r.value_12m || 0, +r.value_last_fy || 0)),
        'Billed last FY': Math.round(+r.value_last_fy || 0), 'Billed this FY': Math.round(+r.value_this_fy || 0),
      }))));
  }

  renderChips();
  renderList();
  hubSel.addEventListener('change', () => { hub = hubSel.value; renderChips(); renderList(); });
  container.querySelector('#tv-search').addEventListener('input', (e) => { search = e.target.value.toLowerCase().trim(); renderList(); });
}
