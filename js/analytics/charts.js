// Chart renderers for the analytics tool — pure CSS/SVG, no libraries, themed
// via CSS variables. Every renderer takes a result set { columns, rows } (from
// engine.js) plus render options and returns an HTML string.
//
// Two visual themes (a per-question toggle):
//   'mono'  — monochromatic: one accent hue, series separated by opacity, fully
//             rounded "pill" bars, smooth spline lines with a soft area fade,
//             rounded donut arcs. (Inspired by the Amicro mono-rounded set,
//             reimplemented from scratch in vanilla SVG.)
//   'color' — the multi-hue categorical palette.
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

export const CHART_THEMES = [
  { id: 'mono', label: 'Mono' },
  { id: 'color', label: 'Color' },
];

// Multi-hue palette for the 'color' theme.
const PALETTE = ['#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#4F46E5'];
const paletteColor = i => PALETTE[i % PALETTE.length];

// Fill for series index i of n, honouring the theme. In 'mono' every mark is
// the accent hue; a series set is separated by descending opacity.
function markFill(theme, i, n) {
  if (theme === 'color') return { color: paletteColor(i), opacity: 1 };
  const op = n > 1 ? Math.max(1 - (i / n) * 0.72, 0.28) : 1;
  return { color: 'var(--color-accent)', opacity: op };
}

let _gid = 0;
const uid = () => `ac${Date.now().toString(36)}${(_gid++).toString(36)}`;

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

