import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';

// CRM › Sales. RTcompu's real revenue picture, read from the imported Tally
// activation reports (crm_report_rows) via the crm_sales_by RPC under anon+RLS.
// Slice by region / tier / district / hub across product categories
// (TSS, TP, TPCloud, WABA, Other) over a financial-year window.

// Indian money: ₹84.9L, ₹1.2Cr — far more readable than raw rupees here.
function inr(n) {
  n = Number(n) || 0;
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + 'Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + 'L';
  if (n >= 1e3) return '₹' + Math.round(n / 1e3) + 'K';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
const num = (n) => n == null ? '—' : Math.round(Number(n)).toLocaleString('en-IN');
const pct = (a, b) => !b ? 0 : Math.round((a / b) * 100);

// Dimensions map to the RPC's p_dim; FY windows bound activation dates.
const DIMS = [
  { key: 'region', label: 'Region' },
  { key: 'role', label: 'Tier' },
  { key: 'district', label: 'District' },
  { key: 'hub', label: 'Hub' },
];
const WINDOWS = [
  { key: 'fy2627', label: 'FY26-27', from: '2026-04-01', to: '2027-03-31' },
  { key: 'fy2526', label: 'FY25-26', from: '2025-04-01', to: '2026-03-31' },
  { key: 'all', label: 'All', from: '', to: '' },
];
// Product categories, in display order, each with a design-token color.
const CATS = [
  { key: 'TSS', color: 'var(--color-accent)' },
  { key: 'TP', color: 'var(--color-success)' },
  { key: 'TPCA', color: 'var(--color-warning)' },
  { key: 'WABA', color: '#8b5cf6' },
  { key: 'Other', color: 'var(--color-text-tertiary)' },
];
const catColor = (k) => (CATS.find(c => c.key === k) || {}).color || 'var(--color-text-tertiary)';

export default async function crmSales(container) {
  const org = getOrg();
  let dim = 'region';
  let win = 'fy2627';

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title" style="margin:0">Sales</h1>
        <p class="page-subtitle" style="margin:0">${esc(org?.name || 'Region')} · revenue & activations from the Tally reports</p>
      </div>
      <a href="#/crm" class="btn btn-secondary">← CRM</a>
    </div>
    <div id="sales-controls"></div>
    <div id="sales-body"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
  `;

  if (!org) { document.getElementById('sales-body').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  const controls = document.getElementById('sales-controls');
  const body = document.getElementById('sales-body');

  function paintControls() {
    const seg = (items, active, name) => items.map(it => `
      <button class="btn btn-sm ${it.key === active ? 'btn-primary' : 'btn-secondary'}" data-${name}="${it.key}">${esc(it.label)}</button>
    `).join('');
    controls.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-4)">
        <div style="display:flex;gap:var(--space-1);flex-wrap:wrap">${seg(DIMS, dim, 'dim')}</div>
        <div style="display:flex;gap:var(--space-1);flex-wrap:wrap">${seg(WINDOWS, win, 'win')}</div>
      </div>`;
    controls.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => { dim = b.dataset.dim; paintControls(); load(); }));
    controls.querySelectorAll('[data-win]').forEach(b => b.addEventListener('click', () => { win = b.dataset.win; paintControls(); load(); }));
  }

  async function load() {
    body.innerHTML = `<div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>`;
    const w = WINDOWS.find(x => x.key === win);
    const { data, error } = await sb.rpc('crm_sales_by', { p_dim: dim, p_from: w.from, p_to: w.to });
    if (error) {
      body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">Couldn't load sales</div><div class="empty-state-desc">${esc(error.message)}</div></div>`;
      toast('Sales: ' + error.message);
      return;
    }
    paint(data || []);
  }

  function paint(rows) {
    if (!rows.length) {
      body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">No sales in this window</div><div class="empty-state-desc">Try a different financial year.</div></div>`;
      return;
    }

    // Roll up: totals, per-category, per-channel, and per-bucket breakdowns.
    let totRev = 0, totUnits = 0;
    const byCat = {};      // category -> revenue
    const byChan = {};     // channel -> revenue
    const buckets = {};    // bucket -> { rev, units, cats: {cat: rev} }
    for (const r of rows) {
      const rev = Number(r.revenue) || 0, units = Number(r.sales_count) || 0;
      totRev += rev; totUnits += units;
      byCat[r.category] = (byCat[r.category] || 0) + rev;
      byChan[r.channel] = (byChan[r.channel] || 0) + rev;
      const b = buckets[r.bucket] || (buckets[r.bucket] = { rev: 0, units: 0, cats: {} });
      b.rev += rev; b.units += units;
      b.cats[r.category] = (b.cats[r.category] || 0) + rev;
    }
    const tss = byCat['TSS'] || 0, tp = byCat['TP'] || 0;
    const rtc = byChan['RTcompu'] || 0, online = byChan['Online'] || 0;
    const bucketRows = Object.entries(buckets).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.rev - a.rev);
    const maxRev = bucketRows[0]?.rev || 1;

    const kpi = (label, value, sub) => `
      <div class="card"><div class="card-body">
        <div class="u-sm-muted" style="margin-bottom:var(--space-1)">${esc(label)}</div>
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold)">${value}</div>
        ${sub ? `<div class="u-meta" style="margin-top:var(--space-1)">${sub}</div>` : ''}
      </div></div>`;

    // Stacked category bar for one bucket.
    const stack = (cats, rev) => {
      const segs = CATS.filter(c => cats[c.key]).map(c =>
        `<div style="width:${pct(cats[c.key], rev)}%;background:${c.color}" title="${esc(c.key)}: ${inr(cats[c.key])}"></div>`).join('');
      return `<div style="display:flex;height:8px;border-radius:var(--radius-full);overflow:hidden;background:var(--color-bg-secondary)">${segs}</div>`;
    };

    body.innerHTML = `
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-bottom:var(--space-4)">
        ${kpi('Revenue', inr(totRev), num(totUnits) + ' activations')}
        ${kpi('TSS renewals', inr(tss), pct(tss, totRev) + '% of revenue')}
        ${kpi('New licenses (TP)', inr(tp), pct(tp, totRev) + '% of revenue')}
        ${kpi('Channel', inr(rtc), 'RTcompu · ' + pct(rtc, totRev) + '% (Online ' + inr(online) + ')')}
      </div>

      <div class="card" style="margin-bottom:var(--space-4)"><div class="card-body">
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center">
          ${CATS.filter(c => byCat[c.key]).map(c => `
            <div style="display:flex;align-items:center;gap:var(--space-1)">
              <span style="width:10px;height:10px;border-radius:2px;background:${c.color};display:inline-block"></span>
              <span class="u-sm-muted">${esc(c.key)}</span>
              <strong>${inr(byCat[c.key])}</strong>
            </div>`).join('')}
        </div>
      </div></div>

      <div class="card"><div class="card-header" style="font-weight:var(--font-weight-semibold)">By ${esc(DIMS.find(d => d.key === dim).label)}</div>
        <div class="card-body u-stack-4">
          ${bucketRows.map(b => `
            <div>
              <div style="display:flex;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-1)">
                <span style="font-weight:var(--font-weight-medium)">${esc(b.name)}</span>
                <span><strong>${inr(b.rev)}</strong> <span class="u-sm-muted">· ${num(b.units)} act.</span></span>
              </div>
              <div style="display:flex;align-items:center;gap:var(--space-2)">
                <div style="flex:1">${stack(b.cats, b.rev)}</div>
                <span class="u-meta" style="width:44px;text-align:right">${pct(b.rev, maxRev)}%</span>
              </div>
            </div>`).join('')}
        </div>
      </div>
    `;
  }

  paintControls();
  await load();
}
