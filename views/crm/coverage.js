import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, downloadCsv, loadingSkeleton } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { canManageData } from './common.js';

const ZERO = { total: 0, called: 0, visited: 0, sold: 0, touched: 0 };
const pct = (n, d) => d ? Math.round((100 * n) / d) : 0;

export default async function crmCoverage(container) {
  const org = getOrg();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><button class="btn btn-ghost btn-sm" id="back">← CRM</button></div>
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Coverage</h1>
        <p class="page-subtitle">Who in your partner base is being called, visited and sold to — and who's untouched — by territory.</p>
      </div>
      <button class="btn btn-primary" id="to-opps">Opportunities →</button>
    </div>
    <div id="cov-kpi" class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--space-3);margin-bottom:var(--space-6)"></div>
    <div class="card">
      <div class="card-header"><span class="card-title">By territory (CM → TL → BDE)</span></div>
      <div id="cov-tree">${loadingSkeleton(6)}</div>
    </div>
  `;
  container.querySelector('#back').addEventListener('click', () => navigate('crm'));
  container.querySelector('#to-opps').addEventListener('click', () => navigate('crm/opps'));

  const [{ data: users }, { data: cov, error }] = await Promise.all([
    sb.from('users').select('id, full_name, designation, reporting_manager_id').eq('status', 'active'),
    sb.rpc('crm_coverage'),
  ]);
  if (error) { container.querySelector('#cov-tree').innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">Could not load coverage.</div></div>`; return; }

  const covMap = new Map();
  (cov || []).forEach(r => covMap.set(r.owner_id, {
    total: +r.total, called: +r.called, visited: +r.visited, sold: +r.sold, touched: +r.touched,
  }));

  // Overall KPIs = sum across owners (each partner counted once by its owner).
  const overall = { ...ZERO };
  covMap.forEach(v => { for (const k in overall) overall[k] += v[k]; });
  const untouched = overall.total - overall.touched;

  const kpi = (label, val, sub, color) => `
    <div class="card"><div class="card-body">
      <div style="font-size:var(--text-xs);color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.04em">${label}</div>
      <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:${color || 'var(--color-text-primary)'}">${val}</div>
      ${sub ? `<div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${sub}</div>` : ''}
    </div></div>`;
  container.querySelector('#cov-kpi').innerHTML =
    kpi('Partners', overall.total.toLocaleString('en-IN'), 'in your scope') +
    kpi('Covered', `${pct(overall.touched, overall.total)}%`, `${overall.touched.toLocaleString('en-IN')} touched`, 'var(--color-success)') +
    kpi('Untouched', untouched.toLocaleString('en-IN'), 'no call / visit / sale', 'var(--color-error)') +
    kpi('Called', `${pct(overall.called, overall.total)}%`, overall.called.toLocaleString('en-IN')) +
    kpi('Visited', `${pct(overall.visited, overall.total)}%`, overall.visited.toLocaleString('en-IN')) +
    kpi('Sold', `${pct(overall.sold, overall.total)}%`, overall.sold.toLocaleString('en-IN'));

  // Build the reporting tree and roll coverage up.
  const byId = new Map(users.map(u => [u.id, u]));
  const kids = new Map();
  users.forEach(u => {
    const p = (u.reporting_manager_id && byId.has(u.reporting_manager_id)) ? u.reporting_manager_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(u);
  });
  function agg(u) {
    const own = covMap.get(u.id) || ZERO;
    const sum = { ...own };
    (kids.get(u.id) || []).forEach(c => { const cs = agg(c); for (const k in sum) sum[k] += cs[k]; });
    u._own = own; u._agg = sum;
    return sum;
  }
  const roots = (kids.get(null) || []);
  roots.forEach(agg);

  const bar = (touched, total) => {
    const p = pct(touched, total);
    const c = p >= 66 ? 'var(--color-success)' : p >= 33 ? 'var(--color-warning)' : 'var(--color-error)';
    return `<div style="height:6px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);overflow:hidden;min-width:80px">
      <div style="height:100%;width:${p}%;background:${c}"></div></div>`;
  };

  const treeEl = container.querySelector('#cov-tree');
  treeEl.innerHTML = '';
  if (!roots.length || !overall.total) {
    treeEl.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">No partners in scope yet.</div></div>`;
    return;
  }

  function renderNode(u, depth, host) {
    const a = u._agg, own = u._own;
    const kidList = (kids.get(u.id) || []).filter(c => c._agg.total > 0).sort((x, y) => y._agg.total - x._agg.total);
    if (a.total === 0) return;
    const untouchedN = a.total - a.touched;
    const row = document.createElement('div');
    row.className = 'cov-row';
    row.style.cssText = `display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--color-border-light)`;
    row.innerHTML = `
      <div style="flex:1;min-width:200px;display:flex;align-items:center;gap:var(--space-2);padding-left:${depth * 20}px">
        ${kidList.length ? `<span class="cov-toggle" style="cursor:pointer;color:var(--color-text-tertiary);width:14px;display:inline-block">▾</span>` : `<span style="width:14px;display:inline-block"></span>`}
        <div>
          <span style="font-weight:var(--font-weight-medium)">${esc(u.full_name || '—')}</span>
          <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(u.designation || '')}</span>
        </div>
      </div>
      <div style="width:110px;text-align:right;font-size:var(--text-sm)">${a.total.toLocaleString('en-IN')} partners</div>
      <div style="display:flex;align-items:center;gap:var(--space-2);width:150px">${bar(a.touched, a.total)}<span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${pct(a.touched, a.total)}%</span></div>
      <div style="width:230px;text-align:right;font-size:var(--text-xs);color:var(--color-text-secondary)">
        📞 ${a.called.toLocaleString('en-IN')} · 🚗 ${a.visited.toLocaleString('en-IN')} · 💰 ${a.sold.toLocaleString('en-IN')}
      </div>
      <div style="width:120px;text-align:right">
        ${own.total ? `<a class="cov-untouched" data-owner="${u.id}" data-name="${esc(u.full_name || '')}" style="color:${untouchedN ? 'var(--color-error)' : 'var(--color-text-tertiary)'};cursor:pointer;font-size:var(--text-sm)">${(own.total - own.touched).toLocaleString('en-IN')} own untouched</a>` : ''}
      </div>`;
    host.appendChild(row);
    const childHost = document.createElement('div');
    childHost.className = 'cov-children';
    host.appendChild(childHost);
    kidList.forEach(c => renderNode(c, depth + 1, childHost));
    const toggle = row.querySelector('.cov-toggle');
    if (toggle) toggle.addEventListener('click', () => {
      const hidden = childHost.style.display === 'none';
      childHost.style.display = hidden ? '' : 'none';
      toggle.textContent = hidden ? '▾' : '▸';
    });
    row.querySelector('.cov-untouched')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showUncovered(u.id, u.full_name);
    });
  }
  roots.sort((x, y) => y._agg.total - x._agg.total).forEach(r => renderNode(r, 0, treeEl));

  async function showUncovered(ownerId, ownerName) {
    const body = document.createElement('div');
    body.innerHTML = loadingSkeleton(4);
    openModal(`Untouched partners — ${ownerName || ''}`, body);
    const { data } = await sb.rpc('crm_uncovered_partners', { p_owner: ownerId });
    const list = data || [];
    if (!list.length) { body.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">All covered 🎉</div><div class="empty-state-desc">Every partner they own has had a call, visit or sale.</div></div>`; return; }
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)"><strong>${list.length.toLocaleString('en-IN')}</strong> partners with no activity this period</div>
        ${canManageData() ? `<button class="btn btn-secondary btn-sm" id="cov-export">Export</button>` : ''}
      </div>
      <div class="table-wrap" style="max-height:56vh;overflow:auto"><table class="table">
        <thead><tr><th>Site ID</th><th>Partner</th><th>City</th><th>State</th></tr></thead>
        <tbody>${list.map(a => `<tr>
          <td style="font-family:var(--font-mono);font-size:var(--text-sm)">${a.external_id ? esc(a.external_id) : '—'}</td>
          <td><a data-acc="${a.id}" style="color:var(--color-accent);cursor:pointer">${esc(a.name)}</a></td>
          <td>${a.billing_city ? esc(a.billing_city) : '—'}</td>
          <td>${a.state ? esc(a.state) : '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    body.querySelector('#cov-export')?.addEventListener('click', () =>
      downloadCsv(`untouched_${(ownerName || 'owner').replace(/[^\w.-]+/g, '_')}.csv`,
        list.map(a => ({ 'Site ID': a.external_id || '', Partner: a.name, City: a.billing_city || '', State: a.state || '' }))));
    body.querySelectorAll('[data-acc]').forEach(el => el.addEventListener('click', () => { closeModal(); navigate(`crm/account?id=${el.dataset.acc}`); }));
  }
}
