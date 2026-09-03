// Opportunities — one block, two lenses.
//
// "Mine" is a BDE's own partners ranked by where the business is; "Team" rolls
// the same opportunities up the CM -> TL -> BDE line with coverage. Both run on
// crm_partner_activity (caller-scoped) and share one set of opportunity
// definitions, so the numbers reconcile between the two views.
import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, showError, openModal, closeModal, downloadCsv, loadingSkeleton } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { ownerName, canManageData, canSeeOthers, fetchAllRpc } from './common.js';

const inr = (n) => {
  n = Math.round(+n || 0);
  if (!n) return '₹0';
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
  return '₹' + n.toLocaleString('en-IN');
};
const N = (n) => (+n || 0).toLocaleString('en-IN');
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);

// A LFY -> CFY change, rendered as an arrow that colours by direction. Counts
// are the unit here (TP/TSS activations), so no rupee formatting.
function delta(lfy, cfy) {
  lfy = +lfy || 0; cfy = +cfy || 0;
  const up = cfy > lfy, down = cfy < lfy;
  const col = down ? 'var(--color-error)' : up ? 'var(--color-success)' : 'var(--color-text-tertiary)';
  const mark = down ? '▾' : up ? '▴' : '·';
  return `<span style="font-variant-numeric:tabular-nums">${lfy}<span style="color:var(--color-text-tertiary)"> → </span><strong>${cfy}</strong></span>
          <span style="color:${col};margin-left:4px">${mark}</span>`;
}

// Opportunity definitions, shared by both lenses. `visited` resolves to the
// personal or team signal depending on the lens; `lfy` marks the ones that need
// last-year data (dimmed until it's uploaded).
function oppSet(scope) {
  const visited = (p) => (scope === 'mine' ? p.visited_by_me : p.visited);
  const called = (p) => (scope === 'mine' ? p.called_by_me : p.called);
  return [
    { key: 'uap', title: 'UAP — no TP this FY', desc: 'Zero Tally Prime activation this year', color: 'var(--color-error)', test: p => +p.tp_cfy === 0 },
    { key: 'tp_lapsed', title: 'TP lapsed', desc: 'Bought TP last year, none this year', color: 'var(--color-warning)', lfy: true, test: p => +p.tp_lfy >= 1 && +p.tp_cfy === 0 },
    { key: 'transacting', title: 'Transacting gap', desc: 'Did business last FY, none this FY', color: 'var(--color-warning)', lfy: true, test: p => +p.any_lfy > 0 && +p.any_cfy === 0 },
    { key: 'tp_drop', title: 'TP drop', desc: '5+ TP last year, fewer this year', color: 'var(--color-warning)', lfy: true, test: p => +p.tp_lfy >= 5 && +p.tp_cfy < +p.tp_lfy },
    { key: 'tp_novisit', title: 'TP done, no visit', desc: 'Sold TP but not visited', color: 'var(--color-success)', test: p => +p.tp_cfy > 0 && !visited(p) },
    { key: 'tss_nocall', title: 'TSS done, no call', desc: 'Renewed TSS but not called', color: 'var(--color-success)', test: p => +p.tss_cfy > 0 && !called(p) },
  ];
}