// ---- number / KPI -----------------------------------------------------------
function renderNumber({ columns, rows }, theme) {
  const measures = measureCols(columns);
  if (!rows.length || !measures.length) return emptyChart();
  const row = rows[0];
  if (measures.length === 1) {
    const m = measures[0];
    return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:120px;gap:var(--space-1)">
      <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-accent);letter-spacing:-0.02em">${fmtValue(row[m.key], m.type)}</div>
      <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(m.label)}</div>
    </div>`;
  }
  return `<div class="stat-grid" style="min-height:120px">${measures.map((m, i) => {
    const f = markFill(theme, i, measures.length);
    return `<div style="text-align:center;padding:var(--space-3)">
      <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:${f.color};opacity:${f.opacity};letter-spacing:-0.02em">${fmtValue(row[m.key], m.type)}</div>
      <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:var(--space-1)">${esc(m.label)}</div>
    </div>`;
  }).join('')}</div>`;
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

// ---- row (horizontal pill bars) --------------------------------------------
function renderRow({ columns, rows }, theme) {
  const d = xy(columns, rows);
  if (!d) return emptyChart();
  const max = Math.max(...d.pts.map(p => Math.abs(p.value)), 1);
  return `<div style="display:flex;flex-direction:column;gap:var(--space-3);padding:var(--space-1) 0">
    ${d.pts.map((p, i) => {
      const f = markFill(theme, i, d.pts.length);
      return `<div>
        <div style="display:flex;justify-content:space-between;font-size:var(--text-sm);margin-bottom:4px">
          <span style="color:var(--color-text-primary)">${esc(p.label)}</span>
          <span style="font-weight:var(--font-weight-medium)">${fmtValue(p.value, d.measure.type)}</span>
        </div>
        <div style="height:12px;background:var(--color-bg-tertiary);border-radius:999px;overflow:hidden">
          <div style="height:100%;width:${Math.max((Math.abs(p.value) / max) * 100, p.value ? 3 : 0)}%;background:${f.color};opacity:${f.opacity};border-radius:999px"></div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ---- bar (vertical pill bars) -----------------------------------------------
function renderBar({ columns, rows }, theme) {
  const d = xy(columns, rows);
  if (!d) return emptyChart();
  const pts = d.pts.slice(0, 40);
  const max = Math.max(...pts.map(p => Math.abs(p.value)), 1);
  const gap = pts.length > 20 ? '3px' : 'var(--space-2)';
  return `<div style="display:flex;align-items:flex-end;gap:${gap};height:200px;padding-top:var(--space-4);overflow-x:auto">
    ${pts.map((p, i) => {
      const f = markFill(theme, i, pts.length);
      return `<div title="${esc(p.label)}: ${fmtValue(p.value, d.measure.type)}" style="flex:1;min-width:${pts.length > 20 ? '10px' : '20px'};display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end">
        <div style="font-size:10px;color:var(--color-text-tertiary);white-space:nowrap">${pts.length <= 12 ? fmtValue(p.value, d.measure.type) : ''}</div>
        <div style="width:100%;height:${Math.max((Math.abs(p.value) / max) * 100, p.value ? 2 : 0)}%;background:${f.color};opacity:${f.opacity};border-radius:8px;min-height:${p.value ? 3 : 0}px"></div>
        <div style="font-size:10px;color:var(--color-text-secondary);white-space:nowrap;max-width:64px;overflow:hidden;text-overflow:ellipsis">${esc(p.label)}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// Catmull-Rom → cubic-bézier: a smooth "monotone"-style spline through points.
function splinePath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// ---- line (smooth spline + soft area fade) ----------------------------------
function renderLine({ columns, rows }, theme) {
  const d = xy(columns, rows);
  if (!d || d.pts.length < 2) return d && d.pts.length ? renderBar({ columns, rows }, theme) : emptyChart();
  const data = d.pts;
  const W = 640, H = 210, pad = 28;
  const max = Math.max(...data.map(p => p.value), 0);
  const min = Math.min(...data.map(p => p.value), 0);
  const span = (max - min) || 1;
  const x = i => pad + (i * (W - pad * 2)) / (data.length - 1);
  const y = v => H - pad - ((v - min) / span) * (H - pad * 2);
  const pts = data.map((p, i) => ({ x: x(i), y: y(p.value) }));
  const line = splinePath(pts);
  const area = `${line} L${x(data.length - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`;
  const stroke = theme === 'color' ? paletteColor(0) : 'var(--color-accent)';
  const gid = uid();
  const grid = [0.25, 0.5, 0.75].map(t => `<line x1="${pad}" y1="${(pad + t * (H - pad * 2)).toFixed(1)}" x2="${W - pad}" y2="${(pad + t * (H - pad * 2)).toFixed(1)}" stroke="var(--color-border)" stroke-width="1" opacity="0.5"/>`).join('');
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:${Math.max(W, data.length * 40)}px;height:230px" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${stroke}" stop-opacity="0.28"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--color-border)" stroke-width="1"/>
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p, i) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${stroke}"><title>${esc(data[i].label)}: ${fmtValue(data[i].value, d.measure.type)}</title></circle>`).join('')}
    ${data.map((p, i) => (i % Math.ceil(data.length / 8) === 0 || i === data.length - 1) ? `<text x="${x(i).toFixed(1)}" y="${H - pad + 14}" font-size="10" fill="var(--color-text-tertiary)" text-anchor="middle">${esc(p.label.slice(0, 10))}</text>` : '').join('')}
  </svg></div>`;
}

// ---- donut (rounded stroked-arc segments) -----------------------------------
function renderPie({ columns, rows }, theme) {
  const d = xy(columns, rows);
  if (!d) return emptyChart();
  const pts = d.pts.filter(p => p.value > 0).slice(0, 10);
  const total = pts.reduce((s, p) => s + p.value, 0);
  if (!total) return emptyChart();
  const C = 100, R = 74, T = 18;            // centre, ring radius, thickness
  const gapRad = pts.length > 1 ? 0.06 : 0; // small gap so rounded caps show
  const pol = (ang, r) => [C + r * Math.cos(ang), C + r * Math.sin(ang)];
  let ang = -Math.PI / 2;
  const arcs = pts.map((p, i) => {
    const frac = p.value / total;
    const sweep = frac * Math.PI * 2 - gapRad;
    const a1 = ang + gapRad / 2, a2 = a1 + Math.max(sweep, 0.001);
    ang += frac * Math.PI * 2;
    const f = markFill(theme, i, pts.length);
    // Near-full ring: draw as a plain circle to avoid the degenerate arc.
    if (frac > 0.999) return `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${f.color}" stroke-opacity="${f.opacity}" stroke-width="${T}"><title>${esc(p.label)}: ${fmtValue(p.value, d.measure.type)} (100%)</title></circle>`;
    const [x1, y1] = pol(a1, R), [x2, y2] = pol(a2, R);
    const large = (a2 - a1) > Math.PI ? 1 : 0;
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${f.color}" stroke-opacity="${f.opacity}" stroke-width="${T}" stroke-linecap="round"><title>${esc(p.label)}: ${fmtValue(p.value, d.measure.type)} (${Math.round(frac * 100)}%)</title></path>`;
  }).join('');
  return `<div style="display:flex;gap:var(--space-5);align-items:center;flex-wrap:wrap;justify-content:center">
    <svg viewBox="0 0 200 200" style="width:180px;height:180px">
      ${arcs}
      <text x="${C}" y="${C - 4}" font-size="22" font-weight="700" fill="var(--color-text-primary)" text-anchor="middle" letter-spacing="-0.02em">${fmtValue(total, d.measure.type)}</text>
      <text x="${C}" y="${C + 14}" font-size="10" fill="var(--color-text-secondary)" text-anchor="middle">Total</text>
    </svg>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:var(--text-sm)">
      ${pts.map((p, i) => { const f = markFill(theme, i, pts.length); return `<div style="display:flex;align-items:center;gap:var(--space-2)">
        <span style="width:10px;height:10px;border-radius:3px;background:${f.color};opacity:${f.opacity};flex-shrink:0"></span>
        <span style="color:var(--color-text-primary)">${esc(p.label)}</span>
        <span style="color:var(--color-text-tertiary);margin-left:auto">${Math.round((p.value / total) * 100)}%</span>
      </div>`; }).join('')}
    </div>
  </div>`;
}

const RENDERERS = { number: renderNumber, table: renderTable, bar: renderBar, row: renderRow, line: renderLine, pie: renderPie };

// opts: { theme: 'mono' | 'color' } — defaults to 'mono'.
export function renderChart(viz, result, opts = {}) {
  if (!result || !result.rows) return emptyChart('Run the query to see results.');
  const theme = opts.theme === 'color' ? 'color' : 'mono';
  const fn = RENDERERS[viz] || renderTable;
  return fn(result, theme);
}
