import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, openModal, closeModal, downloadCsv, loadingSkeleton } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { ownerName, canManageData } from './common.js';

const pct = (n, d) => d ? Math.round((100 * n) / d) : 0;
const inr = (n) => {
  n = Math.round(n || 0);
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
  return '₹' + n.toLocaleString('en-IN');
};
const ZERO = () => ({ partners: 0, rev: 0, tp: 0, tss: 0, uap: 0, touched: 0 });

export default async function crmCoverage(container) {
  const org = getOrg();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><button class="btn btn-ghost btn-sm" id="back">← CRM</button></div>
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Business by territory</h1>
        <p class="page-subtitle">Revenue, TP/TSS and open opportunity per team — rolled up CM → TL → BDE.</p>
      </div>
      <button class="btn btn-primary" id="to-opps">Opportunities →</button>
    </div>
    <div id="cov-kpi" class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3);margin-bottom:var(--space-6)"></div>
    <div class="card">
      <div class="card-header"><span class="card-title">Team scorecard (FY to date)</span></div>
      <div id="cov-tree">${loadingSkeleton(6)}</div>
    </div>
  `;
  container.querySelector('#back').addEventListener('click', () => navigate('crm'));
  container.querySelector('#to-opps').addEventListener('click', () => navigate('crm/opps'));

  const [{ data: rows, error }, { data: users }] = await Promise.all([
    sb.rpc('crm_partner_activity'),
    sb.from('users').select('id, full_name, designation, reporting_manager_id').eq('status', 'active'),
  ]);
  if (error) { container.querySelector('#cov-tree').innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">Could not load.</div></div>`; return; }
  const data = rows || [];
  const staff = users || [];

  const metrics = (p) => ({
    partners: 1, rev: +p.rev_cfy || 0, tp: +p.tp_cfy || 0, tss: +p.tss_cfy || 0,
    uap: p.tp_cfy === 0 ? 1 : 0, touched: (p.visited || p.called || p.any_cfy > 0) ? 1 : 0,
  });

  // overall
  const total = ZERO();
  data.forEach(p => { const m = metrics(p); for (const k in total) total[k] += m[k]; });
  const kpi = (label, val, sub, color) => `
    <div class="card"><div class="card-body">
      <div style="font-size:var(--text-xs);color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.04em">${label}</div>
      <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:${color || 'var(--color-text-primary)'}">${val}</div>
      ${sub ? `<div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${sub}</div>` : ''}
    </div></div>`;
  container.querySelector('#cov-kpi').innerHTML =
    kpi('Revenue (FY)', inr(total.rev), `${total.partners.toLocaleString('en-IN')} partners`, 'var(--color-success)') +
    kpi('TP sold', total.tp.toLocaleString('en-IN'), 'new licences') +
    kpi('TSS', total.tss.toLocaleString('en-IN'), 'renewals') +
    kpi('UAP', total.uap.toLocaleString('en-IN'), 'no TP this FY', 'var(--color-error)') +
    kpi('Covered', `${pct(total.touched, total.partners)}%`, `${(total.partners - total.touched).toLocaleString('en-IN')} untouched`);

  // hierarchy
  const byId = new Map(staff.map(u => [u.id, u]));
  const kids = new Map();
  staff.forEach(u => {
    const p = (u.reporting_manager_id && byId.has(u.reporting_manager_id)) ? u.reporting_manager_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(u);
  });
  const roots = kids.get(null) || [];
  const subtree = new Map();
  (function () { function collect(u) { const s = new Set([u.id]); (kids.get(u.id) || []).forEach(c => collect(c).forEach(x => s.add(x))); subtree.set(u.id, s); return s; } roots.forEach(collect); })();

  const own = new Map();
  data.forEach(p => {
    if (!own.has(p.owner_id)) own.set(p.owner_id, ZERO());
    const o = own.get(p.owner_id), m = metrics(p);
    for (const k in o) o[k] += m[k];
  });
  function agg(u) {
    const a = own.get(u.id) ? { ...own.get(u.id) } : ZERO();
    (kids.get(u.id) || []).forEach(c => { const cc = agg(c); for (const k in a) a[k] += cc[k]; });
    u._a = a; return a;
  }
  roots.forEach(agg);

  const treeEl = container.querySelector('#cov-tree');
  const top = roots.filter(r => r._a.partners > 0).sort((a, b) => b._a.rev - a._a.rev);
  if (!top.length) { treeEl.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">No partners in scope.</div></div>`; return; }

  const num = (v, w, strong) => `<div style="width:${w}px;text-align:right;flex-shrink:0${strong ? ';font-weight:var(--font-weight-semibold)' : ''}">${v}</div>`;
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--color-border);font-size:var(--text-xs);color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.03em;min-width:760px';
  head.innerHTML = `<div style="flex:1;min-width:200px">Team</div>${num('Partners',90)}${num('Revenue',110)}${num('TP',55)}${num('TSS',65)}${num('UAP',75)}${num('Cov%',70)}`;
  const scroll = document.createElement('div');
  scroll.style.cssText = 'overflow-x:auto';
  scroll.appendChild(head);
  treeEl.innerHTML = '';
  treeEl.appendChild(scroll);

  function renderNode(u, depth, host) {
    const a = u._a;
    if (a.partners === 0) return;
    const kidList = (kids.get(u.id) || []).filter(c => c._a.partners > 0).sort((x, y) => y._a.rev - x._a.rev);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--color-border-light);min-width:760px';
    const cov = pct(a.touched, a.partners);
    row.innerHTML = `
      <div style="flex:1;min-width:200px;display:flex;align-items:center;gap:var(--space-2);padding-left:${depth * 20}px">
        ${kidList.length ? `<span class="cov-toggle" style="cursor:pointer;color:var(--color-text-tertiary);width:14px;display:inline-block">▾</span>` : `<span style="width:14px;display:inline-block"></span>`}
        <a class="cov-drill" style="cursor:pointer"><span style="font-weight:var(--font-weight-medium);color:var(--color-accent)">${esc(u.full_name || '—')}</span>
          <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(u.designation || '')}</span></a>
      </div>
      ${num(a.partners.toLocaleString('en-IN'), 90)}
      ${num(inr(a.rev), 110, true)}
      ${num(a.tp.toLocaleString('en-IN'), 55)}
      ${num(a.tss.toLocaleString('en-IN'), 65)}
      ${num(`<span style="color:${a.uap ? 'var(--color-error)' : 'inherit'}">${a.uap.toLocaleString('en-IN')}</span>`, 75)}
      ${num(`<span style="color:${cov >= 66 ? 'var(--color-success)' : cov >= 33 ? 'var(--color-warning)' : 'var(--color-error)'}">${cov}%</span>`, 70)}`;
    host.appendChild(row);
    const childHost = document.createElement('div');
    host.appendChild(childHost);
    kidList.forEach(c => renderNode(c, depth + 1, childHost));
    row.querySelector('.cov-toggle')?.addEventListener('click', () => {
      const hidden = childHost.style.display === 'none';
      childHost.style.display = hidden ? '' : 'none';
      row.querySelector('.cov-toggle').textContent = hidden ? '▾' : '▸';
    });
    row.querySelector('.cov-drill').addEventListener('click', () => showPartners(u));
  }
  top.forEach(r => renderNode(r, 0, scroll));

  function showPartners(u) {
    const s = subtree.get(u.id) || new Set([u.id]);
    const list = data.filter(p => s.has(p.owner_id)).sort((a, b) => (+b.rev_cfy) - (+a.rev_cfy));
    const body = document.createElement('div');
    if (!list.length) { body.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">No partners.</div></div>`; openModal(u.full_name || 'Partners', body); return; }
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)"><strong>${list.length.toLocaleString('en-IN')}</strong> partners · ${inr(list.reduce((t, p) => t + (+p.rev_cfy || 0), 0))} FY</div>
        ${canManageData() ? `<button class="btn btn-secondary btn-sm" id="cov-export">Export</button>` : ''}
      </div>
      <div class="table-wrap" style="max-height:58vh;overflow:auto"><table class="table">
        <thead><tr><th>Site ID</th><th>Partner</th><th>District</th><th>Owner</th><th style="text-align:right">Revenue</th><th style="text-align:right">TP</th><th style="text-align:right">TSS</th></tr></thead>
        <tbody>${list.slice(0, 500).map(p => `<tr>
          <td style="font-family:var(--font-mono);font-size:var(--text-sm)">${p.external_id ? esc(p.external_id) : '—'}</td>
          <td><a data-acc="${p.account_id}" style="color:var(--color-accent);cursor:pointer">${esc(p.name)}</a></td>
          <td>${p.district_new ? esc(p.district_new) : '—'}</td>
          <td>${esc(ownerName(staff, p.owner_id))}</td>
          <td style="text-align:right">${inr(+p.rev_cfy)}</td>
          <td style="text-align:right">${p.tp_cfy}</td>
          <td style="text-align:right">${p.tss_cfy}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${list.length > 500 ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-2)">Showing first 500${canManageData() ? ' — export for all' : ''}.</div>` : ''}`;
    body.querySelector('#cov-export')?.addEventListener('click', () =>
      downloadCsv(`partners_${(u.full_name || 'team').replace(/[^\w.-]+/g, '_')}.csv`, list.map(p => ({
        'Site ID': p.external_id || '', Partner: p.name, District: p.district_new || '', Owner: ownerName(staff, p.owner_id),
        'Revenue FY': Math.round(+p.rev_cfy || 0), TP: p.tp_cfy, TSS: p.tss_cfy,
      }))));
    body.querySelectorAll('[data-acc]').forEach(el => el.addEventListener('click', () => { closeModal(); navigate(`crm/account?id=${el.dataset.acc}`); }));
    openModal(`${u.full_name || 'Team'} — partners`, body);
  }
}
