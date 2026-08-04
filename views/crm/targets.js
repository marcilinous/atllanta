import { getOrg } from '../../js/auth.js';
import { esc, loadingSkeleton } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { fetchAllRpc, canManageData } from './common.js';
import { downloadCsv } from '../../js/ui.js';

const inr = (n) => {
  n = Math.round(+n || 0);
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
  return '₹' + n.toLocaleString('en-IN');
};

// A partner's single highest-priority target reason (null = active, no action).
function target(p) {
  const tpC = +p.tp_cfy, tpL = +p.tp_lfy, anyC = +p.any_cfy, anyL = +p.any_lfy, revL = +p.rev_lfy, revC = +p.rev_cfy;
  if (tpL >= 1 && tpC === 0) return { key: 'winback', label: 'Win back TP', color: 'var(--color-error)', val: revL };
  if (anyL > 0 && anyC === 0) return { key: 'revive', label: 'Revive — no business this FY', color: 'var(--color-warning)', val: revL };
  if (tpC > 0 && tpC < tpL) return { key: 'grow', label: 'Grow TP — down vs last year', color: 'var(--color-warning)', val: revL - revC };
  if (tpC === 0) return { key: 'prospect', label: 'Sell TP — never bought', color: 'var(--color-accent)', val: revL };
  return null;
}
const CARDS = [
  { key: 'winback', title: 'Win back TP', desc: 'Bought TP last year, none this year' },
  { key: 'revive', title: 'Revive', desc: 'Did business last year, silent this year' },
  { key: 'grow', title: 'Grow TP', desc: 'Doing less TP than last year' },
  { key: 'prospect', title: 'Sell TP', desc: 'Never bought Tally Prime' },
  { key: 'protect', title: 'Protect', desc: 'Bought/renewed but no visit or call' },
];

