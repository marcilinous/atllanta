import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, downloadCsv, loadingSkeleton } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { canManageData } from './common.js';

const DIMS = [
  { key: 'region', label: 'Region' },
  { key: 'role', label: 'Role' },
  { key: 'district', label: 'District New' },
  { key: 'hub', label: 'Hub' },
];
const CHANNELS = ['RTcompu', 'Kerala', 'Online', 'All'];
const CATS = ['TSS', 'TP', 'TPCA', 'WABA', 'Other'];

const inr = (n) => {
  n = Math.round(n || 0);
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
  return '₹' + n.toLocaleString('en-IN');
};
const num = (n) => Math.round(n || 0).toLocaleString('en-IN');

export default async function crmSales(container) {
  const org = getOrg();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  let dim = 'region';
  let channel = 'RTcompu';
  let metric = 'revenue'; // or 'count'
  let from = '';
  let to = '';
  const cache = {};

  const isoLocal = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  function applyPreset(p) {
    const d = new Date(), today = isoLocal(d);
    if (p === 'all') { from = ''; to = ''; }
    else if (p === 'mtd') { from = isoLocal(new Date(d.getFullYear(), d.getMonth(), 1)); to = today; }
    else if (p === '30d') { const s = new Date(d); s.setDate(s.getDate() - 29); from = isoLocal(s); to = today; }
    else if (p === 'qtd') { const q = Math.floor(d.getMonth() / 3) * 3; from = isoLocal(new Date(d.getFullYear(), q, 1)); to = today; }
    else if (p === 'fytd') { const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; from = isoLocal(new Date(y, 3, 1)); to = today; }
    container.querySelector('#sl-from').value = from;
    container.querySelector('#sl-to').value = to;
  }

  container.innerHTML = `
    <style>
      .tab-label{font-size:var(--text-xs);color:var(--color-text-secondary);margin-bottom:var(--space-1)}
      #sl-kpi .kpi-l{font-size:var(--text-xs);color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.04em}
      #sl-kpi .kpi-v{font-size:var(--text-2xl);font-weight:var(--font-weight-bold)}
    </style>
    <div style="margin-bottom:var(--space-4)"><button class="btn btn-ghost btn-sm" id="back">← CRM</button></div>
    <div class="page-header">
      <h1 class="page-title">Sales</h1>
      <p class="page-subtitle">FY-to-date activations — revenue and sale count by product, channel and territory.</p>
    </div>
    <div class="card" style="margin-bottom:var(--space-4)"><div class="card-body" style="display:flex;flex-wrap:wrap;gap:var(--space-4);align-items:center">
      <div><div class="tab-label">Channel</div><div class="tabs" id="sl-channel">${CHANNELS.map(c => `<button class="tab${c === channel ? ' active' : ''}" data-ch="${c}">${c}</button>`).join('')}</div></div>
      <div><div class="tab-label">Break down by</div><div class="tabs" id="sl-dim">${DIMS.map(d => `<button class="tab${d.key === dim ? ' active' : ''}" data-dim="${d.key}">${d.label}</button>`).join('')}</div></div>
      <div><div class="tab-label">Show</div><div class="tabs" id="sl-metric">
        <button class="tab active" data-metric="revenue">Revenue</button>
        <button class="tab" data-metric="count">Sale count</button>
      </div></div>
      <div><div class="tab-label">Period</div><div class="tabs" id="sl-preset">
        <button class="tab" data-preset="mtd">Month</button>
        <button class="tab" data-preset="30d">30d</button>
        <button class="tab" data-preset="qtd">Quarter</button>
        <button class="tab active" data-preset="fytd">FY</button>
        <button class="tab" data-preset="all">All</button>
      </div></div>
      <div style="display:flex;gap:var(--space-2)">
        <div><div class="tab-label">From</div><input type="date" class="form-input" id="sl-from" style="height:34px"></div>
        <div><div class="tab-label">To</div><input type="date" class="form-input" id="sl-to" style="height:34px"></div>
      </div>
      ${canManageData() ? `<div style="margin-left:auto"><button class="btn btn-secondary btn-sm" id="sl-export">Export</button></div>` : ''}
    </div></div>
    <div id="sl-kpi" class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3);margin-bottom:var(--space-5)"></div>
    <div class="card"><div id="sl-table">${loadingSkeleton(6)}</div></div>
  `;
  container.querySelector('#back').addEventListener('click', () => navigate('crm'));

  async function rows() {
    const key = `${dim}|${from}|${to}`;
    if (!cache[key]) {
      const { data, error } = await sb.rpc('crm_sales_by', { p_dim: dim, p_from: from, p_to: to });
      if (error) { toast('Could not load sales'); return []; }
      cache[key] = (data || []).map(r => ({ ...r, sales_count: +r.sales_count, revenue: +r.revenue }));
    }
    return cache[key];
  }

  function pivot(data) {
    // bucket -> {cat -> value}, filtered by channel
    const buckets = new Map();
    const catTotals = Object.fromEntries(CATS.map(c => [c, 0]));
    let grand = 0;
    for (const r of data) {
      if (channel !== 'All' && r.channel !== channel) continue;
      const val = metric === 'revenue' ? r.revenue : r.sales_count;
      if (!buckets.has(r.bucket)) buckets.set(r.bucket, Object.fromEntries(CATS.map(c => [c, 0])));
      const row = buckets.get(r.bucket);
      const cat = CATS.includes(r.category) ? r.category : 'Other';
      row[cat] += val; catTotals[cat] += val; grand += val;
    }
    const list = [...buckets.entries()].map(([b, cats]) => ({ bucket: b, cats, total: CATS.reduce((s, c) => s + cats[c], 0) }));
    list.sort((a, b) => b.total - a.total);
    return { list, catTotals, grand };
  }

  async function render() {
    const data = await rows();
    const { list, catTotals, grand } = pivot(data);
    const fmt = metric === 'revenue' ? inr : num;

    container.querySelector('#sl-kpi').innerHTML =
      `<div class="card"><div class="card-body"><div class="kpi-l">${channel} total</div><div class="kpi-v">${fmt(grand)}</div></div></div>` +
      CATS.map(c => `<div class="card"><div class="card-body"><div class="kpi-l">${c}</div><div class="kpi-v" style="font-size:var(--text-xl)">${fmt(catTotals[c])}</div><div class="kpi-l">${grand ? Math.round(100 * catTotals[c] / grand) : 0}%</div></div></div>`).join('');

    const el = container.querySelector('#sl-table');
    if (!list.length) { el.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-desc">No sales in this channel. Upload the Activation report if you haven't.</div></div>`; return; }
    const dimLabel = DIMS.find(d => d.key === dim).label;
    el.innerHTML = `<div class="table-wrap" style="max-height:64vh;overflow:auto"><table class="table">
      <thead><tr><th>${esc(dimLabel)}</th>${CATS.map(c => `<th style="text-align:right">${c}</th>`).join('')}<th style="text-align:right;font-weight:var(--font-weight-bold)">Total</th></tr></thead>
      <tbody>${list.map(r => `<tr>
        <td style="font-weight:var(--font-weight-medium)">${esc(r.bucket)}</td>
        ${CATS.map(c => `<td style="text-align:right;color:${r.cats[c] ? 'inherit' : 'var(--color-text-tertiary)'}">${r.cats[c] ? fmt(r.cats[c]) : '—'}</td>`).join('')}
        <td style="text-align:right;font-weight:var(--font-weight-semibold)">${fmt(r.total)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr style="border-top:2px solid var(--color-border)">
        <td style="font-weight:var(--font-weight-bold)">Total</td>
        ${CATS.map(c => `<td style="text-align:right;font-weight:var(--font-weight-semibold)">${fmt(catTotals[c])}</td>`).join('')}
        <td style="text-align:right;font-weight:var(--font-weight-bold)">${fmt(grand)}</td>
      </tr></tfoot>
    </table></div>`;
  }

  container.querySelector('#sl-channel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch]'); if (!b) return;
    channel = b.dataset.ch;
    container.querySelectorAll('#sl-channel .tab').forEach(t => t.classList.toggle('active', t === b));
    render();
  });
  container.querySelector('#sl-dim').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dim]'); if (!b) return;
    dim = b.dataset.dim;
    container.querySelectorAll('#sl-dim .tab').forEach(t => t.classList.toggle('active', t === b));
    render();
  });
  container.querySelector('#sl-metric').addEventListener('click', (e) => {
    const b = e.target.closest('[data-metric]'); if (!b) return;
    metric = b.dataset.metric;
    container.querySelectorAll('#sl-metric .tab').forEach(t => t.classList.toggle('active', t === b));
    render();
  });
  container.querySelector('#sl-preset').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    applyPreset(b.dataset.preset);
    container.querySelectorAll('#sl-preset .tab').forEach(t => t.classList.toggle('active', t === b));
    render();
  });
  const onDate = () => {
    from = container.querySelector('#sl-from').value || '';
    to = container.querySelector('#sl-to').value || '';
    container.querySelectorAll('#sl-preset .tab').forEach(t => t.classList.remove('active'));
    render();
  };
  container.querySelector('#sl-from').addEventListener('change', onDate);
  container.querySelector('#sl-to').addEventListener('change', onDate);
  container.querySelector('#sl-export')?.addEventListener('click', async () => {
    const { list } = pivot(await rows());
    const dimLabel = DIMS.find(d => d.key === dim).label;
    downloadCsv(`sales_${dim}_${channel}_${metric}.csv`,
      list.map(r => ({ [dimLabel]: r.bucket, ...Object.fromEntries(CATS.map(c => [c, Math.round(r.cats[c])])), Total: Math.round(r.total) })));
  });

  applyPreset('fytd'); // default to current FY so newly-loaded LFY data doesn't inflate the headline
  await render();
}
