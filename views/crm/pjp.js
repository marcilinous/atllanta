import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

// CRM › PJP (Permanent Journey Plan). A BDE's beat plan: assign a territory to
// each working day; the day's beat is the partners in that territory. Managers
// plan for their BDEs and lock the month; adherence scores planned vs visited.
// Fits the existing crm_pjp_* backend (day plans, month locks, RPCs).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const inr = (n) => { n = Number(n) || 0; if (n >= 1e7) return '₹' + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + 'Cr'; if (n >= 1e5) return '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + 'L'; if (n >= 1e3) return '₹' + Math.round(n / 1e3) + 'K'; return '₹' + Math.round(n).toLocaleString('en-IN'); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const REASON = { stopped_buying: 'Stopped buying', tss_overdue: 'TSS overdue', not_visited: 'Not visited', not_called: 'Not called', base_no_buy: 'Base · no buy' };
const rlabel = (k) => REASON[k] || String(k).replace(/_/g, ' ');

export default async function crmPjp(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const canManage = ['owner', 'admin', 'manager'].includes(membership?.role || 'member');

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:var(--space-3)">
      <div><h1 class="page-title" style="margin:0">Journey Plan</h1>
        <p class="page-subtitle" style="margin:0">Plan each BDE's beat by territory, day by day</p></div>
      <a href="#/crm" class="btn btn-secondary">← CRM</a>
    </div>
    <div id="pjp-body"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
  `;
  if (!org) { document.getElementById('pjp-body').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  // BDEs (from coverage owners) + territory options.
  const [covRes, terrRes, usersRes] = await Promise.all([
    sb.rpc('crm_coverage'),
    sb.rpc('crm_territory_potential'),
    sb.from('users').select('id, full_name, email'),
  ]);
  const nameOf = {}; (usersRes.data || []).forEach(u => { nameOf[u.id] = u.full_name || u.email; });
  const bdes = (covRes.data || []).filter(c => c.owner_id).map(c => ({ id: c.owner_id, name: nameOf[c.owner_id] || 'BDE' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!bdes.find(b => b.id === user.id)) bdes.unshift({ id: user.id, name: nameOf[user.id] || 'Me' });
  const territories = (terrRes.data || []).map(t => t.territory).filter(t => t && t !== '(no hub)').sort();

  // State
  let selectedBde = canManage ? (bdes[0]?.id || user.id) : user.id;
  const now = new Date();
  let viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  let selectedDate = null;
  let plans = {};     // dateStr -> plan row
  let locked = false;
  let adherence = null;

  async function loadMonth() {
    const mStart = ymd(viewMonth);
    const mEnd = ymd(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0));
    const [{ data: planRows }, { data: lockRows }, adhRes] = await Promise.all([
      sb.from('crm_pjp_day_plans').select('*').eq('bde_id', selectedBde).gte('plan_date', mStart).lte('plan_date', mEnd),
      sb.from('crm_pjp_month_locks').select('*').eq('bde_id', selectedBde).eq('month_start', mStart),
      sb.rpc('crm_pjp_adherence', { p_from: mStart, p_to: mEnd }),
    ]);
    plans = {}; (planRows || []).forEach(p => { plans[p.plan_date] = p; });
    locked = !!(lockRows && lockRows.length);
    adherence = (adhRes.data || []).filter(r => r.person_id === selectedBde);
    render();
  }

  function render() {
    const body = document.getElementById('pjp-body');
    const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const daysIn = new Date(y, m + 1, 0).getDate();
    const editable = canManage || selectedBde === user.id;

    // adherence rollup for the month
    const adh = (adherence || []).reduce((a, r) => ({
      planned: a.planned + (Number(r.planned_days) || 0),
      visits: a.visits + (Number(r.visits_total) || 0),
      onPlan: a.onPlan + (Number(r.visits_on_plan) || 0),
    }), { planned: 0, visits: 0, onPlan: 0 });
    const plannedDays = Object.keys(plans).length;
    const adhRate = adh.visits ? Math.round((adh.onPlan / adh.visits) * 100) : null;

    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push('<div></div>');
    for (let d = 1; d <= daysIn; d++) {
      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const p = plans[ds];
      const isSel = ds === selectedDate;
      const isSun = new Date(y, m, d).getDay() === 0;
      cells.push(`<button class="pjp-cell" data-date="${ds}" ${!editable ? 'disabled' : ''} style="text-align:left;border:1px solid ${isSel ? 'var(--color-accent)' : 'var(--color-border)'};border-radius:var(--radius-md);background:${p ? 'var(--color-accent-light)' : 'var(--color-surface)'};padding:var(--space-2);min-height:64px;cursor:${editable ? 'pointer' : 'default'};display:flex;flex-direction:column;gap:var(--space-1)">
        <span class="u-meta" style="color:${isSun ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)'}">${d}</span>
        ${p ? `<span style="font-size:var(--text-xs);font-weight:var(--font-weight-semibold);color:var(--color-accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.territory)}</span>` : (editable ? '<span class="u-meta" style="opacity:.5">+</span>' : '')}
      </button>`);
    }

    body.innerHTML = `
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
          ${canManage ? `<select class="form-input" id="pjp-bde" style="max-width:220px;height:34px">${bdes.map(b => `<option value="${b.id}" ${b.id === selectedBde ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : `<span style="font-weight:var(--font-weight-semibold)">${esc(nameOf[user.id] || 'My plan')}</span>`}
          <div style="display:flex;align-items:center;gap:var(--space-2)">
            <button class="btn btn-secondary btn-sm" id="pjp-prev">‹</button>
            <span style="font-weight:var(--font-weight-semibold);min-width:110px;text-align:center">${MONTHS[m]} ${y}</span>
            <button class="btn btn-secondary btn-sm" id="pjp-next">›</button>
          </div>
          ${locked ? '<span class="badge badge-neutral">🔒 Locked</span>' : (canManage ? '<button class="btn btn-secondary btn-sm" id="pjp-lock">Lock month</button>' : '')}
          <span class="u-meta" style="margin-left:auto">${plannedDays} day${plannedDays === 1 ? '' : 's'} planned${adhRate != null ? ` · ${adhRate}% on-plan` : ''}</span>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:var(--space-1);margin-bottom:var(--space-2)">
            ${DOW.map(d => `<div class="u-meta" style="text-align:center">${d}</div>`).join('')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:var(--space-1)">${cells.join('')}</div>
          ${locked ? '<div class="u-sm-muted" style="margin-top:var(--space-2)">This month is locked. Unlock to change the plan.</div>' : (editable ? '<div class="u-sm-muted" style="margin-top:var(--space-2)">Tap a day to assign or change its territory.</div>' : '<div class="u-sm-muted" style="margin-top:var(--space-2)">View only.</div>')}
        </div>
      </div>
      <div id="pjp-day"></div>
    `;

    if (canManage) document.getElementById('pjp-bde').addEventListener('change', (e) => { selectedBde = e.target.value; selectedDate = null; loadMonth(); });
    document.getElementById('pjp-prev').addEventListener('click', () => { viewMonth = new Date(y, m - 1, 1); selectedDate = null; loadMonth(); });
    document.getElementById('pjp-next').addEventListener('click', () => { viewMonth = new Date(y, m + 1, 1); selectedDate = null; loadMonth(); });
    const lockBtn = document.getElementById('pjp-lock');
    if (lockBtn) lockBtn.addEventListener('click', lockMonth);

    body.querySelectorAll('.pjp-cell').forEach(cell => {
      if (cell.disabled) return;
      cell.addEventListener('click', () => { selectedDate = cell.dataset.date; renderDay(); highlightSel(); });
    });

    if (selectedDate) renderDay();
  }

  function highlightSel() {
    document.querySelectorAll('.pjp-cell').forEach(c => { c.style.borderColor = c.dataset.date === selectedDate ? 'var(--color-accent)' : 'var(--color-border)'; });
  }

  async function assignTerritory(dateStr, territory) {
    const existing = plans[dateStr];
    let res;
    if (!territory) { // clear
      if (!existing) return;
      res = await sb.from('crm_pjp_day_plans').delete().eq('id', existing.id);
      if (res.error) return toast('Failed: ' + res.error.message);
      delete plans[dateStr];
      logAction('crm', 'pjp_plan', existing.id, 'cleared', existing, null);
    } else if (existing) {
      res = await sb.from('crm_pjp_day_plans').update({ territory }).eq('id', existing.id).select().single();
      if (res.error) return toast('Failed: ' + res.error.message);
      plans[dateStr] = res.data;
    } else {
      res = await sb.from('crm_pjp_day_plans').insert({ org_id: org.id, bde_id: selectedBde, plan_date: dateStr, territory, created_by: user.id }).select().single();
      if (res.error) return toast('Failed: ' + res.error.message);
      plans[dateStr] = res.data;
      logAction('crm', 'pjp_plan', res.data.id, 'created', null, res.data);
      publishEvent('crm.pjp.planned', { bde_id: selectedBde, plan_date: dateStr, territory });
    }
    toast(territory ? 'Territory assigned' : 'Cleared');
    render();
  }

  async function lockMonth() {
    const mStart = ymd(viewMonth);
    const { error } = await sb.from('crm_pjp_month_locks').insert({ org_id: org.id, bde_id: selectedBde, month_start: mStart, locked_by: user.id });
    if (error) return toast('Lock failed: ' + error.message);
    locked = true; toast('Month locked'); render();
  }

  async function renderDay() {
    const el = document.getElementById('pjp-day');
    if (!el || !selectedDate) return;
    const p = plans[selectedDate];
    const dObj = new Date(selectedDate + 'T00:00:00');
    const editable = (canManage || selectedBde === user.id) && !locked;
    const label = `${DOW[dObj.getDay()]}, ${dObj.getDate()} ${MONTHS[dObj.getMonth()]}`;

    el.innerHTML = `<div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        <span style="font-weight:var(--font-weight-semibold)">${label}</span>
        ${editable ? `<select class="form-input" id="pjp-terr" style="max-width:200px;height:34px">
          <option value="">— No territory —</option>
          ${territories.map(t => `<option value="${esc(t)}" ${p && p.territory === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>` : `<span class="badge badge-info">${p ? esc(p.territory) : 'No plan'}</span>`}
        ${p ? '<span class="u-meta" id="pjp-beat-count"></span>' : ''}
      </div>
      <div id="pjp-beat" class="card-body">${p ? '<div class="u-sm-muted">Loading beat…</div>' : '<div class="u-sm-muted">No territory planned for this day.</div>'}</div>
    </div>`;

    if (editable) document.getElementById('pjp-terr').addEventListener('change', (e) => assignTerritory(selectedDate, e.target.value));
    if (p) loadBeat(p.territory);
  }

  async function loadBeat(territory) {
    const beatEl = document.getElementById('pjp-beat');
    const { data, error } = await sb.rpc('crm_pjp_day_accounts', { p_territory: territory });
    if (!beatEl) return;
    if (error) { beatEl.innerHTML = `<div class="u-sm-muted">Couldn't load beat: ${esc(error.message)}</div>`; return; }
    const rows = data || [];
    const cnt = document.getElementById('pjp-beat-count');
    if (cnt) cnt.textContent = `${rows.length} partner${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) { beatEl.innerHTML = `<div class="u-sm-muted">No partners to cover in ${esc(territory)}.</div>`; return; }
    beatEl.innerHTML = `<div class="table-wrap" style="max-height:56vh;overflow-y:auto"><table class="table">
      <thead><tr><th>Partner</th><th>District</th><th>Why</th><th style="text-align:right">Last visit</th><th style="text-align:right">12m value</th></tr></thead>
      <tbody>${rows.map(a => `<tr class="pjp-beat-row" data-id="${a.account_id}" style="cursor:pointer">
        <td style="font-weight:var(--font-weight-medium)">${esc(a.name || '—')}</td>
        <td class="u-sm-muted">${esc(a.district_new || '—')}</td>
        <td><div class="u-row-wrap">${(a.reasons || []).map(r => `<span class="badge badge-warning">${esc(rlabel(r))}</span>`).join('') || '—'}</div></td>
        <td style="text-align:right">${a.days_since_visit == null ? 'never' : esc(String(a.days_since_visit)) + 'd'}</td>
        <td style="text-align:right;font-weight:var(--font-weight-semibold)">${inr(a.value_12m)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
    beatEl.querySelectorAll('.pjp-beat-row').forEach(r => r.addEventListener('click', () => { window.location.hash = `#/crm/account?id=${r.dataset.id}`; }));
  }

  await loadMonth();
}
