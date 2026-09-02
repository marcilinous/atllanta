// PJP — day-level monthly journey planning.
//
// A BDE picks a territory for each specific calendar date ahead of the month
// (not a repeating weekly pattern). Planned days are shaded by how much open
// opportunity sits in that hub, so the plan is built against where the
// business actually is rather than by habit. Clicking a day opens that hub's
// partners ranked by score, inline.
import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, showError, loadingSkeleton, toast, openModal, closeModal, downloadCsv } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { canSeeOthers, canManageData } from './common.js';
import { inr, REASON_BY_KEY } from './to-visit.js';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MONTH_FMT = { month: 'long', year: 'numeric' };

export default async function crmPjp(container) {
  const org = getOrg();
  const me = getUser();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  let cursor = new Date(); cursor.setDate(1); cursor.setHours(0, 0, 0, 0);
  let personId = me?.id || null;

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Journey plan</h1>
      <p class="page-subtitle">Plan each day's area ahead of the month, then lock it. A locked day opens who to visit first — biggest untapped business at the top.</p>
    </div>
    <div class="card" style="margin-bottom:var(--space-5)">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <button class="btn btn-ghost btn-sm" id="pjp-prev">←</button>
          <span class="card-title" id="pjp-month" style="min-width:160px;text-align:center"></span>
          <button class="btn btn-ghost btn-sm" id="pjp-next">→</button>
        </div>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <span id="pjp-lock" style="display:flex;align-items:center;gap:var(--space-2)"></span>
          <select class="form-input" id="pjp-person" style="max-width:220px;height:32px;display:none"></select>
        </div>
      </div>
      <div id="pjp-cal" style="padding:var(--space-4)">${loadingSkeleton(5)}</div>
      <div id="pjp-legend" style="padding:0 var(--space-4) var(--space-4);font-size:var(--text-xs);color:var(--color-text-secondary)"></div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <span class="card-title">Plan adherence</span>
        <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Visits that landed in the area planned for that day</span>
      </div>
      <div id="pjp-adherence">${loadingSkeleton(3)}</div>
    </div>
  `;

  // Territory heat is month-independent — load once.
  const { data: terr, error: terrErr } = await sb.rpc('crm_territory_potential');
  if (terrErr) {
    showError(container.querySelector('#pjp-cal'), 'Failed to load territories: ' + terrErr.message, () => crmPjp(container));
    return;
  }
  const territories = (terr || []).filter(t => t.territory && t.territory !== '(no hub)');
  // Both the shading and the number are the same real figure: rupees RT
  // billed these partners in the last 12 months. Nothing is weighted.
  const valueByHub = Object.fromEntries(territories.map(t => [t.territory, +t.open_value || 0]));
  const heatByHub = valueByHub;
  const maxHeat = Math.max(1, ...territories.map(t => +t.open_value || 0));

  // Person switcher for TL / admin — a rep only ever sees their own plan.
  if (canSeeOthers()) {
    const { data: users } = await sb.from('users')
      .select('id, full_name, designation').eq('status', 'active').order('full_name');
    const sel = container.querySelector('#pjp-person');
    sel.style.display = '';
    sel.innerHTML = (users || []).map(u =>
      `<option value="${u.id}" ${u.id === personId ? 'selected' : ''}>${esc(u.full_name || 'Unnamed')}${u.designation ? ' — ' + esc(u.designation) : ''}</option>`
    ).join('');
    if (!users?.some(u => u.id === personId) && me) {
      sel.insertAdjacentHTML('afterbegin', `<option value="${me.id}" selected>Me</option>`);
    }
    sel.addEventListener('change', () => { personId = sel.value; render(); });
  }

  container.querySelector('#pjp-prev').addEventListener('click', () => { cursor.setMonth(cursor.getMonth() - 1); render(); });
  container.querySelector('#pjp-next').addEventListener('click', () => { cursor.setMonth(cursor.getMonth() + 1); render(); });

  container.querySelector('#pjp-legend').innerHTML = `
    <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
      <span>Business needing attention in the planned area:</span>
      ${[0.15, 0.4, 0.7, 1].map(f => `<span style="display:inline-block;width:26px;height:12px;border-radius:3px;background:color-mix(in srgb, var(--color-accent) ${Math.round(f * 70)}%, transparent)"></span>`).join('')}
      <span>low → high</span>
      <span style="margin-left:auto">${territories.length} areas · ${inr(territories.reduce((t, x) => t + (+x.open_value || 0), 0))} billed in 12 months</span>
    </div>`;

  await render();

  async function render() {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    container.querySelector('#pjp-month').textContent = monthStart.toLocaleDateString('en', MONTH_FMT);

    const [{ data: plans, error }, { data: lockRow }] = await Promise.all([
      sb.from('crm_pjp_day_plans')
        .select('id, plan_date, territory, notes, bde_id')
        .eq('bde_id', personId)
        .gte('plan_date', iso(monthStart))
        .lte('plan_date', iso(monthEnd)),
      sb.from('crm_pjp_month_locks')
        .select('id, locked_at').eq('bde_id', personId).eq('month_start', iso(monthStart)).maybeSingle(),
    ]);
    if (error) {
      showError(container.querySelector('#pjp-cal'), 'Failed to load the plan: ' + error.message, render);
      return;
    }
    const byDate = Object.fromEntries((plans || []).map(p => [p.plan_date, p]));
    const locked = !!lockRow;
    renderLock(monthStart, locked, lockRow, (plans || []).length);

    // Monday-first grid, padded to whole weeks.
    const lead = (monthStart.getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= monthEnd.getDate(); d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    while (cells.length % 7) cells.push(null);

    const today = iso(new Date());
    container.querySelector('#pjp-cal').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
        ${DAY_LABELS.map(d => `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);text-align:center;padding-bottom:var(--space-1)">${d}</div>`).join('')}
        ${cells.map(d => {
          if (!d) return `<div></div>`;
          const key = iso(d);
          const plan = byDate[key];
          const heat = plan ? (heatByHub[plan.territory] || 0) / maxHeat : 0;
          const intensity = plan ? Math.max(0.12, heat) : 0;
          const bg = plan ? `color-mix(in srgb, var(--color-accent) ${Math.round(intensity * 70)}%, transparent)` : 'var(--color-bg-secondary)';
          // Past ~half intensity the accent wash is saturated enough that the
          // default and secondary text colours stop being legible on it in
          // either theme, so flip the whole cell to inverse text.
          const hot = intensity >= 0.5;
          const fg = hot ? 'color:#fff' : '';
          const subFg = hot ? 'color:rgba(255,255,255,.82)' : 'color:var(--color-text-secondary)';
          const weekend = d.getDay() === 0;
          return `<div class="pjp-day" data-date="${key}" role="button" tabindex="0"
            style="min-height:74px;border-radius:var(--radius-md);border:1px solid ${key === today ? 'var(--color-accent)' : 'var(--color-border-light)'};
                   background:${bg};padding:6px;cursor:pointer;opacity:${weekend && !plan ? .5 : 1};display:flex;flex-direction:column;gap:2px;${fg}">
            <div style="font-size:var(--text-xs);font-weight:${key === today ? 'var(--font-weight-bold)' : 'var(--font-weight-medium)'};${subFg}">${d.getDate()}</div>
            ${plan ? `<div style="font-size:var(--text-xs);font-weight:var(--font-weight-semibold);line-height:1.2;${fg}">${esc(plan.territory)}</div>
                      <div style="font-size:10px;${subFg};margin-top:auto" title="Open opportunity in ${esc(plan.territory)}">${inr(valueByHub[plan.territory] || 0)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`;

    container.querySelectorAll('.pjp-day').forEach(el => {
      const plan = byDate[el.dataset.date];
      // Locked month: the plan is committed, so a day no longer opens the
      // editable planner — it opens the gap-led "who to visit first" tab. An
      // unplanned day in a locked month has nothing to show.
      const open = () => {
        if (locked) {
          if (plan) openGapDay(el.dataset.date, plan);
          else toast('This month is locked. Unlock it to plan more days.');
        } else {
          openDay(el.dataset.date, plan);
        }
      };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });

    await renderAdherence(monthStart, monthEnd);
  }

  // ---- day planner + drill-down ----
  async function openDay(dateKey, plan) {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="form-group">
        <label class="form-label">Area for ${esc(new Date(dateKey + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' }))}</label>
        <select class="form-input" id="pd-terr">
          <option value="">— No plan —</option>
          ${territories.map(t => `<option value="${esc(t.territory)}" ${plan?.territory === t.territory ? 'selected' : ''}>
            ${esc(t.territory)} — ${t.partners} partners, ${inr(t.open_value)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <input type="text" class="form-input" id="pd-notes" placeholder="Optional" value="${esc(plan?.notes || '')}">
      </div>
      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4)">
        <button class="btn btn-primary btn-sm" id="pd-save">Save day</button>
        ${plan ? `<button class="btn btn-ghost btn-sm" id="pd-clear">Clear</button>` : ''}
      </div>
      <div id="pd-accounts"></div>`;
    openModal('Plan this day', body);

    const terrSel = body.querySelector('#pd-terr');
    terrSel.addEventListener('change', () => loadAccounts(terrSel.value));
    await loadAccounts(terrSel.value);

    body.querySelector('#pd-save').addEventListener('click', async () => {
      const territory = terrSel.value;
      if (!territory) { toast('Pick an area, or use Clear'); return; }
      const { error } = await sb.from('crm_pjp_day_plans').upsert({
        org_id: org.id, bde_id: personId, plan_date: dateKey, territory,
        notes: body.querySelector('#pd-notes').value.trim() || null, created_by: me?.id || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'org_id,bde_id,plan_date' });
      if (error) { toast('Could not save: ' + error.message); return; }
      toast('Day planned');
      closeModal();
      render();
    });

    body.querySelector('#pd-clear')?.addEventListener('click', async () => {
      const { error } = await sb.from('crm_pjp_day_plans').delete()
        .eq('bde_id', personId).eq('plan_date', dateKey);
      if (error) { toast('Could not clear: ' + error.message); return; }
      toast('Day cleared');
      closeModal();
      render();
    });

    // Ranked partners for the chosen hub — the point of the drill-down.
    async function loadAccounts(territory) {
      const host = body.querySelector('#pd-accounts');
      if (!territory) { host.innerHTML = ''; return; }
      host.innerHTML = loadingSkeleton(4);
      const { data, error } = await sb.rpc('crm_pjp_day_accounts', { p_territory: territory }).range(0, 199);
      if (error) { host.innerHTML = `<div style="color:var(--color-error);font-size:var(--text-sm)">${esc(error.message)}</div>`; return; }
      const list = data || [];
      if (!list.length) { host.innerHTML = `<div class="empty-state" style="padding:var(--space-5)"><div class="empty-state-desc">No partners needing attention in ${esc(territory)}.</div></div>`; return; }
      host.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2)">
          <div style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold)">Who to see in ${esc(territory)}</div>
          ${canManageData() ? `<button class="btn btn-ghost btn-sm" id="pd-export">Export</button>` : ''}
        </div>
        <div class="table-wrap" style="max-height:42vh;overflow:auto"><table class="table">
          <thead><tr><th>Partner</th><th>Why</th><th style="text-align:right">Business (12 mo)</th><th style="text-align:right">Last visit</th></tr></thead>
          <tbody>${list.map(r => `<tr>
              <td><a data-acc="${r.account_id}" style="color:var(--color-accent);cursor:pointer">${esc(r.name)}</a>
                ${r.district_new ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(r.district_new)}</div>` : ''}</td>
              <td>${(r.reasons || []).map(k => {
                  const m = REASON_BY_KEY[k]; if (!m) return '';
                  return `<span class="badge" style="font-size:10px;background:${m.color}22;color:${m.color};margin-right:4px">${esc(m.label)}</span>`;
                }).join('')}
                ${r.last_activation_date ? `<div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:2px">last bought ${esc(r.last_activation_type || '')} ${esc(new Date(r.last_activation_date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: '2-digit' }))}</div>` : ''}</td>
              <td style="text-align:right;font-weight:var(--font-weight-semibold)">${inr(r.value_12m)}</td>
              <td style="text-align:right;font-size:var(--text-xs);color:${(r.days_since_visit ?? 999) > 120 ? 'var(--color-warning)' : 'var(--color-text-secondary)'}">
                ${r.days_since_visit == null ? 'none this year' : r.days_since_visit + 'd'}</td>
            </tr>`).join('')}</tbody>
        </table></div>`;
      host.querySelectorAll('[data-acc]').forEach(a => a.addEventListener('click', () => { closeModal(); navigate(`crm/account?id=${a.dataset.acc}`); }));
      host.querySelector('#pd-export')?.addEventListener('click', () => downloadCsv(`pjp_${territory}_${dateKey}.csv`,
        list.map(r => ({ Partner: r.name, 'Site ID': r.external_id || '', District: r.district_new || '',
          Why: (r.reasons || []).join(' '), Customers: r.customer_count ?? '',
          'Last bought': r.last_activation_date || '', 'Business 12mo': Math.round(+r.value_12m || 0),
          'Days since visit': r.days_since_visit ?? '' }))));
    }
  }

  // ---- month lock ----
  // The plan is a month-start commitment. Locking it freezes the days (the DB
  // enforces this too — see crm_pjp_month_locks) and switches each day from the
  // editable planner to the gap-led prediction.
  function renderLock(monthStart, locked, lockRow, plannedCount) {
    const host = container.querySelector('#pjp-lock');
    if (!host) return;
    if (locked) {
      const when = lockRow?.locked_at ? new Date(lockRow.locked_at).toLocaleDateString('en', { day: 'numeric', month: 'short' }) : '';
      host.innerHTML = `
        <span class="badge badge-success" style="display:inline-flex;align-items:center;gap:4px" title="Committed${when ? ' ' + esc(when) : ''}">🔒 Plan locked</span>
        <button class="btn btn-ghost btn-sm" id="pjp-unlock">Unlock</button>`;
      host.querySelector('#pjp-unlock').addEventListener('click', () => unlockMonth(monthStart));
    } else {
      const can = plannedCount > 0;
      host.innerHTML = `<button class="btn btn-secondary btn-sm" id="pjp-lockbtn" ${can ? '' : 'disabled title="Plan at least one day first"'}>Lock plan</button>`;
      host.querySelector('#pjp-lockbtn').addEventListener('click', () => { if (can) lockMonth(monthStart); });
    }
  }

  async function lockMonth(monthStart) {
    const { error } = await sb.from('crm_pjp_month_locks').insert({
      org_id: org.id, bde_id: personId, month_start: iso(monthStart), locked_by: me?.id || null,
    });
    if (error) { toast('Could not lock: ' + error.message); return; }
    toast('Plan locked — days now show who to visit first');
    render();
  }

  async function unlockMonth(monthStart) {
    const { error } = await sb.from('crm_pjp_month_locks').delete()
      .eq('bde_id', personId).eq('month_start', iso(monthStart));
    if (error) { toast('Could not unlock: ' + error.message); return; }
    toast('Plan unlocked');
    render();
  }

  // ---- locked-day drill-down: who to visit first (gap prediction) ----
  // Ranks the planned area's partners by rupee gap — what a partner of its size
  // should be billing where it sits, minus what it does. The working is shown
  // (expected, peer rate, base) so it never reads as a bare score.
  async function openGapDay(dateKey, plan) {
    const when = new Date(dateKey + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' });
    const body = document.createElement('div');
    body.innerHTML = `
      <div style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-3)">
        ${esc(when)} · biggest untapped business first. Gap = what this partner's size should bill here − what it does.
      </div>
      <div id="gd-list">${loadingSkeleton(5)}</div>`;
    openModal(`Who to visit first — ${esc(plan.territory)}`, body);

    const host = body.querySelector('#gd-list');
    const { data, error } = await sb.rpc('crm_pjp_gap_accounts', { p_territory: plan.territory }).range(0, 299);
    if (error) { host.innerHTML = `<div style="color:var(--color-error);font-size:var(--text-sm)">${esc(error.message)}</div>`; return; }
    const list = data || [];
    if (!list.length) {
      host.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">No partners to rank in ${esc(plan.territory)}.</div></div>`;
      return;
    }
    const scored = list.filter(r => r.gap != null).length;
    host.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2)">
        <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${scored.toLocaleString('en-IN')} of ${list.length.toLocaleString('en-IN')} partners scored on gap · the rest fall to billed rupees</div>
        ${canManageData() ? `<button class="btn btn-ghost btn-sm" id="gd-export">Export</button>` : ''}
      </div>
      <div class="table-wrap" style="max-height:52vh;overflow:auto"><table class="table">
        <thead><tr><th>Partner</th><th>Why</th><th style="text-align:right">Gap</th><th style="text-align:right">Billed</th><th style="text-align:right">Last visit</th></tr></thead>
        <tbody>${list.map(r => {
          const dsv = r.days_since_visit;
          const stale = dsv == null || dsv > 120;
          const gapCell = r.gap == null
            ? `<span style="color:var(--color-text-tertiary)">—</span>`
            : `<span style="font-weight:var(--font-weight-semibold);color:var(--color-accent)" title="Expected ${inr(r.expected)} at the ${esc(r.peer_scope || '')} rate of ₹${(+r.peer_per_user || 0).toLocaleString('en-IN')}/user × ${r.customer_count} users, vs ${inr(r.actual)} billed">${inr(r.gap)}</span>
               <div style="font-size:10px;color:var(--color-text-tertiary);font-weight:var(--font-weight-normal)">of ${inr(r.expected)} expected</div>`;
          return `<tr>
            <td style="font-weight:var(--font-weight-medium)">
              <a data-acc="${r.account_id}" style="color:var(--color-accent);cursor:pointer">${esc(r.name)}</a>
              ${r.tier === 'Star AP' ? `<span class="badge" style="font-size:9px;background:var(--color-warning)22;color:var(--color-warning);margin-left:4px">Star AP</span>` : ''}
              ${r.district_new ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(r.district_new)}</div>` : ''}
            </td>
            <td>${(r.reasons || []).map(k => {
                const m = REASON_BY_KEY[k]; if (!m) return '';
                return `<span class="badge" style="font-size:10px;background:${m.color}22;color:${m.color};margin-right:4px">${esc(m.label)}</span>`;
              }).join('')}
              ${r.customer_count ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:2px">${r.customer_count} users</div>` : ''}</td>
            <td style="text-align:right">${gapCell}</td>
            <td style="text-align:right;font-weight:var(--font-weight-semibold)">${inr(r.actual)}</td>
            <td style="text-align:right;font-size:var(--text-xs);color:${stale ? 'var(--color-warning)' : 'var(--color-text-secondary)'}">
              ${r.last_visit_date ? esc(new Date(r.last_visit_date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' })) + `<div style="font-size:10px">${dsv}d ago</div>` : 'none this year'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    host.querySelectorAll('[data-acc]').forEach(a => a.addEventListener('click', () => { closeModal(); navigate(`crm/account?id=${a.dataset.acc}`); }));
    host.querySelector('#gd-export')?.addEventListener('click', () => downloadCsv(`visit_first_${plan.territory}_${dateKey}.csv`,
      list.map(r => ({ Partner: r.name, 'Site ID': r.external_id || '', District: r.district_new || '', Tier: r.tier || '',
        Why: (r.reasons || []).join(' '), Users: r.customer_count ?? '',
        'Per user': r.per_user ?? '', 'Peer per user': r.peer_per_user ?? '', 'Peer scope': r.peer_scope || '',
        Expected: r.expected ?? '', Gap: r.gap ?? '', Billed: Math.round(+r.actual || 0),
        'Last visit': r.last_visit_date || '' }))));
  }

  // ---- adherence ----
  async function renderAdherence(from, to) {
    const host = container.querySelector('#pjp-adherence');
    const { data, error } = await sb.rpc('crm_pjp_adherence', { p_from: iso(from), p_to: iso(to) });
    if (error) { showError(host, 'Failed to load adherence: ' + error.message, () => renderAdherence(from, to)); return; }
    const rows = (data || []).filter(r => r.person_id === personId);
    if (!rows.length) {
      host.innerHTML = `<div class="empty-state" style="padding:var(--space-6)">
        <div class="empty-state-title">Nothing to measure yet</div>
        <div class="empty-state-desc">Plan some days, then log visits against them — adherence compares the two.</div></div>`;
      return;
    }
    host.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Week of</th><th style="text-align:right">Planned days</th><th style="text-align:right">Visits</th>
        <th style="text-align:right">On plan</th><th style="text-align:right">Adherence</th>
        <th style="text-align:right">Business on plan</th><th style="text-align:right">Business off plan</th></tr></thead>
      <tbody>${rows.map(r => {
        const rate = r.adherence_rate == null ? null : +r.adherence_rate;
        const col = rate == null ? 'var(--color-text-tertiary)' : rate >= 70 ? 'var(--color-success)' : rate >= 40 ? 'var(--color-warning)' : 'var(--color-error)';
        return `<tr>
          <td>${new Date(r.week_start + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' })}</td>
          <td style="text-align:right">${r.planned_days}</td>
          <td style="text-align:right">${r.visits_total}</td>
          <td style="text-align:right">${r.visits_on_plan}</td>
          <td style="text-align:right;font-weight:var(--font-weight-semibold);color:${col}">${rate == null ? '—' : rate + '%'}</td>
          <td style="text-align:right">${inr(r.value_on_plan)}</td>
          <td style="text-align:right;color:var(--color-text-secondary)">${inr(r.value_off_plan)}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }
}
