// Chart renderers for the analytics tool — powered by Apache ECharts (loaded
// lazily from CDN, the same delivery path as the Supabase client, so no build
// step). ECharts gives real interactivity (tooltips, zoom, legend toggles) and
// a deep chart catalogue while we keep our own theming and data contract.
//
// Two visual themes (a per-question toggle):
//   'mono'  — monochromatic: one accent hue, categories/series separated by
//             opacity; fully rounded pill bars, smooth spline lines with a soft
//             area fade, rounded donut segments.
//   'color' — the multi-hue categorical palette.
//
// Contract: renderChart(container, viz, result, opts) renders INTO container
// (ECharts needs a live DOM node). `table` and `number` stay HTML.

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

const ECHARTS_SRC = 'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js';
const PALETTE = ['#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#4F46E5'];

let _echartsPromise = null;
function loadECharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (_echartsPromise) return _echartsPromise;
  _echartsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ECHARTS_SRC; s.async = true;
    s.onload = () => window.echarts ? resolve(window.echarts) : reject(new Error('ECharts missing after load'));
    s.onerror = () => { _echartsPromise = null; reject(new Error('Failed to load chart library')); };
    document.head.appendChild(s);
  });
  return _echartsPromise;
}

// Resolve theme-aware colours from CSS tokens (so charts follow light/dark).
function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n, fb) => (cs.getPropertyValue(n).trim() || fb);
  return {
    accent: g('--color-accent', '#2563EB'),
    text: g('--color-text-primary', '#111827'),
    textSec: g('--color-text-secondary', '#6B7280'),
    textTer: g('--color-text-tertiary', '#9CA3AF'),
    border: g('--color-border', '#E5E7EB'),
    bg: g('--color-bg', '#FFFFFF'),
    surface: g('--color-surface', '#FFFFFF'),
    gridTrack: g('--color-bg-tertiary', '#F3F4F6'),
  };
}

