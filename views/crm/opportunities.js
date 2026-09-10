import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, backButton } from '../../js/ui.js';
import { navigate } from '../../js/router.js';

// CRM › Opportunities. One engine (crm_partner_opportunity), three lenses over a
// two-period comparison of each partner's TP count / TSS count / value:
//   UAP opportunity     — no TP in the "now" period (period B).
//   Transacting opp.    — value in the "was" period (A), none in "now" (B).
//   Playground          — pick a metric + a condition on each period, AND'd.
// The compare set loads once per period pair; all tab filtering is client-side,
// so the playground re-filters instantly. anon+RLS; each org sees its own base.

function inr(n) {
  n = Number(n) || 0;
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + 'Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + 'L';
  if (n >= 1e3) return '₹' + Math.round(n / 1e3) + 'K';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
const num = (n) => n == null ? '—' : Math.round(Number(n)).toLocaleString('en-IN');

// FY helpers (RTcompu FY = Apr 1 → Mar 31).
const iso = (d) => d.toISOString().slice(0, 10);
function currentFY() { const n = new Date(); return n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; }
const fyRange = (y) => ({ from: `${y}-04-01`, to: `${y + 1}-03-31` });
function qRange(y, q) { // q 1..4 within FY starting Apr
  const startMonth = 3 + (q - 1) * 3;            // 3=Apr
  const s = new Date(Date.UTC(y, startMonth, 1));
  const e = new Date(Date.UTC(y, startMonth + 3, 0)); // last day of the 3rd month
  return { from: iso(s), to: iso(e) };
}
function presetOptions() {
  const cfy = currentFY(), lfy = cfy - 1;
  const opts = [
    { key: 'cfy', label: 'This FY', ...fyRange(cfy) },
    { key: 'lfy', label: 'Last FY', ...fyRange(lfy) },
  ];
  for (const q of [1, 2, 3, 4]) opts.push({ key: `cfy-q${q}`, label: `This FY Q${q}`, ...qRange(cfy, q) });
  for (const q of [1, 2, 3, 4]) opts.push({ key: `lfy-q${q}`, label: `Last FY Q${q}`, ...qRange(lfy, q) });
  opts.push({ key: 'custom', label: 'Custom…', from: '', to: '' });
  return opts;
}

const METRICS = [
  { key: 'tp', label: 'TP (new licences)', a: 'a_tp', b: 'b_tp', fmt: num },
  { key: 'tss', label: 'TSS renewals', a: 'a_tss', b: 'b_tss', fmt: num },
  { key: 'value', label: 'Value', a: 'a_value', b: 'b_value', fmt: inr },
];
const CONDS = [
  { key: 'any', label: 'any', test: () => true },
  { key: 'gt0', label: '> 0', test: (v) => v > 0 },
  { key: 'eq0', label: '= 0', test: (v) => v === 0 },
];

export default async function crmOpportunities(container) {
  const org = getOrg();
  const P = presetOptions();
  // Defaults: A = Last FY (was), B = This FY (now).
  let aKey = 'lfy', bKey = 'cfy';
  let aFrom = P.find(p => p.key === 'lfy').from, aTo = P.find(p => p.key === 'lfy').to;
  let bFrom = P.find(p => p.key === 'cfy').from, bTo = P.find(p => p.key === 'cfy').to;
  let tab = 'uap';                 // 'uap' | 'transacting' | 'playground'
  let pMetric = 'tp', pCondA = 'gt0', pCondB = 'eq0';   // playground defaults
  let rows = [];                   // last loaded compare set
  const nameOf = {};

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title" style="margin:0">Opportunities</h1>
        <p class="page-subtitle" style="margin:0">${esc(org?.name || 'Region')} · partners to win, compared across two periods</p>
      </div>
      ${backButton('crm')}
    </div>
    <div id="op-controls"></div>
    <div id="op-body"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
  `;
  if (!org) { document.getElementById('op-body').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  const controls = document.getElementById('op-controls');
  const body = document.getElementById('op-body');

  const { data: users } = await sb.from('users').select('id, full_name, email');
  (users || []).forEach(u => { nameOf[u.id] = u.full_name || u.email; });

  function periodPicker(side) {
    const key = side === 'a' ? aKey : bKey;
    const from = side === 'a' ? aFrom : bFrom, to = side === 'a' ? aTo : bTo;
    const custom = key === 'custom';
    return `
      <div>
        <div class="u-sm-muted" style="margin-bottom:var(--space-1)">${side === 'a' ? 'Period A (was)' : 'Period B (now)'}</div>
        <select class="form-input" data-period="${side}" style="max-width:180px">
          ${P.map(p => `<option value="${p.key}" ${p.key === key ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
        </select>
        <div ${custom ? '' : 'hidden'} data-custom="${side}" style="display:flex;gap:var(--space-1);margin-top:var(--space-1)">
          <input class="form-input" type="date" data-cf="${side}" value="${esc(from)}" style="max-width:150px">
          <input class="form-input" type="date" data-ct="${side}" value="${esc(to)}" style="max-width:150px">
        </div>
      </div>`;
  }

  function paintControls() {
    controls.innerHTML = `
      <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:flex-start;margin-bottom:var(--space-3)">
        ${periodPicker('a')}${periodPicker('b')}
      </div>
      <div style="display:flex;gap:var(--space-1);flex-wrap:wrap;margin-bottom:var(--space-4)">
        ${[['uap', 'UAP opportunity'], ['transacting', 'Transacting opportunity'], ['playground', 'Playground']]
          .map(([k, l]) => `<button class="btn btn-sm ${tab === k ? 'btn-primary' : 'btn-secondary'}" data-tab="${k}">${l}</button>`).join('')}
      </div>`;

    controls.querySelectorAll('[data-period]').forEach(sel => sel.addEventListener('change', () => {
      const side = sel.dataset.period, p = P.find(x => x.key === sel.value);
      if (side === 'a') { aKey = p.key; if (p.key !== 'custom') { aFrom = p.from; aTo = p.to; } }
      else { bKey = p.key; if (p.key !== 'custom') { bFrom = p.from; bTo = p.to; } }
      paintControls();
      if (p.key !== 'custom') load(); // custom waits for the date inputs
    }));
    controls.querySelectorAll('[data-cf],[data-ct]').forEach(inp => inp.addEventListener('change', () => {
      const side = inp.dataset.cf || inp.dataset.ct;
      const cf = controls.querySelector(`[data-cf="${side}"]`).value;
      const ct = controls.querySelector(`[data-ct="${side}"]`).value;
      if (side === 'a') { aFrom = cf; aTo = ct; } else { bFrom = cf; bTo = ct; }
      if (cf && ct) load();
    }));
    controls.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  }

  async function load() {
    body.innerHTML = `<div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>`;
    const { data, error } = await sb.rpc('crm_partner_opportunity', { p_a_from: aFrom, p_a_to: aTo, p_b_from: bFrom, p_b_to: bTo });
    if (error) {
      body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">Couldn't load opportunities</div><div class="empty-state-desc">${esc(error.message)}</div></div>`;
      toast('Opportunities: ' + error.message); return;
    }
    rows = (data || []).map(r => ({
      ...r,
      a_tp: Number(r.a_tp) || 0, a_tss: Number(r.a_tss) || 0, a_value: Number(r.a_value) || 0,
      b_tp: Number(r.b_tp) || 0, b_tss: Number(r.b_tss) || 0, b_value: Number(r.b_value) || 0,
    }));
    render();
  }

  const LIMIT = 150;
  let searchVal = '';

  function currentSet() {
    if (tab === 'uap') return { list: rows.filter(r => r.b_tp === 0), sort: (a, b) => b.b_value - a.b_value };
    if (tab === 'transacting') return { list: rows.filter(r => r.a_value > 0 && r.b_value === 0), sort: (a, b) => b.a_value - a.a_value };
    // playground
    const m = METRICS.find(x => x.key === pMetric);
    const cA = CONDS.find(x => x.key === pCondA), cB = CONDS.find(x => x.key === pCondB);
    return { list: rows.filter(r => cA.test(r[m.a]) && cB.test(r[m.b])), sort: (a, b) => b[m.b] - a[m.b] || b[m.a] - a[m.a] };
  }

  function render() {
    const m = METRICS.find(x => x.key === pMetric);
    const { list, sort } = currentSet();
    const q = searchVal.toLowerCase();
    let shown = list.slice().sort(sort);
    if (q) shown = shown.filter(r =>
      (r.partner_name || '').toLowerCase().includes(q) ||
      (r.region || '').toLowerCase().includes(q) ||
      (r.hub || '').toLowerCase().includes(q) ||
      (nameOf[r.owner_id] || '').toLowerCase().includes(q));

    const caption = tab === 'uap'
      ? `Partners with no TP in Period B — win them into UAP`
      : tab === 'transacting'
        ? `Transacted in Period A, silent in Period B — win-back`
        : `Partners where ${esc(m.label)} is ${esc(CONDS.find(c => c.key === pCondA).label)} in A and ${esc(CONDS.find(c => c.key === pCondB).label)} in B`;

    // Per-tab columns.
    let head, cell;
    if (tab === 'transacting') {
      head = `<th>Partner</th><th>Region</th><th>Owner</th><th style="text-align:right">Value A</th><th style="text-align:right">Value B</th><th style="text-align:right">Last buy</th>`;
      cell = (r) => `<td style="text-align:right;font-weight:var(--font-weight-semibold)">${inr(r.a_value)}</td><td style="text-align:right">${inr(r.b_value)}</td><td class="u-sm-muted" style="text-align:right">${r.last_activity ? esc(r.last_activity) : '—'}</td>`;
    } else if (tab === 'playground') {
      head = `<th>Partner</th><th>Region</th><th>Owner</th><th style="text-align:right">${esc(m.label)} A</th><th style="text-align:right">${esc(m.label)} B</th><th style="text-align:right">Last buy</th>`;
      cell = (r) => `<td style="text-align:right;font-weight:var(--font-weight-semibold)">${m.fmt(r[m.a])}</td><td style="text-align:right">${m.fmt(r[m.b])}</td><td class="u-sm-muted" style="text-align:right">${r.last_activity ? esc(r.last_activity) : '—'}</td>`;
    } else { // uap
      head = `<th>Partner</th><th>Region</th><th>Owner</th><th style="text-align:right">TP (A)</th><th style="text-align:right">Value B</th><th style="text-align:right">Last buy</th>`;
      cell = (r) => `<td style="text-align:right">${num(r.a_tp)}</td><td style="text-align:right;font-weight:var(--font-weight-semibold)">${inr(r.b_value)}</td><td class="u-sm-muted" style="text-align:right">${r.last_activity ? esc(r.last_activity) : '—'}</td>`;
    }

    const playgroundBar = tab !== 'playground' ? '' : `
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center;margin-bottom:var(--space-3)">
        <span class="u-sm-muted">Metric</span>
        <select class="form-input" id="op-metric" style="max-width:180px">${METRICS.map(x => `<option value="${x.key}" ${x.key === pMetric ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
        <span class="u-sm-muted">A is</span>
        <select class="form-input" id="op-condA" style="max-width:100px">${CONDS.map(c => `<option value="${c.key}" ${c.key === pCondA ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
        <span class="u-sm-muted">and B is</span>
        <select class="form-input" id="op-condB" style="max-width:100px">${CONDS.map(c => `<option value="${c.key}" ${c.key === pCondB ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
      </div>`;

    body.innerHTML = `
      ${playgroundBar}
      <div class="card">
        <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
          <span style="font-weight:var(--font-weight-semibold)">${esc(String(list.length).toLocaleString?.() || list.length)} partners</span>
          <span class="u-sm-muted">${caption}</span>
          <input type="text" class="form-input" id="op-search" placeholder="Search partner, region, owner…" value="${esc(searchVal)}" style="flex:1;min-width:180px;height:34px">
          <span class="u-meta" id="op-count"></span>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr>${head}</tr></thead>
          <tbody>${shown.length ? shown.slice(0, LIMIT).map(r => `<tr class="op-row" data-id="${esc(r.id)}" style="cursor:pointer">
            <td><div style="font-weight:var(--font-weight-medium)">${esc(r.partner_name || '—')}</div>${r.tier ? `<div class="u-meta">${esc(r.tier)}</div>` : ''}</td>
            <td class="u-sm-muted">${esc([r.hub, r.region].filter(Boolean).join(' · ') || '—')}</td>
            <td class="u-sm-muted">${esc(nameOf[r.owner_id] || '—')}</td>
            ${cell(r)}
          </tr>`).join('') : `<tr><td colspan="6" class="u-sm-muted" style="padding:var(--space-4)">No partners match.</td></tr>`}</tbody>
        </table></div>
      </div>`;

    document.getElementById('op-count').textContent = `${shown.length.toLocaleString('en-IN')}${shown.length > LIMIT ? ` · top ${LIMIT}` : ''}`;
    const s = document.getElementById('op-search');
    s.addEventListener('input', () => { searchVal = s.value; render(); });
    body.querySelectorAll('.op-row').forEach(row => {
      if (row.dataset.id) row.addEventListener('click', () => navigate('crm/partner?id=' + row.dataset.id));
    });
    if (tab === 'playground') {
      document.getElementById('op-metric').addEventListener('change', (e) => { pMetric = e.target.value; render(); });
      document.getElementById('op-condA').addEventListener('change', (e) => { pCondA = e.target.value; render(); });
      document.getElementById('op-condB').addEventListener('change', (e) => { pCondB = e.target.value; render(); });
    }
  }

  paintControls();
  await load();
}