export default async function crmTargets(container) {
  const org = getOrg();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">My targets</h1>
      <p class="page-subtitle">Where to do business — your partners, ranked by opportunity.</p>
    </div>
    <div id="tg-kpi" class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3);margin-bottom:var(--space-5)"></div>
    <div id="tg-cards" class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-3);margin-bottom:var(--space-6)">${loadingSkeleton(3)}</div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <span class="card-title" id="tg-list-title">Priority list</span>
        <div style="display:flex;gap:var(--space-2)">
          <input type="text" class="form-input" id="tg-search" placeholder="Search partner / district" style="max-width:220px;height:32px">
          <button class="btn btn-ghost btn-sm" id="tg-all" style="display:none">Show all</button>
        </div>
      </div>
      <div id="tg-list">${loadingSkeleton(6)}</div>
    </div>
  `;

  const { data: rows } = await fetchAllRpc('crm_partner_activity');
  const data = rows || [];

  // classify
  data.forEach(p => { p._t = target(p); p._protect = ((+p.tp_cfy > 0 && !p.visited_by_me) || (+p.tss_cfy > 0 && !p.called)); });
  const targets = data.filter(p => p._t).sort((a, b) => b._t.val - a._t.val);

  // KPIs
  const revFY = data.reduce((t, p) => t + (+p.rev_cfy || 0), 0);
  const tpFY = data.reduce((t, p) => t + (+p.tp_cfy || 0), 0);
  const visitedByMe = data.filter(p => p.visited_by_me).length;
  const kpi = (l, v, s, c) => `<div class="card"><div class="card-body">
    <div style="font-size:var(--text-xs);color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.04em">${l}</div>
    <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:${c || 'var(--color-text-primary)'}">${v}</div>
    ${s ? `<div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${s}</div>` : ''}</div></div>`;
  container.querySelector('#tg-kpi').innerHTML =
    kpi('My partners', data.length.toLocaleString('en-IN')) +
    kpi('My revenue (FY)', inr(revFY), `${tpFY.toLocaleString('en-IN')} TP sold`, 'var(--color-success)') +
    kpi('Visited by you', `${visitedByMe.toLocaleString('en-IN')} / ${data.length.toLocaleString('en-IN')}`, 'your field visits') +
    kpi('Open opportunities', targets.length.toLocaleString('en-IN'), 'partners to pursue', 'var(--color-accent)');

  // cards (counts)
  const counts = {};
  CARDS.forEach(c => counts[c.key] = c.key === 'protect' ? data.filter(p => p._protect).length : targets.filter(p => p._t.key === c.key).length);
  container.querySelector('#tg-cards').innerHTML = CARDS.map(c => `
    <div class="card tg-card" data-key="${c.key}" style="cursor:pointer;border-left:3px solid ${c.key === 'protect' ? 'var(--color-success)' : 'var(--color-accent)'}">
      <div class="card-body">
        <div style="font-size:var(--text-xl);font-weight:var(--font-weight-bold)">${counts[c.key].toLocaleString('en-IN')}</div>
        <div style="font-weight:var(--font-weight-medium)">${esc(c.title)}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(c.desc)}</div>
      </div>
    </div>`).join('');

  let filterKey = null;
  let search = '';
  const listTitle = container.querySelector('#tg-list-title');
  const allBtn = container.querySelector('#tg-all');

  function currentList() {
    let list = filterKey === 'protect' ? data.filter(p => p._protect)
      : filterKey ? targets.filter(p => p._t.key === filterKey)
      : targets;
    if (search) list = list.filter(p => (p.name || '').toLowerCase().includes(search) || (p.district_new || '').toLowerCase().includes(search));
    return list;
  }

  function renderList() {
    const list = currentList();
    listTitle.textContent = filterKey ? (CARDS.find(c => c.key === filterKey).title + ` (${list.length.toLocaleString('en-IN')})`) : `Priority list (${list.length.toLocaleString('en-IN')})`;
    allBtn.style.display = filterKey ? '' : 'none';
    const el = container.querySelector('#tg-list');
    if (!list.length) { el.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">Nothing here 🎉</div></div>`; return; }
    el.innerHTML = `<div class="table-wrap" style="max-height:64vh;overflow:auto"><table class="table">
      <thead><tr><th>Partner</th><th>District</th><th>Why</th><th style="text-align:center">Touched</th><th style="text-align:right">LFY / CFY ₹</th><th style="text-align:right">TP L/C</th></tr></thead>
      <tbody>${list.slice(0, 300).map(p => {
        const reason = filterKey === 'protect' ? { label: (+p.tp_cfy > 0 ? 'TP, no visit' : 'TSS, no call'), color: 'var(--color-success)' } : p._t;
        return `<tr>
          <td style="font-weight:var(--font-weight-medium)"><a data-acc="${p.account_id}" style="color:var(--color-accent);cursor:pointer">${esc(p.name)}</a>
            ${p.external_id ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);font-family:var(--font-mono)">${esc(p.external_id)}</div>` : ''}</td>
          <td>${p.district_new ? esc(p.district_new) : '—'}</td>
          <td><span class="badge" style="font-size:10px;background:${reason.color}22;color:${reason.color}">${esc(reason.label)}</span></td>
          <td style="text-align:center" title="${p.visited_by_me ? 'You visited' : ''}${p.called ? ' · Called' : ''}">${p.visited_by_me ? '🚗' : ''}${p.called ? '📞' : ''}${!p.visited_by_me && !p.called ? '<span style="color:var(--color-text-tertiary)">—</span>' : ''}</td>
          <td style="text-align:right">${inr(p.rev_lfy)} / ${inr(p.rev_cfy)}</td>
          <td style="text-align:right">${p.tp_lfy}/${p.tp_cfy}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div style="padding:var(--space-3) var(--space-4);display:flex;justify-content:space-between;align-items:center;font-size:var(--text-sm);color:var(--color-text-secondary)">
      <span>Showing ${Math.min(300, list.length).toLocaleString('en-IN')} of ${list.length.toLocaleString('en-IN')}, highest value first.</span>
      ${canManageData() ? `<button class="btn btn-secondary btn-sm" id="tg-export">Export</button>` : ''}
    </div>`;
    el.querySelectorAll('[data-acc]').forEach(a => a.addEventListener('click', () => navigate(`crm/account?id=${a.dataset.acc}`)));
    el.querySelector('#tg-export')?.addEventListener('click', () => downloadCsv(`my_targets_${filterKey || 'all'}.csv`,
      list.map(p => ({ 'Site ID': p.external_id || '', Partner: p.name, District: p.district_new || '',
        Why: (filterKey === 'protect' ? 'protect' : p._t.key), 'Rev LFY': Math.round(+p.rev_lfy || 0), 'Rev CFY': Math.round(+p.rev_cfy || 0), 'TP LFY': p.tp_lfy, 'TP CFY': p.tp_cfy }))));
  }
  renderList();

  container.querySelectorAll('.tg-card').forEach(c => c.addEventListener('click', () => { filterKey = c.dataset.key; renderList(); }));
  allBtn.addEventListener('click', () => { filterKey = null; renderList(); });
  container.querySelector('#tg-search').addEventListener('input', (e) => { search = e.target.value.toLowerCase().trim(); renderList(); });
}