// hex (#rgb/#rrggbb) → rgba string with alpha.
function withAlpha(hex, a) {
  let h = (hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return hex; // already rgb()/named — return as-is
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// A category colour for index i (mono = accent at descending opacity).
function catColors(theme, n, accent) {
  if (theme === 'color') return PALETTE;
  return Array.from({ length: Math.max(n, 1) }, (_, i) =>
    withAlpha(accent, n > 1 ? Math.max(1 - (i / n) * 0.72, 0.3) : 1));
}

// ---- value formatting -------------------------------------------------------
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

const dimCols = cols => cols.filter(c => c.isDimension);
const measureCols = cols => cols.filter(c => !c.isDimension);

function emptyHTML(msg = 'No data for this query.') {
  return `<div style="display:flex;align-items:center;justify-content:center;min-height:140px;color:var(--color-text-tertiary);font-size:var(--text-sm)">${esc(msg)}</div>`;
}

// ---- HTML renderers (table, number) -----------------------------------------
function tableHTML({ columns, rows }) {
  if (!rows.length) return emptyHTML();
  return `<div class="table-wrap"><table class="table">
    <thead><tr>${columns.map(c => `<th style="${c.isDimension ? '' : 'text-align:right'}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${columns.map(c => `<td style="${c.isDimension ? 'font-weight:var(--font-weight-medium)' : 'text-align:right'}">${fmtValue(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}
function numberHTML({ columns, rows }, theme) {
  const measures = measureCols(columns);
  if (!rows.length || !measures.length) return emptyHTML();
  const row = rows[0];
  const colors = catColors(theme, measures.length, tokens().accent);
  if (measures.length === 1) {
    const m = measures[0];
    return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:140px;gap:var(--space-1)">
      <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-accent);letter-spacing:-0.02em">${fmtValue(row[m.key], m.type)}</div>
      <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(m.label)}</div>
    </div>`;
  }
  return `<div class="stat-grid" style="min-height:140px">${measures.map((m, i) => `
    <div style="text-align:center;padding:var(--space-3)">
      <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:${colors[i]};letter-spacing:-0.02em">${fmtValue(row[m.key], m.type)}</div>
      <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:var(--space-1)">${esc(m.label)}</div>
    </div>`).join('')}</div>`;
}

// Pull x-labels and the primary measure for the single-series charts.
function xy(columns, rows) {
  const dims = dimCols(columns), measures = measureCols(columns);
  if (!dims.length || !measures.length) return null;
  const xKey = dims[0].key, m = measures[0];
  return { labels: rows.map(r => String(r[xKey] ?? '—')), values: rows.map(r => Number(r[m.key]) || 0), measure: m };
}

// ---- ECharts option builders ------------------------------------------------
function baseOption(t) {
  return {
    color: PALETTE,
    textStyle: { fontFamily: 'inherit', color: t.textSec },
    tooltip: { trigger: 'item', backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, textStyle: { color: t.text, fontSize: 12 } },
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    animationDuration: 500,
  };
}
const axisCommon = t => ({
  axisLine: { show: false }, axisTick: { show: false },
  axisLabel: { color: t.textTer, fontSize: 10 },
  splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
});

function barOption(result, theme, horizontal) {
  const d = xy(result.columns, result.rows); if (!d) return null;
  const t = tokens();
  const colors = catColors(theme, d.labels.length, t.accent);
  const valFmt = v => fmtValue(v, d.measure.type);
  const cat = { type: 'category', data: d.labels, ...axisCommon(t), splitLine: { show: false }, axisLabel: { ...axisCommon(t).axisLabel, interval: 0, hideOverlap: true, rotate: !horizontal && d.labels.length > 8 ? 30 : 0 } };
  const val = { type: 'value', ...axisCommon(t), axisLabel: { ...axisCommon(t).axisLabel, formatter: valFmt } };
  const radius = horizontal ? [0, 8, 8, 0] : [8, 8, 0, 0];
  return {
    ...baseOption(t),
    tooltip: { ...baseOption(t).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: valFmt },
    xAxis: horizontal ? val : cat,
    yAxis: horizontal ? cat : val,
    series: [{
      type: 'bar', data: d.values, colorBy: theme === 'color' ? 'data' : 'series',
      itemStyle: { color: theme === 'color' ? undefined : colors[0], borderRadius: radius },
      barMaxWidth: 48,
    }],
    color: theme === 'color' ? PALETTE : colors,
  };
}

function lineOption(result, theme) {
  const d = xy(result.columns, result.rows); if (!d) return null;
  if (d.labels.length < 2) return barOption(result, theme, false);
  const t = tokens();
  const stroke = theme === 'color' ? PALETTE[0] : t.accent;
  const valFmt = v => fmtValue(v, d.measure.type);
  return {
    ...baseOption(t),
    tooltip: { ...baseOption(t).tooltip, trigger: 'axis', valueFormatter: valFmt },
    xAxis: { type: 'category', boundaryGap: false, data: d.labels, ...axisCommon(t), splitLine: { show: false }, axisLabel: { ...axisCommon(t).axisLabel, hideOverlap: true } },
    yAxis: { type: 'value', ...axisCommon(t), axisLabel: { ...axisCommon(t).axisLabel, formatter: valFmt } },
    series: [{
      type: 'line', data: d.values, smooth: 0.4, showSymbol: d.labels.length <= 24, symbolSize: 6,
      lineStyle: { width: 2.5, cap: 'round', join: 'round', color: stroke },
      itemStyle: { color: stroke },
      areaStyle: { color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: withAlpha(stroke, 0.28) }, { offset: 1, color: withAlpha(stroke, 0) },
      ]) },
    }],
  };
}

function pieOption(result, theme) {
  const d = xy(result.columns, result.rows); if (!d) return null;
  const t = tokens();
  const pairs = d.labels.map((l, i) => ({ name: l, value: d.values[i] })).filter(p => p.value > 0).slice(0, 12);
  if (!pairs.length) return null;
  const colors = catColors(theme, pairs.length, t.accent);
  const valFmt = v => fmtValue(v, d.measure.type);
  return {
    ...baseOption(t),
    tooltip: { ...baseOption(t).tooltip, trigger: 'item', formatter: p => `${esc(p.name)}<br/><b>${valFmt(p.value)}</b> (${p.percent}%)` },
    legend: { type: 'scroll', orient: 'vertical', right: 8, top: 'middle', textStyle: { color: t.textSec, fontSize: 12 }, icon: 'roundRect' },
    color: theme === 'color' ? PALETTE : colors,
    series: [{
      type: 'pie', radius: ['55%', '82%'], center: ['38%', '50%'], data: pairs,
      itemStyle: { borderColor: t.surface, borderWidth: 3, borderRadius: 8, color: theme === 'color' ? undefined : ((p) => colors[p.dataIndex]) },
      label: { show: false }, labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 6 },
    }],
  };
}

function buildOption(viz, result, theme) {
  if (viz === 'bar') return barOption(result, theme, false);
  if (viz === 'row') return barOption(result, theme, true);
  if (viz === 'line') return lineOption(result, theme);
  if (viz === 'pie') return pieOption(result, theme);
  return null;
}

// ---- one shared resize handler ----------------------------------------------
let _resizeBound = false;
function bindResize(echarts) {
  if (_resizeBound) return; _resizeBound = true;
  let raf = null;
  window.addEventListener('resize', () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      document.querySelectorAll('[data-echart]').forEach(n => {
        if (!n.isConnected) return;
        const inst = echarts.getInstanceByDom(n); if (inst) inst.resize();
      });
    });
  });
}

// Dispose ECharts instances under a root (call before wiping its innerHTML).
export function disposeChartsIn(root) {
  if (!window.echarts || !root) return;
  root.querySelectorAll('[data-echart]').forEach(n => {
    const inst = window.echarts.getInstanceByDom(n); if (inst) inst.dispose();
  });
}

// ---- public entry -----------------------------------------------------------
// renderChart(container, viz, result, { theme, height }) → renders into container.
export async function renderChart(container, viz, result, opts = {}) {
  if (!container) return;
  const theme = opts.theme === 'color' ? 'color' : 'mono';
  disposeChartsIn(container);

  if (!result || !result.rows) { container.innerHTML = emptyHTML('Run the query to see results.'); return; }
  if (viz === 'table') { container.innerHTML = tableHTML(result); return; }
  if (viz === 'number') { container.innerHTML = numberHTML(result, theme); return; }
  if (!result.rows.length) { container.innerHTML = emptyHTML('No rows match — adjust the filters.'); return; }

  let echarts;
  try { echarts = await loadECharts(); }
  catch { container.innerHTML = emptyHTML('Could not load the chart library (offline?). Switch to Table view.'); return; }

  const option = buildOption(viz, result, theme);
  if (!option) { container.innerHTML = emptyHTML(); return; }

  container.innerHTML = '';
  const host = document.createElement('div');
  host.setAttribute('data-echart', '');
  host.style.width = '100%';
  host.style.height = (opts.height || 300) + 'px';
  container.appendChild(host);

  const chart = echarts.init(host, null, { renderer: 'canvas' });
  chart.setOption(option);
  bindResize(echarts);
}
