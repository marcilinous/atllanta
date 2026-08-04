import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, downloadCsv, loadingSkeleton } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { fetchOrgUsers, ownerName } from './common.js';

const pct = (n, d) => d ? Math.round((100 * n) / d) : 0;

// Opportunity definitions. `lfy: true` needs last-year data (empty until uploaded).
const OPPS = [
  { key: 'uap', title: 'UAP — no TP this FY', desc: 'Zero Tally Prime activation this year', color: 'var(--color-error)', test: p => p.tp_cfy === 0 },
  { key: 'tp_novisit', title: 'TP done, no visit', desc: 'Sold TP but never visited — self-driven', color: 'var(--color-success)', test: p => p.tp_cfy > 0 && !p.visited },
  { key: 'tss_nocall', title: 'TSS done, no call', desc: 'Renewed TSS but never called', color: 'var(--color-success)', test: p => p.tss_cfy > 0 && !p.called },
  { key: 'transacting', title: 'Transacting gap', desc: 'Did business last FY, none this FY', color: 'var(--color-warning)', lfy: true, test: p => p.any_lfy > 0 && p.any_cfy === 0 },
  { key: 'tp_lapsed', title: 'TP lapsed (≥1 LFY, 0 CFY)', desc: 'Bought TP last year, none this year', color: 'var(--color-warning)', lfy: true, test: p => p.tp_lfy >= 1 && p.tp_cfy === 0 },
  { key: 'tp5', title: 'TP drop (≥5 LFY, <5 CFY)', desc: 'Below 5 TP vs last year', color: 'var(--color-warning)', lfy: true, test: p => p.tp_lfy >= 5 && p.tp_cfy < 5 },
  { key: 'tp10', title: 'TP drop (>10 LFY, <10 CFY)', desc: 'Below 10 TP vs last year', color: 'var(--color-warning)', lfy: true, test: p => p.tp_lfy > 10 && p.tp_cfy < 10 },
];

