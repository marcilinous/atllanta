import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast, initials, avColor } from '../../js/ui.js';
import { openAccountForm } from './account-form.js';

// CRM › Accounts. Full CRUD over crm_accounts through the anon+RLS client
// (RLS scopes every row to the caller's org). Establishes the record-list
// pattern the other CRM objects reuse.
export default async function crmAccounts(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const canEdit = ['owner', 'admin', 'manager'].includes(membership?.role || 'member');

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Accounts</h1>
        <p class="page-subtitle">Companies and partners you sell to</p>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        <a href="#/crm" class="btn btn-secondary">← CRM</a>
        ${canEdit ? '<button class="btn btn-primary" id="add-account-btn">+ New Account</button>' : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        <input type="text" class="form-input" id="acc-search" placeholder="Search name, website, phone..." style="max-width:300px;height:34px;flex:1">
        <select class="form-input" id="acc-tier-filter" style="max-width:160px;height:34px"><option value="">All tiers</option></select>
        <select class="form-input" id="acc-region-filter" style="max-width:180px;height:34px"><option value="">All regions</option></select>
      </div>
      <div id="acc-table-wrap">
        <div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>
      </div>
    </div>
  `;

  if (!org) {
    document.getElementById('acc-table-wrap').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`;
    return;
  }

  let accounts = [];
  const ownerMap = {};

  const [{ data: accs, error: accErr }, { data: users }] = await Promise.all([
    sb.from('crm_accounts').select('*').order('name'),
    sb.from('users').select('id, full_name, email'),
  ]);
  if (accErr) toast('Failed to load accounts: ' + accErr.message);
  accounts = accs || [];
  (users || []).forEach(u => { ownerMap[u.id] = u; });

  // Derive filter options from the data (taxonomy isn't a fixed enum).
  const tierSel = document.getElementById('acc-tier-filter');
  const regionSel = document.getElementById('acc-region-filter');
  function refillFilters() {
    const tiers = [...new Set(accounts.map(a => a.tier).filter(Boolean))].sort();
    const regions = [...new Set(accounts.map(a => a.region).filter(Boolean))].sort();
    const tierVal = tierSel.value, regionVal = regionSel.value;
    tierSel.innerHTML = '<option value="">All tiers</option>' + tiers.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    regionSel.innerHTML = '<option value="">All regions</option>' + regions.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    tierSel.value = tierVal; regionSel.value = regionVal;
  }
  refillFilters();

  function renderTable() {
    const wrap = document.getElementById('acc-table-wrap');
    const q = (document.getElementById('acc-search')?.value || '').toLowerCase();
    const tier = tierSel.value || '';
    const region = regionSel.value || '';

    let rows = accounts;
    if (q) rows = rows.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.website || '').toLowerCase().includes(q) ||
      (a.phone || '').toLowerCase().includes(q));
    if (tier) rows = rows.filter(a => a.tier === tier);
    if (region) rows = rows.filter(a => a.region === region);

    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3"/></svg></div>
        <div class="empty-state-title">${q || tier || region ? 'No matching accounts' : 'No accounts yet'}</div>
        <div class="empty-state-desc">${q || tier || region ? 'Try adjusting your filters.' : canEdit ? 'Create your first account to get started.' : 'Accounts will appear here once added.'}</div>
      </div>`;
      return;
    }

    wrap.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Account</th><th>Tier</th><th>Region</th><th>Owner</th><th style="text-align:right">Customers</th></tr></thead>
      <tbody>${rows.map(a => {
        const owner = ownerMap[a.owner_id];
        return `<tr style="cursor:pointer" data-id="${a.id}">
          <td>
            <div class="u-row-3">
              <div style="width:32px;height:32px;border-radius:var(--radius-md);background:${avColor(a.name || 'A')};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(a.name || '—')}</div>
              <div>
                <div style="font-weight:var(--font-weight-medium)">${esc(a.name || '—')}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(a.website || a.industry || '')}</div>
              </div>
            </div>
          </td>
          <td>${a.tier ? `<span class="badge badge-info">${esc(a.tier)}</span>` : '—'}</td>
          <td>${esc([a.region, a.billing_city].filter(Boolean).join(' · ') || '—')}</td>
          <td>${owner ? esc(owner.full_name || owner.email || '—') : '—'}</td>
          <td style="text-align:right">${a.customer_count ?? '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    wrap.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', () => { window.location.hash = `#/crm/account?id=${row.dataset.id}`; });
    });
  }

  renderTable();
  document.getElementById('acc-search').addEventListener('input', renderTable);
  tierSel.addEventListener('change', renderTable);
  regionSel.addEventListener('change', renderTable);

  if (canEdit) {
    document.getElementById('add-account-btn').addEventListener('click', () => {
      openAccountForm({
        org, user,
        onSaved: (saved) => {
          accounts.push(saved);
          accounts.sort((x, y) => (x.name || '').localeCompare(y.name || ''));
          refillFilters();
          renderTable();
        },
      });
    });
  }
}
