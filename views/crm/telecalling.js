import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, showError, toast, loadingSkeleton } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { logCallModal } from './telecalling-common.js';

export default async function crmTelecalling(container) {
  const org = getOrg();
  const user = getUser();
  const m = getMembership();
  const canManage = m && ['owner', 'admin', 'manager'].includes(m.role);
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  let book = [];
  let selectedTelecaller = '';      // manager view: which telecaller's book
  let search = '';
  let dueOnly = false;

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><button class="btn btn-ghost btn-sm" id="back">← CRM</button></div>
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Telecalling</h1>
        <p class="page-subtitle">Your partner call book, prioritised by TSS renewals due. Log every call and set follow-ups.</p>
      </div>
      <a href="#/crm/telecalling/daily" class="btn btn-primary">Daily update</a>
    </div>
    <div id="tc-picker" style="margin-bottom:var(--space-4)"></div>
    <div id="tc-kpi" class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3);margin-bottom:var(--space-5)"></div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
        <span class="card-title" style="margin-right:auto">Call list</span>
        <label style="display:flex;gap:6px;align-items:center;font-size:var(--text-sm);color:var(--color-text-secondary)"><input type="checkbox" id="tc-due"> TSS due only</label>
        <input type="text" class="form-input" id="tc-search" placeholder="Search partner / district" style="max-width:220px;height:32px">
      </div>
      <div id="tc-list">${loadingSkeleton(6)}</div>
    </div>
  `;
  container.querySelector('#back').addEventListener('click', () => navigate('crm'));

  // Manager/admin: pick a telecaller. Rep: their own book loads directly.
  if (canManage) {
    const { data: names } = await sb.rpc('crm_telecaller_names');
    const list = names || [];
    const pick = container.querySelector('#tc-picker');
    pick.innerHTML = `<div class="card"><div class="card-body" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
      <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">Viewing telecaller:</span>
      <select class="form-input" id="tc-who" style="max-width:280px;height:34px">
        <option value="">— Select a telecaller —</option>
        ${list.map(n => `<option value="${esc(n.telecaller)}">${esc(n.telecaller)} (${n.partners})</option>`).join('')}
      </select></div></div>`;
    pick.querySelector('#tc-who').addEventListener('change', (e) => { selectedTelecaller = e.target.value; load(); });
    container.querySelector('#tc-list').innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">Pick a telecaller to see their call book.</div></div>`;
  } else {
    await load();
  }

  async function load() {
    if (canManage && !selectedTelecaller) { renderKpi([]); container.querySelector('#tc-list').innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">Pick a telecaller to see their call book.</div></div>`; return; }
    container.querySelector('#tc-list').innerHTML = loadingSkeleton(6);
    const { data, error } = await sb.rpc('crm_telecaller_book', { p_telecaller: canManage ? selectedTelecaller : null });
    if (error) { showError(container.querySelector('#tc-list'), 'Could not load the call book: ' + error.message, load); return; }
    book = data || [];
    // Priority: TSS renewal due first, then never-called, then oldest last-call.
    book.forEach(p => { p._due = (+p.tss_lfy > 0 && +p.tss_cfy === 0); });
    book.sort((a, b) => (b._due - a._due) || ((a.calls_total ? 1 : 0) - (b.calls_total ? 1 : 0)) || (new Date(a.last_call_at || 0) - new Date(b.last_call_at || 0)));
    renderKpi(book);
    renderList();
  }

  function renderKpi(list) {
    const due = list.filter(p => p._due).length;
    const called = list.filter(p => p.called_by_me).length;
    const kpi = (l, v, c) => `<div class="card" style="padding:var(--space-4)"><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${l}</div><div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);${c ? `color:${c}` : ''}">${v}</div></div>`;
    container.querySelector('#tc-kpi').innerHTML =
      kpi('Partners', list.length.toLocaleString('en-IN')) +
      kpi('TSS renewals due', due.toLocaleString('en-IN'), due ? 'var(--color-error)' : 'var(--color-success)') +
      kpi('Called', `${called.toLocaleString('en-IN')} / ${list.length.toLocaleString('en-IN')}`, 'var(--color-info)');
  }

  function currentList() {
    let list = dueOnly ? book.filter(p => p._due) : book;
    if (search) list = list.filter(p => (p.name || '').toLowerCase().includes(search) || (p.district_new || '').toLowerCase().includes(search) || String(p.external_id || '').includes(search));
    return list;
  }

  function lastCall(p) {
    if (!p.last_call_at) return '<span style="color:var(--color-text-tertiary)">never</span>';
    return new Date(p.last_call_at).toLocaleDateString('en', { day: 'numeric', month: 'short' });
  }

  function renderList() {
    const list = currentList();
    const el = container.querySelector('#tc-list');
    if (!list.length) { el.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">Nothing here</div></div>`; return; }
    el.innerHTML = `<div class="table-wrap" style="max-height:64vh;overflow:auto"><table class="table">
      <thead><tr><th>Partner</th><th>District</th><th style="text-align:right">TSS L/C</th><th style="text-align:right">Calls</th><th>Last call</th><th></th></tr></thead>
      <tbody>${list.slice(0, 400).map(p => `<tr${p._due ? ' style="background:var(--color-error-light)"' : ''}>
        <td style="font-weight:var(--font-weight-medium)"><a data-acc="${p.account_id}" style="color:var(--color-accent);cursor:pointer">${esc(p.name)}</a>
          ${p.external_id ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);font-family:var(--font-mono)">${esc(p.external_id)}</div>` : ''}</td>
        <td>${p.district_new ? esc(p.district_new) : '—'}${p.region ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(p.region)}</div>` : ''}</td>
        <td style="text-align:right">${p.tss_lfy}/${p.tss_cfy}${p._due ? ' <span class="badge badge-error" style="font-size:9px">due</span>' : ''}</td>
        <td style="text-align:right">${(+p.calls_total) ? p.calls_total : '<span style="color:var(--color-text-tertiary)">0</span>'}</td>
        <td style="font-size:var(--text-sm)">${lastCall(p)}</td>
        <td style="text-align:right"><button class="btn btn-secondary btn-sm" data-call="${p.account_id}">Log call</button></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div style="padding:var(--space-3) var(--space-4);font-size:var(--text-sm);color:var(--color-text-secondary)">Showing ${Math.min(400, list.length).toLocaleString('en-IN')} of ${list.length.toLocaleString('en-IN')} — TSS renewals due first.</div>`;

    el.querySelectorAll('[data-acc]').forEach(a => a.addEventListener('click', () => navigate(`crm/account?id=${a.dataset.acc}`)));
    el.querySelectorAll('[data-call]').forEach(b => b.addEventListener('click', () => openCall(book.find(p => p.account_id === b.dataset.call))));
  }

  function openCall(p) {
    if (!p) return;
    // Reps log calls as themselves; a manager viewing another telecaller can't
    // log on their behalf (insert requires called_by = self).
    if (canManage) return toast('Managers view books; calls are logged by the telecaller.');
    logCallModal({ sb, org, user, partner: p, onSaved: () => {
      p.calls_total = (+p.calls_total || 0) + 1;
      p.called_by_me = true;
      p.last_call_at = new Date().toISOString();
      renderKpi(book);
      renderList();
    } });
  }

  container.querySelector('#tc-due').addEventListener('change', (e) => { dueOnly = e.target.checked; renderList(); });
  container.querySelector('#tc-search').addEventListener('input', (e) => { search = e.target.value.toLowerCase().trim(); renderList(); });
}
