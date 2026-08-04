import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, openModal, closeModal, downloadCsv, loadingSkeleton } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { ownerName, canManageData } from './common.js';

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
      <p class="page-subtitle">Target lists that drive business — overall, and rolled up CM → TL → BDE.</p>
    </div>
    <div id="op-cards" class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:var(--space-3);margin-bottom:var(--space-6)">${loadingSkeleton(4)}</div>
    <div class="card" style="margin-bottom:var(--space-6)">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <span class="card-title">By team (CM → TL → BDE)</span>
        <select class="form-input" id="op-opp" style="max-width:260px;height:34px"></select>
      </div>
      <div id="op-tree">${loadingSkeleton(6)}</div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <span class="card-title">District TP coverage</span>
        <input type="text" class="form-input" id="op-dsearch" placeholder="Search district..." style="max-width:220px;height:32px">
      </div>
      <div id="op-district">${loadingSkeleton(6)}</div>
    </div>
  `;
  container.querySelector('#back').addEventListener('click', () => navigate('crm/coverage'));

  const [{ data: rows, error }, { data: users }] = await Promise.all([
    sb.rpc('crm_partner_activity'),
    sb.from('users').select('id, full_name, designation, reporting_manager_id').eq('status', 'active'),
  ]);
  if (error) { container.querySelector('#op-cards').innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">Could not load opportunities.</div></div>`; return; }
  const data = rows || [];
  const staff = users || [];
  const lfyPresent = data.some(p => p.any_lfy > 0 || p.tp_lfy > 0 || p.tss_lfy > 0);

  // ---- cards (overall) ----
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
    oppSel.value = o.key; renderTree();          // sync the team breakdown
    showList(o, data.filter(o.test), o.title);
  }));

  // ---- hierarchy ----
  const byId = new Map(staff.map(u => [u.id, u]));
  const kids = new Map();
  staff.forEach(u => {
    const p = (u.reporting_manager_id && byId.has(u.reporting_manager_id)) ? u.reporting_manager_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(u);
  });
  const roots = kids.get(null) || [];
  const subtree = new Map();
  (function build() {
    function collect(u) {
      const s = new Set([u.id]);
      (kids.get(u.id) || []).forEach(c => collect(c).forEach(x => s.add(x)));
      subtree.set(u.id, s);
      return s;
    }
    roots.forEach(collect);
  })();

  const oppSel = container.querySelector('#op-opp');
  oppSel.innerHTML = OPPS.map(o => `<option value="${o.key}"${o.lfy && !lfyPresent ? ' disabled' : ''}>${esc(o.title)}${o.lfy && !lfyPresent ? ' (awaiting LFY)' : ''}</option>`).join('');
  let selectedKey = 'uap';
  oppSel.value = selectedKey;
  oppSel.addEventListener('change', () => { selectedKey = oppSel.value; renderTree(); });

  function renderTree() {
    const opp = OPPS.find(o => o.key === selectedKey) || OPPS[0];
    const ownM = new Map(), ownT = new Map();
    for (const p of data) {
      ownT.set(p.owner_id, (ownT.get(p.owner_id) || 0) + 1);
      if (opp.test(p)) ownM.set(p.owner_id, (ownM.get(p.owner_id) || 0) + 1);
    }
    function agg(u) {
      let m = ownM.get(u.id) || 0, t = ownT.get(u.id) || 0;
      (kids.get(u.id) || []).forEach(c => { const cc = agg(c); m += cc.m; t += cc.t; });
      u._m = m; u._t = t; return { m, t };
    }
    roots.forEach(agg);

    const el = container.querySelector('#op-tree');
    el.innerHTML = '';
    const top = roots.filter(r => r._t > 0).sort((a, b) => b._m - a._m);
    if (!top.length) { el.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">No partners in scope.</div></div>`; return; }

    function renderNode(u, depth, host) {
      if (u._t === 0) return;
      const kidList = (kids.get(u.id) || []).filter(c => c._t > 0).sort((a, b) => b._m - a._m);
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--color-border-light)`;
      row.innerHTML = `
        <div style="flex:1;min-width:200px;display:flex;align-items:center;gap:var(--space-2);padding-left:${depth * 20}px">
          ${kidList.length ? `<span class="op-toggle" style="cursor:pointer;color:var(--color-text-tertiary);width:14px;display:inline-block">▾</span>` : `<span style="width:14px;display:inline-block"></span>`}
          <div><span style="font-weight:var(--font-weight-medium)">${esc(u.full_name || '—')}</span>
            <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(u.designation || '')}</span></div>
        </div>
        <div style="width:120px;text-align:right;font-size:var(--text-sm);color:var(--color-text-secondary)">${u._t.toLocaleString('en-IN')} partners</div>
        <div style="width:130px;text-align:right">
          <a class="op-drill" style="color:var(--color-accent);cursor:${u._m ? 'pointer' : 'default'};font-weight:var(--font-weight-semibold)">${u._m.toLocaleString('en-IN')}</a>
          <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)"> (${pct(u._m, u._t)}%)</span>
        </div>`;
      host.appendChild(row);
      const childHost = document.createElement('div');
      host.appendChild(childHost);
      kidList.forEach(c => renderNode(c, depth + 1, childHost));
      const toggle = row.querySelector('.op-toggle');
      if (toggle) toggle.addEventListener('click', () => {
        const hidden = childHost.style.display === 'none';
        childHost.style.display = hidden ? '' : 'none';
        toggle.textContent = hidden ? '▾' : '▸';
      });
      if (u._m) row.querySelector('.op-drill').addEventListener('click', () => {
        const s = subtree.get(u.id) || new Set([u.id]);
        showList(opp, data.filter(p => s.has(p.owner_id) && opp.test(p)), `${opp.title} — ${u.full_name || ''}`);
      });
    }
    top.forEach(r => renderNode(r, 0, el));
  }
  renderTree();

  // ---- district TP coverage ----
  const dmap = new Map();
  data.forEach(p => {
    const d = p.district_new || '(none)';
    if (!dmap.has(d)) dmap.set(d, { total: 0, tp: 0 });
    const e = dmap.get(d); e.total++; if (p.tp_cfy > 0) e.tp++;
  });
  const districts = [...dmap.entries()].map(([d, e]) => ({ d, ...e, cov: pct(e.tp, e.total) })).sort((a, b) => b.total - a.total);
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

  // ---- partner list modal (export TL+) ----
  function showList(o, list, title) {
    const body = document.createElement('div');
    if (!list.length) { body.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">None 🎉</div></div>`; openModal(title || o.title, body); return; }
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)"><strong>${list.length.toLocaleString('en-IN')}</strong> partners · ${esc(o.desc)}</div>
        ${canManageData() ? `<button class="btn btn-secondary btn-sm" id="op-export">Export</button>` : ''}
      </div>
      <div class="table-wrap" style="max-height:58vh;overflow:auto"><table class="table">
        <thead><tr><th>Site ID</th><th>Partner</th><th>District</th><th>Region</th><th>Owner</th><th style="text-align:right">TP L/C</th><th style="text-align:right">TSS L/C</th></tr></thead>
        <tbody>${list.slice(0, 500).map(p => `<tr>
          <td style="font-family:var(--font-mono);font-size:var(--text-sm)">${p.external_id ? esc(p.external_id) : '—'}</td>
          <td><a data-acc="${p.account_id}" style="color:var(--color-accent);cursor:pointer">${esc(p.name)}</a></td>
          <td>${p.district_new ? esc(p.district_new) : '—'}</td>
          <td>${p.region ? esc(p.region) : '—'}</td>
          <td>${esc(ownerName(staff, p.owner_id))}</td>
          <td style="text-align:right">${p.tp_lfy}/${p.tp_cfy}</td>
          <td style="text-align:right">${p.tss_lfy}/${p.tss_cfy}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${list.length > 500 ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-2)">Showing first 500${canManageData() ? ' — export for the full list' : ''}.</div>` : ''}`;
    body.querySelector('#op-export')?.addEventListener('click', () =>
      downloadCsv(`opp_${o.key}.csv`, list.map(p => ({
        'Site ID': p.external_id || '', Partner: p.name, District: p.district_new || '', Region: p.region || '',
        Owner: ownerName(staff, p.owner_id), 'TP LFY': p.tp_lfy, 'TP CFY': p.tp_cfy, 'TSS LFY': p.tss_lfy, 'TSS CFY': p.tss_cfy,
      }))));
    body.querySelectorAll('[data-acc]').forEach(el => el.addEventListener('click', () => { closeModal(); navigate(`crm/account?id=${el.dataset.acc}`); }));
    openModal(title || o.title, body);
  }
}
