// Chart renderers for the analytics tool — pure CSS/SVG, no libraries, themed
// via CSS variables. Every renderer takes a result set { columns, rows } (from
// engine.js) plus the org currency and returns an HTML string.
//
// Result shape: columns = [{key,label,type,isDimension?}], rows = [{key:value}].
// Dimension columns are the group-by keys (dim0, dim1…); the rest are measures.

import { esc } from '../ui.js';
import { getOrg } from '../auth.js';

export const VIZ_TYPES = [
  { id: 'number', label: 'Number', icon: '№' },
  { id: 'table',  label: 'Table',  icon: '▦' },
  { id: 'bar',    label: 'Bar',    icon: '▊' },
  { id: 'row',    label: 'Row',    icon: '▬' },
  { id: 'line',   label: 'Line',   icon: '╱' },
  { id: 'pie',    label: 'Donut',  icon: '◔' },
];

// A palette that reads clearly on both light and dark grounds.
const PALETTE = ['#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#4F46E5'];
const color = i => PALETTE[i % PALETTE.length];

function fmtMoney(n) {
  const cur = getOrg()?.currency || 'INR';
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n) || 0); }
  catch { return `${cur} ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`; }
}
function fmtNum(n) {
  const v = Number(n);
  if (isNaN(v)) return String(n ?? '—');
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-IN', { maximumFractionDigits: 1 });
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
export function fmtValue(v, type) {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'money') return fmtMoney(v);
  if (type === 'number') return fmtNum(v);
  return esc(String(v));
}

function emptyChart(msg = 'No data for this query.') {
  return `<div style="display:flex;align-items:center;justify-content:center;min-height:120px;color:var(--color-text-tertiary);font-size:var(--text-sm)">${esc(msg)}</div>`;
}

const dimCols = cols => cols.filter(c => c.isDimension);
const measureCols = cols => cols.filter(c => !c.isDimension);