export default async function crmOppsCoverage(container) {
  const org = getOrg();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><button class="btn btn-ghost btn-sm" id="back">← Coverage</button></div>
    <div class="page-header">
      <h1 class="page-title">Opportunities</h1>
      <p class="page-subtitle">Target lists from coverage vs activation — who to push for TP, TSS and revival.</p>
    </div>
    <div id="op-cards" class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:var(--space-3);margin-bottom:var(--space-6)">${loadingSkeleton(4)}</div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <span class="card-title">District TP coverage</span>
        <input type="text" class="form-input" id="op-dsearch" placeholder="Search district..." style="max-width:220px;height:32px">
      </div>
      <div id="op-district">${loadingSkeleton(6)}</div>
    </div>
  `;
  container.querySelector('#back').addEventListener('click', () => navigate('crm/coverage'));

  const [{ data: rows, error }, users] = await Promise.all([
    sb.rpc('crm_partner_activity'),
    fetchOrgUsers(),
  ]);
  if (error) { container.querySelector('#op-cards').innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">Could not load opportunities.</div></div>`; return; }
  const data = rows || [];
  const lfyPresent = data.some(p => p.any_lfy > 0 || p.tp_lfy > 0 || p.tss_lfy > 0);

  // cards
  container.querySelector('#op-cards').innerHTML = OPPS.map(o => {
    const list = data.filter(o.test);
    const dim = o.lfy && !lfyPresent;
    return `<div class="card op-card" data-opp="${o.key}" style="cursor:${dim ? 'default' : 'pointer'};opacity:${dim ? .55 : 1};border-left:3px solid ${o.color}">
      <div class="card-body">
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold)">${dim ? '—' : list.length.toLocaleString('en-IN')}</div>
        <div style="font-weight:var(--font-weight-medium);margin-top:var(--space-1)">${esc(o.title)}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(o.desc)}</div>
        ${dim ? `<div style="font-size:var(--text-xs);color:var(--color-warning);margin-top:var(--space-2)">Awaiting last-year upload</div>` : ''}
      </div>
    </div>`;
  }).join('');
  container.querySelectorAll('.op-card').forEach(c => c.addEventListener('click', () => {
    const o = OPPS.find(x => x.key === c.dataset.opp);
    if (o.lfy && !lfyPresent) return;
    showList(o, data.filter(o.test));
  }));

  // district TP coverage
  const dmap = new Map();
  data.forEach(p => {
    const d = p.district_new || '(none)';
    if (!dmap.has(d)) dmap.set(d, { total: 0, tp: 0 });
    const e = dmap.get(d); e.total++; if (p.tp_cfy > 0) e.tp++;
  });
  let districts = [...dmap.entries()].map(([d, e]) => ({ d, ...e, cov: pct(e.tp, e.total) })).sort((a, b) => b.total - a.total);

  function renderDistricts(filter = '') {
    const el = container.querySelector('#op-district');
    const list = districts.filter(x => !filter || x.d.toLowerCase().includes(filter));
    if (!list.length) { el.innerHTML = `<div class="empty-state" style="padding:var(--space-5)"><div class="empty-state-desc">No districts.</div></div>`; return; }
    el.innerHTML = `<div class="table-wrap" style="max-height:60vh;overflow:auto"><table class="table">
      <thead><tr><th>District (New)</th><th style="text-align:right">Partners</th><th style="text-align:right">Did TP</th><th style="text-align:right">TP coverage</th></tr></thead>
      <tbody>${list.map(x => `<tr>
        <td style="font-weight:var(--font-weight-medium)">${esc(x.d)}</td>
        <td style="text-align:right">${x.total.toLocaleString('en-IN')}</td>
        <td style="text-align:right">${x.tp.toLocaleString('en-IN')}</td>
        <td style="text-align:right"><span style="color:${x.cov >= 40 ? 'var(--color-success)' : x.cov >= 15 ? 'var(--color-warning)' : 'var(--color-error)'};font-weight:var(--font-weight-semibold)">${x.cov}%</span></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }
  renderDistricts();
  container.querySelector('#op-dsearch').addEventListener('input', (e) => renderDistricts(e.target.value.toLowerCase().trim()));

  function showList(o, list) {
    const body = document.createElement('div');
    if (!list.length) { body.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">None 🎉</div></div>`; openModal(o.title, body); return; }
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)"><strong>${list.length.toLocaleString('en-IN')}</strong> partners · ${esc(o.desc)}</div>
        <button class="btn btn-secondary btn-sm" id="op-export">Export</button>
      </div>
      <div class="table-wrap" style="max-height:58vh;overflow:auto"><table class="table">
        <thead><tr><th>Site ID</th><th>Partner</th><th>District</th><th>Region</th><th>Owner</th><th style="text-align:right">TP L/C</th><th style="text-align:right">TSS L/C</th></tr></thead>
        <tbody>${list.slice(0, 500).map(p => `<tr>
          <td style="font-family:var(--font-mono);font-size:var(--text-sm)">${p.external_id ? esc(p.external_id) : '—'}</td>
          <td><a data-acc="${p.account_id}" style="color:var(--color-accent);cursor:pointer">${esc(p.name)}</a></td>
          <td>${p.district_new ? esc(p.district_new) : '—'}</td>
          <td>${p.region ? esc(p.region) : '—'}</td>
          <td>${esc(ownerName(users, p.owner_id))}</td>
          <td style="text-align:right">${p.tp_lfy}/${p.tp_cfy}</td>
          <td style="text-align:right">${p.tss_lfy}/${p.tss_cfy}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${list.length > 500 ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-2)">Showing first 500 — export for the full list.</div>` : ''}`;
    body.querySelector('#op-export').addEventListener('click', () =>
      downloadCsv(`opp_${o.key}.csv`, list.map(p => ({
        'Site ID': p.external_id || '', Partner: p.name, District: p.district_new || '', Region: p.region || '',
        Owner: ownerName(users, p.owner_id), 'TP LFY': p.tp_lfy, 'TP CFY': p.tp_cfy, 'TSS LFY': p.tss_lfy, 'TSS CFY': p.tss_cfy,
      }))));
    body.querySelectorAll('[data-acc]').forEach(el => el.addEventListener('click', () => { closeModal(); navigate(`crm/account?id=${el.dataset.acc}`); }));
    openModal(o.title, body);
  }
}