export default async function crmOpps(container) {
  const org = getOrg();
  const me = getUser();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }
  const teamAllowed = canSeeOthers();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-3);flex-wrap:wrap">
      <div>
        <h1 class="page-title">Opportunities</h1>
        <p class="page-subtitle">Where to drive business — your partners, or rolled up across the team.</p>
      </div>
      ${teamAllowed ? `<div class="tabs" id="op-scope" style="margin:0">
        <button class="tab active" data-scope="mine">Mine</button>
        <button class="tab" data-scope="team">Team</button>
      </div>` : ''}
    </div>
    <div id="op-kpi" class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--space-3);margin-bottom:var(--space-5)"></div>
    <div id="op-cards" class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:var(--space-3);margin-bottom:var(--space-5)">${loadingSkeleton(3)}</div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <span class="card-title" id="op-title">Priority list</span>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <input type="text" class="form-input" id="op-search" placeholder="Search partner / district" style="max-width:210px;height:32px">
          <button class="btn btn-ghost btn-sm" id="op-clear" style="display:none">Clear</button>
        </div>
      </div>
      <div id="op-body">${loadingSkeleton(6)}</div>
    </div>
  `;

  const [{ data: rows, error }, { data: users }] = await Promise.all([
    fetchAllRpc('crm_partner_activity'),
    teamAllowed ? sb.from('users').select('id, full_name, designation, reporting_manager_id').eq('status', 'active') : Promise.resolve({ data: [] }),
  ]);
  if (error) { showError(container.querySelector('#op-body'), 'Failed to load opportunities: ' + error.message, () => crmOpps(container)); return; }
  const data = rows || [];
  const staff = users || [];
  const lfyPresent = data.some(p => +p.any_lfy > 0 || +p.tp_lfy > 0 || +p.tss_lfy > 0);

  // ---- hierarchy (team lens) ----
  const byId = new Map(staff.map(u => [u.id, u]));
  const kids = new Map();
  staff.forEach(u => {
    const p = (u.reporting_manager_id && byId.has(u.reporting_manager_id)) ? u.reporting_manager_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(u);
  });
  const roots = kids.get(null) || [];
  const subtree = new Map();   // person id -> set of their whole downline (incl. self)
  function collect(u) {
    const s = new Set([u.id]);
    (kids.get(u.id) || []).forEach(c => collect(c).forEach(x => s.add(x)));
    subtree.set(u.id, s);
    return s;
  }
  roots.forEach(collect);

  let scope = 'mine';
  let opps = oppSet(scope);
  let filterKey = null;   // active opportunity card
  let search = '';

  const kpiEl = container.querySelector('#op-kpi');
  const cardsEl = container.querySelector('#op-cards');
  const bodyEl = container.querySelector('#op-body');
  const titleEl = container.querySelector('#op-title');
  const clearBtn = container.querySelector('#op-clear');

  // Which partners this lens is about: only my own for "mine", the whole
  // in-scope tree for "team".
  const scoped = () => (scope === 'mine' ? data.filter(p => p.owner_id === me?.id) : data);

  function renderKpi() {
    const list = scoped();
    const revC = list.reduce((t, p) => t + (+p.rev_cfy || 0), 0);
    const tpC = list.reduce((t, p) => t + (+p.tp_cfy || 0), 0);
    const covered = list.filter(p => (scope === 'mine' ? (p.visited_by_me || p.called_by_me) : (p.visited || p.called))).length;
    const open = list.filter(p => opps.some(o => (!o.lfy || lfyPresent) && o.test(p))).length;
    const tile = (l, v, s, c) => `<div class="card"><div class="card-body">
      <div style="font-size:var(--text-xs);color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.04em">${l}</div>
      <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);font-variant-numeric:tabular-nums;color:${c || 'var(--color-text-primary)'}">${v}</div>
      ${s ? `<div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${s}</div>` : ''}</div></div>`;
    kpiEl.innerHTML =
      tile(scope === 'mine' ? 'My partners' : 'Partners in scope', N(list.length)) +
      tile('Revenue (CFY)', inr(revC), `${N(tpC)} TP sold`, 'var(--color-success)') +
      tile('Open opportunities', N(open), 'partners to pursue', 'var(--color-accent)') +
      tile('Covered', `${pct(covered, list.length)}%`, `${N(covered)} visited or called`);
  }

  function renderCards() {
    const list = scoped();
    cardsEl.innerHTML = opps.map(o => {
      const dim = o.lfy && !lfyPresent;
      const n = dim ? 0 : list.filter(o.test).length;
      const active = filterKey === o.key;
      return `<div class="card op-card" data-opp="${o.key}" style="cursor:${dim ? 'default' : 'pointer'};opacity:${dim ? .5 : 1};
        border-left:3px solid ${o.color};${active ? 'box-shadow:0 0 0 2px var(--color-accent)' : ''}">
        <div class="card-body">
          <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);font-variant-numeric:tabular-nums">${dim ? '—' : N(n)}</div>
          <div style="font-weight:var(--font-weight-medium);margin-top:2px">${esc(o.title)}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(o.desc)}</div>
          ${dim ? `<div style="font-size:var(--text-xs);color:var(--color-warning);margin-top:var(--space-2)">Awaiting last-year upload</div>` : ''}
        </div>
      </div>`;
    }).join('');
    cardsEl.querySelectorAll('.op-card').forEach(c => c.addEventListener('click', () => {
      const o = opps.find(x => x.key === c.dataset.opp);
      if (o.lfy && !lfyPresent) return;
      filterKey = filterKey === o.key ? (scope === 'team' ? o.key : null) : o.key; // team always has a selection
      renderCards(); renderBody();
    }));
  }

  function renderBody() {
    if (scope === 'team') return renderTeam();
    return renderMine();
  }

  // ---------- MINE: a partner worklist, biggest business first ----------
  function renderMine() {
    let list = scoped();
    if (filterKey) { const o = opps.find(x => x.key === filterKey); list = list.filter(o.test); }
    if (search) list = list.filter(p => (p.name || '').toLowerCase().includes(search) || (p.district_new || '').toLowerCase().includes(search));
    list = list.slice().sort((a, b) => Math.max(+b.rev_cfy || 0, +b.rev_lfy || 0) - Math.max(+a.rev_cfy || 0, +a.rev_lfy || 0));

    titleEl.textContent = (filterKey ? opps.find(o => o.key === filterKey).title : 'Priority list') + ` (${N(list.length)})`;
    clearBtn.style.display = filterKey || search ? '' : 'none';
    if (!list.length) { bodyEl.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">Nothing here</div></div>`; return; }

    bodyEl.innerHTML = `<div class="table-wrap" style="max-height:62vh;overflow:auto"><table class="table" style="font-variant-numeric:tabular-nums">
      <thead><tr>
        <th>Partner</th><th>District</th>
        <th style="text-align:right">Visits</th><th style="text-align:right">Calls</th>
        <th style="text-align:right">TP L→C</th><th style="text-align:right">TSS L→C</th>
        <th style="text-align:right">Revenue CFY</th><th style="text-align:right">LFY</th>
      </tr></thead>
      <tbody>${list.slice(0, 400).map(p => `<tr>
        <td style="font-weight:var(--font-weight-medium)"><a data-acc="${p.account_id}" style="color:var(--color-accent);cursor:pointer">${esc(p.name)}</a>
          ${p.external_id ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);font-family:var(--font-mono)">${esc(p.external_id)}</div>` : ''}</td>
        <td style="color:var(--color-text-secondary)">${p.district_new ? esc(p.district_new) : '—'}</td>
        <td style="text-align:right">${+p.visits_me ? p.visits_me : '<span style="color:var(--color-text-tertiary)">0</span>'}</td>
        <td style="text-align:right">${+p.calls_total ? p.calls_total : '<span style="color:var(--color-text-tertiary)">0</span>'}</td>
        <td style="text-align:right">${delta(p.tp_lfy, p.tp_cfy)}</td>
        <td style="text-align:right">${delta(p.tss_lfy, p.tss_cfy)}</td>
        <td style="text-align:right;font-weight:var(--font-weight-semibold)">${inr(p.rev_cfy)}</td>
        <td style="text-align:right;color:var(--color-text-tertiary)">${inr(p.rev_lfy)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div style="padding:var(--space-3) var(--space-4);display:flex;justify-content:space-between;align-items:center;font-size:var(--text-sm);color:var(--color-text-secondary)">
      <span>Showing ${N(Math.min(400, list.length))} of ${N(list.length)}, biggest business first.</span>
      ${canManageData() ? `<button class="btn btn-secondary btn-sm" id="op-export">Export</button>` : ''}
    </div>`;
    bodyEl.querySelectorAll('[data-acc]').forEach(a => a.addEventListener('click', () => navigate(`crm/account?id=${a.dataset.acc}`)));
    bodyEl.querySelector('#op-export')?.addEventListener('click', () => downloadCsv(`opportunities_${filterKey || 'all'}.csv`,
      list.map(p => ({ 'Site ID': p.external_id || '', Partner: p.name, District: p.district_new || '',
        'Visits (me)': +p.visits_me || 0, Calls: +p.calls_total || 0,
        'TP LFY': p.tp_lfy, 'TP CFY': p.tp_cfy, 'TSS LFY': p.tss_lfy, 'TSS CFY': p.tss_cfy,
        'Rev LFY': Math.round(+p.rev_lfy || 0), 'Rev CFY': Math.round(+p.rev_cfy || 0) }))));
  }

  // ---------- TEAM: CM -> TL -> BDE rollup with coverage ----------
  function renderTeam() {
    const o = opps.find(x => x.key === filterKey) || opps.find(x => !x.lfy || lfyPresent) || opps[0];
    filterKey = o.key;
    const ownM = new Map(), ownT = new Map();
    for (const p of data) {
      ownT.set(p.owner_id, (ownT.get(p.owner_id) || 0) + 1);
      if (o.test(p)) ownM.set(p.owner_id, (ownM.get(p.owner_id) || 0) + 1);
    }
    (function agg(list) { list.forEach(u => { let m = ownM.get(u.id) || 0, t = ownT.get(u.id) || 0; agg(kids.get(u.id) || []); (kids.get(u.id) || []).forEach(c => { m += c._m; t += c._t; }); u._m = m; u._t = t; }); })(roots);

    titleEl.textContent = `${o.title} — by team`;
    clearBtn.style.display = 'none';
    const top = roots.filter(r => r._t > 0).sort((a, b) => b._m - a._m);
    if (!top.length) { bodyEl.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">No partners in scope.</div></div>`; return; }

    bodyEl.innerHTML = `<div class="table-wrap" style="max-height:62vh;overflow:auto">
      <div style="display:flex;padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--color-border);font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-tertiary)">
        <div style="flex:1;min-width:200px">Person</div>
        <div style="width:110px;text-align:right">Partners</div>
        <div style="width:230px">Opportunity · coverage</div>
      </div>
      <div id="op-tree"></div></div>`;
    const treeEl = bodyEl.querySelector('#op-tree');

    function node(u, depth, host) {
      if (u._t === 0) return;
      const kidList = (kids.get(u.id) || []).filter(c => c._t > 0).sort((a, b) => b._m - a._m);
      const share = pct(u._m, u._t);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--color-border-light)';
      row.innerHTML = `
        <div style="flex:1;min-width:200px;display:flex;align-items:center;gap:var(--space-2);padding-left:${depth * 18}px">
          ${kidList.length ? '<span class="op-tg" style="cursor:pointer;color:var(--color-text-tertiary);width:14px;display:inline-block">▾</span>' : '<span style="width:14px;display:inline-block"></span>'}
          <div><span style="font-weight:var(--font-weight-medium)">${esc(u.full_name || '—')}</span>
            ${u.designation ? `<span style="font-size:var(--text-xs);color:var(--color-text-tertiary)"> ${esc(u.designation)}</span>` : ''}</div>
        </div>
        <div style="width:110px;text-align:right;font-variant-numeric:tabular-nums;color:var(--color-text-secondary)">${N(u._t)}</div>
        <div style="width:230px;display:flex;align-items:center;gap:var(--space-2)">
          <div style="flex:1;height:6px;border-radius:3px;background:var(--color-bg-tertiary);overflow:hidden">
            <div style="height:100%;width:${share}%;background:${o.color}"></div>
          </div>
          <a class="op-drill" style="width:64px;text-align:right;color:var(--color-accent);cursor:${u._m ? 'pointer' : 'default'};font-weight:var(--font-weight-semibold);font-variant-numeric:tabular-nums">${N(u._m)}</a>
          <span style="width:38px;text-align:right;font-size:var(--text-xs);color:var(--color-text-tertiary)">${share}%</span>
        </div>`;
      host.appendChild(row);
      const childHost = document.createElement('div');
      host.appendChild(childHost);
      kidList.forEach(c => node(c, depth + 1, childHost));
      row.querySelector('.op-tg')?.addEventListener('click', () => {
        const hidden = childHost.style.display === 'none';
        childHost.style.display = hidden ? '' : 'none';
        row.querySelector('.op-tg').textContent = hidden ? '▾' : '▸';
      });
      if (u._m) row.querySelector('.op-drill').addEventListener('click', () => {
        const s = subtree.get(u.id) || new Set([u.id]);
        showList(o, data.filter(p => s.has(p.owner_id) && o.test(p)), `${o.title} — ${u.full_name || ''}`);
      });
    }
    top.forEach(r => node(r, 0, treeEl));
  }

  // ---- partner list modal (team drill-down) ----
  function showList(o, list, title) {
    const body = document.createElement('div');
    if (!list.length) { body.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">None</div></div>`; openModal(title || o.title, body); return; }
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)"><strong>${N(list.length)}</strong> partners · ${esc(o.desc)}</div>
        ${canManageData() ? `<button class="btn btn-secondary btn-sm" id="op-mexport">Export</button>` : ''}
      </div>
      <div class="table-wrap" style="max-height:58vh;overflow:auto"><table class="table" style="font-variant-numeric:tabular-nums">
        <thead><tr><th>Site ID</th><th>Partner</th><th>District</th><th>Owner</th><th style="text-align:right">TP L→C</th><th style="text-align:right">TSS L→C</th></tr></thead>
        <tbody>${list.slice(0, 500).map(p => `<tr>
          <td style="font-family:var(--font-mono);font-size:var(--text-sm)">${p.external_id ? esc(p.external_id) : '—'}</td>
          <td><a data-acc="${p.account_id}" style="color:var(--color-accent);cursor:pointer">${esc(p.name)}</a></td>
          <td>${p.district_new ? esc(p.district_new) : '—'}</td>
          <td>${esc(ownerName(staff, p.owner_id))}</td>
          <td style="text-align:right">${delta(p.tp_lfy, p.tp_cfy)}</td>
          <td style="text-align:right">${delta(p.tss_lfy, p.tss_cfy)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${list.length > 500 ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-2)">Showing first 500${canManageData() ? ' — export for the full list' : ''}.</div>` : ''}`;
    body.querySelector('#op-mexport')?.addEventListener('click', () => downloadCsv(`opp_${o.key}.csv`, list.map(p => ({
      'Site ID': p.external_id || '', Partner: p.name, District: p.district_new || '', Region: p.region || '',
      Owner: ownerName(staff, p.owner_id), 'TP LFY': p.tp_lfy, 'TP CFY': p.tp_cfy, 'TSS LFY': p.tss_lfy, 'TSS CFY': p.tss_cfy }))));
    body.querySelectorAll('[data-acc]').forEach(el => el.addEventListener('click', () => { closeModal(); navigate(`crm/account?id=${el.dataset.acc}`); }));
    openModal(title || o.title, body);
  }

  // ---- scope toggle ----
  container.querySelectorAll('#op-scope .tab').forEach(t => t.addEventListener('click', () => {
    if (t.dataset.scope === scope) return;
    scope = t.dataset.scope;
    opps = oppSet(scope);
    filterKey = scope === 'team' ? (opps.find(o => !o.lfy || lfyPresent) || opps[0]).key : null;
    container.querySelectorAll('#op-scope .tab').forEach(x => x.classList.toggle('active', x.dataset.scope === scope));
    renderKpi(); renderCards(); renderBody();
  }));
  container.querySelector('#op-search').addEventListener('input', (e) => { search = e.target.value.toLowerCase().trim(); if (scope === 'mine') renderMine(); });
  clearBtn.addEventListener('click', () => { filterKey = null; search = ''; container.querySelector('#op-search').value = ''; renderCards(); renderBody(); });

  renderKpi();
  renderCards();
  renderBody();
}