// ---- number -----------------------------------------------------------------
function renderNumber({ columns, rows }) {
  const measures = measureCols(columns);
  if (!rows.length || !measures.length) return emptyChart();
  const row = rows[0];
  if (measures.length === 1) {
    const m = measures[0];
    return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:120px;gap:var(--space-1)">
      <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-accent)">${fmtValue(row[m.key], m.type)}</div>
      <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(m.label)}</div>
    </div>`;
  }
  return `<div class="stat-grid" style="min-height:120px">${measures.map((m, i) => `
    <div style="text-align:center;padding:var(--space-3)">
      <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:${color(i)}">${fmtValue(row[m.key], m.type)}</div>
      <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:var(--space-1)">${esc(m.label)}</div>
    </div>`).join('')}</div>`;
}

// ---- table ------------------------------------------------------------------
function renderTable({ columns, rows }) {
  if (!rows.length) return emptyChart();
  return `<div class="table-wrap"><table class="table">
    <thead><tr>${columns.map(c => `<th style="${c.isDimension ? '' : 'text-align:right'}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${columns.map(c => `<td style="${c.isDimension ? 'font-weight:var(--font-weight-medium)' : 'text-align:right'}">${fmtValue(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

// Pick the x-dimension and the primary measure for the visual charts.
function xy(columns, rows) {
  const dims = dimCols(columns);
  const measures = measureCols(columns);
  if (!dims.length || !measures.length) return null;
  const xKey = dims[0].key, m = measures[0];
  const pts = rows.map(r => ({ label: String(r[xKey] ?? '—'), value: Number(r[m.key]) || 0 }));
  return { pts, measure: m };
}

// ---- row (horizontal bars) --------------------------------------------------
function renderRow({ columns, rows }) {
  const d = xy(columns, rows);
  if (!d) return emptyChart();
  const max = Math.max(...d.pts.map(p => Math.abs(p.value)), 1);
  return `<div style="display:flex;flex-direction:column;gap:var(--space-3);padding:var(--space-1) 0">
    ${d.pts.map((p, i) => `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:var(--text-sm);margin-bottom:3px">
          <span style="color:var(--color-text-primary)">${esc(p.label)}</span>
          <span style="font-weight:var(--font-weight-medium)">${fmtValue(p.value, d.measure.type)}</span>
        </div>
        <div style="height:10px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);overflow:hidden">
          <div style="height:100%;width:${Math.max((Math.abs(p.value) / max) * 100, p.value ? 2 : 0)}%;background:${color(i)};border-radius:var(--radius-full)"></div>
        </div>
      </div>`).join('')}
  </div>`;
}

// ---- bar (vertical) ---------------------------------------------------------
function renderBar({ columns, rows }) {
  const d = xy(columns, rows);
  if (!d) return emptyChart();
  const pts = d.pts.slice(0, 40);
  const max = Math.max(...pts.map(p => Math.abs(p.value)), 1);
  return `<div style="display:flex;align-items:flex-end;gap:${pts.length > 20 ? '2px' : 'var(--space-2)'};height:200px;padding-top:var(--space-4);overflow-x:auto">
    ${pts.map((p, i) => `
      <div title="${esc(p.label)}: ${fmtValue(p.value, d.measure.type)}" style="flex:1;min-width:${pts.length > 20 ? '8px' : '18px'};display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end">
        <div style="font-size:10px;color:var(--color-text-tertiary);white-space:nowrap">${pts.length <= 12 ? fmtValue(p.value, d.measure.type) : ''}</div>
        <div style="width:100%;height:${Math.max((Math.abs(p.value) / max) * 100, p.value ? 2 : 0)}%;background:${color(i)};border-radius:var(--radius-sm) var(--radius-sm) 0 0;min-height:${p.value ? 2 : 0}px"></div>
        <div style="font-size:10px;color:var(--color-text-secondary);white-space:nowrap;max-width:60px;overflow:hidden;text-overflow:ellipsis">${esc(p.label)}</div>
      </div>`).join('')}
  </div>`;
}

// ---- line -------------------------------------------------------------------
function renderLine({ columns, rows }) {
  const d = xy(columns, rows);
  if (!d || d.pts.length < 2) return d && d.pts.length ? renderBar({ columns, rows }) : emptyChart();
  const pts = d.pts;
  const W = 640, H = 200, pad = 28;
  const max = Math.max(...pts.map(p => p.value), 0);
  const min = Math.min(...pts.map(p => p.value), 0);
  const span = (max - min) || 1;
  const x = i => pad + (i * (W - pad * 2)) / (pts.length - 1);
  const y = v => H - pad - ((v - min) / span) * (H - pad * 2);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`;
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:${Math.max(W, pts.length * 40)}px;height:220px" preserveAspectRatio="none">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--color-border)" stroke-width="1"/>
    <path d="${area}" fill="${color(0)}" opacity="0.10"/>
    <path d="${line}" fill="none" stroke="${color(0)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="${color(0)}"><title>${esc(p.label)}: ${fmtValue(p.value, d.measure.type)}</title></circle>`).join('')}
    ${pts.map((p, i) => (i % Math.ceil(pts.length / 8) === 0 || i === pts.length - 1) ? `<text x="${x(i).toFixed(1)}" y="${H - pad + 14}" font-size="10" fill="var(--color-text-tertiary)" text-anchor="middle">${esc(p.label.slice(0, 10))}</text>` : '').join('')}
  </svg></div>`;
}

// ---- pie / donut ------------------------------------------------------------
function renderPie({ columns, rows }) {
  const d = xy(columns, rows);
  if (!d) return emptyChart();
  const pts = d.pts.filter(p => p.value > 0).slice(0, 10);
  const total = pts.reduce((s, p) => s + p.value, 0);
  if (!total) return emptyChart();
  const R = 80, C = 100, inner = 48;
  let angle = -Math.PI / 2;
  const arcs = pts.map((p, i) => {
    const frac = p.value / total;
    const a2 = angle + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = C + R * Math.cos(angle), y1 = C + R * Math.sin(angle);
    const x2 = C + R * Math.cos(a2), y2 = C + R * Math.sin(a2);
    const path = `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L${C} ${C} Z" fill="${color(i)}"><title>${esc(p.label)}: ${fmtValue(p.value, d.measure.type)} (${Math.round(frac * 100)}%)</title></path>`;
    angle = a2;
    return path;
  }).join('');
  return `<div style="display:flex;gap:var(--space-5);align-items:center;flex-wrap:wrap;justify-content:center">
    <svg viewBox="0 0 200 200" style="width:180px;height:180px">
      ${arcs}
      <circle cx="${C}" cy="${C}" r="${inner}" fill="var(--color-surface)"/>
      <text x="${C}" y="${C - 4}" font-size="20" font-weight="700" fill="var(--color-text-primary)" text-anchor="middle">${fmtValue(total, d.measure.type)}</text>
      <text x="${C}" y="${C + 14}" font-size="10" fill="var(--color-text-secondary)" text-anchor="middle">Total</text>
    </svg>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:var(--text-sm)">
      ${pts.map((p, i) => `<div style="display:flex;align-items:center;gap:var(--space-2)">
        <span style="width:10px;height:10px;border-radius:2px;background:${color(i)};flex-shrink:0"></span>
        <span style="color:var(--color-text-primary)">${esc(p.label)}</span>
        <span style="color:var(--color-text-tertiary);margin-left:auto">${Math.round((p.value / total) * 100)}%</span>
      </div>`).join('')}
    </div>
  </div>`;
}

const RENDERERS = { number: renderNumber, table: renderTable, bar: renderBar, row: renderRow, line: renderLine, pie: renderPie };

export function renderChart(viz, result) {
  if (!result || !result.rows) return emptyChart('Run the query to see results.');
  const fn = RENDERERS[viz] || renderTable;
  return fn(result);
}
