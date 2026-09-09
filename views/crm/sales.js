import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, backButton } from '../../js/ui.js';
import { navigate } from '../../js/router.js';

// CRM › Sales. Analytics-only snapshot of the business for a from/to window:
// KPIs, a revenue trend, category mix, and a by-dimension ranking, plus a
// launchpad to the rest of the CRM. Reads crm_sales_by + crm_sales_series (both
// anon+RLS, empty-string-safe). Charts render with Chart.js, lazy-loaded from the
// same CDN the app already uses for ESM (owner-approved for analytics, DESIGN.md).

function inr(n) {
  n = Number(n) || 0;
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + 'Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + 'L';
  if (n >= 1e3) return '₹' + Math.round(n / 1e3) + 'K';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
const num = (n) => n == null ? '—' : Math.round(Number(n)).toLocaleString('en-IN');
const pct = (a, b) => !b ? 0 : Math.round((a / b) * 100);

const DIMS = [
  { key: 'region', label: 'Region' },
  { key: 'role', label: 'Tier' },
  { key: 'district', label: 'District' },
  { key: 'hub', label: 'Hub' },
];
// Concrete colours (Chart.js can't resolve CSS var()); aligned to the tokens.
const CAT_COLOR = { TSS: '#1E3A8A', TP: '#10B981', TPCA: '#F59E0B', WABA: '#8b5cf6', Other: '#94a3b8' };
const CAT_ORDER = ['TSS', 'TP', 'TPCA', 'WABA', 'Other'];

// Launchpad: jump into the rest of the business from the snapshot.
const NAV = [
  { label: 'Distribution', route: 'crm/field-sales', icon: 'M3 3v18h18M18 17V9M13 17V5M8 17v-3' },
  { label: 'Partners', route: 'crm/partners', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8' },
  { label: 'Journey Plan', route: 'crm/pjp', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { label: 'Events', route: 'crm/events', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { label: 'Leads', route: 'crm/leads', icon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3' },
];

const fyStart = (y) => `${y}-04-01`;
const fyEnd = (y) => `${y + 1}-03-31`;
function presets() {
  const now = new Date();
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const iso = (d) => d.toISOString().slice(0, 10);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const d90 = new Date(now.getTime() - 90 * 864e5);
  return [
    { key: 'fy', label: 'This FY', from: fyStart(fy), to: fyEnd(fy) },
    { key: 'pfy', label: 'Last FY', from: fyStart(fy - 1), to: fyEnd(fy - 1) },
    { key: 'mtd', label: 'This month', from: iso(monthStart), to: iso(now) },
    { key: 'd90', label: 'Last 90 days', from: iso(d90), to: iso(now) },
    { key: 'all', label: 'All', from: '', to: '' },
  ];
}

let Chart;
async function ensureChart() {
  if (!Chart) { const m = await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/auto/+esm'); Chart = m.default; }
  return Chart;
}

export default async function crmSales(container) {
  const org = getOrg();
  const P = presets();
  let dim = 'region';
  let from = P[0].from, to = P[0].to, preset = 'fy';
  const charts = {}; // live Chart instances, destroyed before re-render

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title" style="margin:0">Sales</h1>
        <p class="page-subtitle" style="margin:0">${esc(org?.name || 'Region')} · business snapshot for a date range</p>
      </div>
      ${backButton('crm')}
    </div>
    <div id="sales-controls"></div>
    <div id="sales-body"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
  `;
  if (!org) { document.getElementById('sales-body').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  const controls = document.getElementById('sales-controls');
  const body = document.getElementById('sales-body');

  function paintControls() {
    controls.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap;align-items:center;margin-bottom:var(--space-4)">
        <div style="display:flex;gap:var(--space-1);flex-wrap:wrap">
          ${P.map(p => `<button class="btn btn-sm ${preset === p.key ? 'btn-primary' : 'btn-secondary'}" data-preset="${p.key}">${esc(p.label)}</button>`).join('')}
        </div>
        <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
          <input class="form-input" type="date" id="sx-from" value="${esc(from)}" style="max-width:160px">
          <span class="u-sm-muted">to</span>
          <input class="form-input" type="date" id="sx-to" value="${esc(to)}" style="max-width:160px">
        </div>
      </div>`;
    controls.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
      const p = P.find(x => x.key === b.dataset.preset);
      preset = p.key; from = p.from; to = p.to; paintControls(); load();
    }));
    const fEl = controls.querySelector('#sx-from'), tEl = controls.querySelector('#sx-to');
    const custom = () => { from = fEl.value || ''; to = tEl.value || ''; preset = null;
      controls.querySelectorAll('[data-preset]').forEach(b => b.className = 'btn btn-sm btn-secondary'); load(); };
    fEl.addEventListener('change', custom); tEl.addEventListener('change', custom);
  }

  async function load() {
    body.innerHTML = `<div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>`;
    const [byDim, series] = await Promise.all([
      sb.rpc('crm_sales_by', { p_dim: dim, p_from: from, p_to: to }),
      sb.rpc('crm_sales_series', { p_from: from, p_to: to }),
    ]);
    if (byDim.error || series.error) {
      const msg = (byDim.error || series.error).message;
      body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">Couldn't load sales</div><div class="empty-state-desc">${esc(msg)}</div></div>`;
      toast('Sales: ' + msg); return;
    }
    await paint(byDim.data || [], series.data || []);
  }

  async function paint(rows, series) {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch (e) {} });

    // Dimensional roll-up (crm_sales_by).
    let totRev = 0, totUnits = 0;
    const byCat = {}, buckets = {};
    for (const r of rows) {
      const rev = Number(r.revenue) || 0, units = Number(r.sales_count) || 0;
      totRev += rev; totUnits += units;
      byCat[r.category] = (byCat[r.category] || 0) + rev;
      buckets[r.bucket] = (buckets[r.bucket] || 0) + rev;
    }
    const tss = byCat['TSS'] || 0, tp = byCat['TP'] || 0;
    const bucketRows = Object.entries(buckets).map(([name, rev]) => ({ name, rev })).sort((a, b) => b.rev - a.rev).slice(0, 12);

    // Monthly series (crm_sales_series).
    const months = [...new Set(series.map(s => s.month))].sort();
    const monthTotal = {}; months.forEach(m => monthTotal[m] = 0);
    for (const s of series) monthTotal[s.month] += Number(s.revenue) || 0;

    if (!rows.length && !series.length) {
      body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">No sales in this window</div><div class="empty-state-desc">Try a wider date range.</div></div>`;
      return;
    }

    const kpi = (label, value, sub) => `
      <div class="card"><div class="card-body">
        <div class="u-sm-muted" style="margin-bottom:var(--space-1)">${esc(label)}</div>
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold)">${value}</div>
        ${sub ? `<div class="u-meta" style="margin-top:var(--space-1)">${sub}</div>` : ''}
      </div></div>`;

    body.innerHTML = `
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-bottom:var(--space-4)">
        ${kpi('Revenue', inr(totRev), num(totUnits) + ' activations')}
        ${kpi('TSS renewals', inr(tss), pct(tss, totRev) + '% of revenue')}
        ${kpi('New licenses (TP)', inr(tp), pct(tp, totRev) + '% of revenue')}
        ${kpi('Months in range', String(months.length), months.length ? months[0] + ' → ' + months[months.length - 1] : '—')}
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:var(--space-4);margin-bottom:var(--space-4)">
        <div class="card"><div class="card-header" style="font-weight:var(--font-weight-semibold)">Revenue trend</div>
          <div class="card-body"><div style="height:280px"><canvas id="sx-trend"></canvas></div></div></div>
        <div class="card"><div class="card-header" style="font-weight:var(--font-weight-semibold)">Category mix</div>
          <div class="card-body"><div style="height:280px"><canvas id="sx-donut"></canvas></div></div></div>
      </div>

      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2)">
          <span style="font-weight:var(--font-weight-semibold)">By dimension</span>
          <div style="display:flex;gap:var(--space-1);flex-wrap:wrap">
            ${DIMS.map(d => `<button class="btn btn-sm ${dim === d.key ? 'btn-primary' : 'btn-secondary'}" data-dim="${d.key}">${esc(d.label)}</button>`).join('')}
          </div>
        </div>
        <div class="card-body"><div style="height:${Math.max(220, bucketRows.length * 26)}px"><canvas id="sx-dim"></canvas></div></div>
      </div>

      <div class="card"><div class="card-header" style="font-weight:var(--font-weight-semibold)">Navigate the business</div>
        <div class="card-body"><div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          ${NAV.map(n => `<button class="btn btn-secondary" data-route="${n.route}" style="display:flex;gap:var(--space-2);align-items:center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${n.icon}"/></svg>${esc(n.label)}</button>`).join('')}
        </div></div></div>
    `;

    body.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => { dim = b.dataset.dim; load(); }));
    body.querySelectorAll('[data-route]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.route)));

    // Theme-aware axis colours.
    const cs = getComputedStyle(document.documentElement);
    const grid = (cs.getPropertyValue('--color-border') || '#e2e8f0').trim();
    const textc = (cs.getPropertyValue('--color-text-secondary') || '#475569').trim();
    const ChartJs = await ensureChart();
    const moneyTick = (v) => inr(v);

    charts.trend = new ChartJs(body.querySelector('#sx-trend'), {
      type: 'line',
      data: { labels: months, datasets: [{ label: 'Revenue', data: months.map(m => monthTotal[m]),
        borderColor: '#1E3A8A', backgroundColor: 'rgba(30,58,138,0.12)', fill: true, tension: 0.3, pointRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => inr(c.parsed.y) } } },
        scales: { x: { ticks: { color: textc }, grid: { color: grid } },
                  y: { ticks: { color: textc, callback: moneyTick }, grid: { color: grid } } } },
    });

    const cats = CAT_ORDER.filter(c => byCat[c]);
    charts.donut = new ChartJs(body.querySelector('#sx-donut'), {
      type: 'doughnut',
      data: { labels: cats, datasets: [{ data: cats.map(c => byCat[c]), backgroundColor: cats.map(c => CAT_COLOR[c]), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'bottom', labels: { color: textc, boxWidth: 12 } },
          tooltip: { callbacks: { label: (c) => `${c.label}: ${inr(c.parsed)} (${pct(c.parsed, totRev)}%)` } } } },
    });

    charts.dim = new ChartJs(body.querySelector('#sx-dim'), {
      type: 'bar',
      data: { labels: bucketRows.map(b => b.name), datasets: [{ label: 'Revenue', data: bucketRows.map(b => b.rev), backgroundColor: '#1E3A8A', borderRadius: 4 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => inr(c.parsed.x) } } },
        scales: { x: { ticks: { color: textc, callback: moneyTick }, grid: { color: grid } },
                  y: { ticks: { color: textc }, grid: { display: false } } } },
    });
  }

  paintControls();
  await load();
}
