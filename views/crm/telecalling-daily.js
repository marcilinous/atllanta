import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, showError, toast, loadingSkeleton } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { logCallModal, CALL_STATUS_BADGE } from './telecalling-common.js';

// Telecaller's daily worklist: reminders due + TSS renewals to drive, updated
// as calls happen. Mirrors the "Telecalling Report" capture fields.
export default async function crmTelecallingDaily(container) {
  const org = getOrg();
  const user = getUser();
  const m = getMembership();
  const canManage = m && ['owner', 'admin', 'manager'].includes(m.role);
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  const today = new Date().toISOString().slice(0, 10);
  let book = [];
  let callByAcct = {};   // account_id -> latest call {called_at, call_status, outcome, follow_up_date}
  let callsToday = 0;
  let tab = 'due';       // 'due' | 'all'
  let search = '';

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><button class="btn btn-ghost btn-sm" id="back">← Telecalling</button></div>
    <div class="page-header">
      <h1 class="page-title">Daily telecalling</h1>
      <p class="page-subtitle">Today's calls — reminders due and TSS renewals. Update the status and outcome as you go.</p>
    </div>
    <div id="td-kpi" class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3);margin-bottom:var(--space-5)"></div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
        <div class="tabs" style="border-bottom:none;margin:0">
          <button class="tab active" data-tab="due">Due today</button>
          <button class="tab" data-tab="all">All my partners</button>
        </div>
        <input type="text" class="form-input" id="td-search" placeholder="Search partner / district" style="max-width:220px;height:32px;margin-left:auto">
      </div>
      <div id="td-list">${loadingSkeleton(6)}</div>
    </div>
  `;
  container.querySelector('#back').addEventListener('click', () => navigate('crm/telecalling'));

  await load();

  async function load() {
    const [{ data: rows, error }, { data: calls }] = await Promise.all([
      sb.rpc('crm_telecaller_book', { p_telecaller: null }),
      sb.from('crm_calls').select('account_id, called_at, call_status, outcome, follow_up_date')
        .eq('called_by', user.id).order('called_at', { ascending: false }).limit(4000),
    ]);
    if (error) { showError(container.querySelector('#td-list'), 'Could not load the call book: ' + error.message, load); return; }
    book = rows || [];
    callByAcct = {};
    callsToday = 0;
    (calls || []).forEach(c => {
      if (!callByAcct[c.account_id]) callByAcct[c.account_id] = c; // first = latest
      if (String(c.called_at).slice(0, 10) === today) callsToday++;
    });
    book.forEach(p => {
      p._due = (+p.tss_lfy > 0 && +p.tss_cfy === 0);
      const last = callByAcct[p.account_id];
      p._reminder = last?.follow_up_date || null;
      p._lastOutcome = last?.outcome || null;
      p._lastStatus = last?.call_status || null;
      p._lastAt = last?.called_at || p.last_call_at || null;
      // Worklist for today: a reminder due (<= today), or a fresh TSS renewal.
      p._work = (p._reminder && p._reminder <= today) || (p._due && !last);
    });
    renderKpi();
    renderList();
  }

  function renderKpi() {
    const due = book.filter(p => p._work).length;
    const reminders = book.filter(p => p._reminder).length;
    if (!book.length && canManage) {
      container.querySelector('#td-kpi').innerHTML = '';
      return;
    }
    const kpi = (l, v, c) => `<div class="card" style="padding:var(--space-4)"><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${l}</div><div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);${c ? `color:${c}` : ''}">${v}</div></div>`;
    container.querySelector('#td-kpi').innerHTML =
      kpi('Due today', due.toLocaleString('en-IN'), due ? 'var(--color-error)' : 'var(--color-success)') +
      kpi('Called today', callsToday.toLocaleString('en-IN'), 'var(--color-success)') +
      kpi('Reminders set', reminders.toLocaleString('en-IN'), 'var(--color-info)') +
      kpi('My partners', book.length.toLocaleString('en-IN'));
  }

  function currentList() {
    let list = tab === 'due' ? book.filter(p => p._work) : book.slice();
    if (search) list = list.filter(p => (p.name || '').toLowerCase().includes(search) || (p.district_new || '').toLowerCase().includes(search) || String(p.external_id || '').includes(search));
    // Overdue reminders first (oldest), then fresh TSS renewals, then rest.
    list.sort((a, b) => {
      const ar = a._reminder && a._reminder <= today ? 0 : (a._due && !callByAcct[a.account_id] ? 1 : 2);
      const br = b._reminder && b._reminder <= today ? 0 : (b._due && !callByAcct[b.account_id] ? 1 : 2);
      if (ar !== br) return ar - br;
      return (a._reminder || '9999').localeCompare(b._reminder || '9999');
    });
    return list;
  }

  function fmt(d) { return d ? new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short' }) : ''; }

  function renderList() {
    const list = currentList();
    const el = container.querySelector('#td-list');
    if (!list.length) {
      const msg = canManage && !book.length
        ? 'No partners are assigned to your name as telecaller. Managers can review any telecaller in the Telecalling console.'
        : (tab === 'due' ? 'Nothing due today — nice. Switch to "All my partners" to call ahead.' : 'No partners match.');
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">${esc(msg)}</div></div>`;
      return;
    }
    el.innerHTML = `<div class="table-wrap" style="max-height:66vh;overflow:auto"><table class="table">
      <thead><tr><th>Partner</th><th>Phone</th><th style="text-align:right">TSS L/C</th><th>Last outcome</th><th>Reminder</th><th></th></tr></thead>
      <tbody>${list.slice(0, 400).map(p => {
        const overdue = p._reminder && p._reminder <= today;
        return `<tr${overdue ? ' style="background:var(--color-warning-light)"' : (p._due && !callByAcct[p.account_id] ? ' style="background:var(--color-error-light)"' : '')}>
        <td style="font-weight:var(--font-weight-medium)"><a data-acc="${p.account_id}" style="color:var(--color-accent);cursor:pointer">${esc(p.name)}</a>
          ${p.external_id ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);font-family:var(--font-mono)">${esc(p.external_id)}</div>` : ''}
          ${p.district_new ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(p.district_new)}</div>` : ''}</td>
        <td>${p.phone ? `<a href="tel:${esc(p.phone)}" style="color:var(--color-accent);font-size:var(--text-sm)">${esc(p.phone)}</a>` : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>
        <td style="text-align:right">${p.tss_lfy}/${p.tss_cfy}${p._due ? ' <span class="badge badge-error" style="font-size:9px">due</span>' : ''}</td>
        <td style="font-size:var(--text-sm)">${p._lastStatus ? `<span class="badge badge-${CALL_STATUS_BADGE[p._lastStatus] || 'neutral'}" style="font-size:9px">${esc(p._lastStatus)}</span> ` : ''}${p._lastOutcome ? esc(p._lastOutcome) : ''}${p._lastAt ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${fmt(p._lastAt)}</div>` : '<span style="color:var(--color-text-tertiary)">not called</span>'}</td>
        <td style="font-size:var(--text-sm)">${p._reminder ? `<span style="color:${overdue ? 'var(--color-warning)' : 'var(--color-text-secondary)'}">${fmt(p._reminder)}</span>` : '—'}</td>
        <td style="text-align:right"><button class="btn btn-primary btn-sm" data-call="${p.account_id}">Log call</button></td>
      </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div style="padding:var(--space-3) var(--space-4);font-size:var(--text-sm);color:var(--color-text-secondary)">${Math.min(400, list.length).toLocaleString('en-IN')} of ${list.length.toLocaleString('en-IN')} shown.</div>`;

    el.querySelectorAll('[data-acc]').forEach(a => a.addEventListener('click', () => navigate(`crm/account?id=${a.dataset.acc}`)));
    el.querySelectorAll('[data-call]').forEach(b => b.addEventListener('click', () => {
      const p = book.find(x => x.account_id === b.dataset.call);
      if (!p) return;
      logCallModal({ sb, org, user, partner: p, prefill: { follow_up_date: p._reminder || '' }, onSaved: (call) => {
        // reflect the new latest call locally
        callByAcct[p.account_id] = { account_id: p.account_id, called_at: call.called_at, call_status: call.call_status, outcome: call.outcome, follow_up_date: call.follow_up_date };
        p._reminder = call.follow_up_date || null;
        p._lastOutcome = call.outcome || null;
        p._lastStatus = call.call_status || null;
        p._lastAt = call.called_at;
        p._work = (p._reminder && p._reminder <= today);
        p.calls_total = (+p.calls_total || 0) + 1;
        callsToday++;
        renderKpi();
        renderList();
      } });
    }));
  }

  container.querySelector('#td-search').addEventListener('input', (e) => { search = e.target.value.toLowerCase().trim(); renderList(); });
  container.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => {
    tab = t.dataset.tab;
    container.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === t));
    renderList();
  }));
}
