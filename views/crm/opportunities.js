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
// Comparison operators for the playground. `num:false` ignores the threshold.
const OPS = [
  { key: 'any', label: 'any', num: false, test: () => true },
  { key: 'gt', label: '>', num: true, test: (v, n) => v > n },
  { key: 'gte', label: '≥', num: true, test: (v, n) => v >= n },
  { key: 'eq', label: '=', num: true, test: (v, n) => v === n },
  { key: 'lte', label: '≤', num: true, test: (v, n) => v <= n },
  { key: 'lt', label: '<', num: true, test: (v, n) => v < n },
];
const opLabel = (o, n) => o.num ? `${o.label} ${num(n)}` : 'any';

export default async function crmOpportunities(container) {
  const org = getOrg();
  const P = presetOptions();
  // Defaults: A = Last FY (was), B = This FY (now).
  let aKey = 'lfy', bKey = 'cfy';
  let aFrom = P.find(p => p.key === 'lfy').from, aTo = P.find(p => p.key === 'lfy').to;
  let bFrom = P.find(p => p.key === 'cfy').from, bTo = P.find(p => p.key === 'cfy').to;
  let tab = 'uap';                 // 'uap' | 'transacting' | 'playground'
  // Playground defaults: TP > 0 in A and TP = 0 in B (the LFY-TP>0 & CFY-TP=0 case).
  let pMetric = 'tp', pOpA = 'gt', pNumA = 0, pOpB = 'eq', pNumB = 0;
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
      <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-3)">
        <div class="control-label" style="margin-bottom:var(--space-2)">${side === 'a' ? 'Period A · was' : 'Period B · now'}</div>
        <select class="form-input" data-period="${side}" style="width:100%">
          ${P.map(p => `<option value="${p.key}" ${p.key === key ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
        </select>
        <div ${custom ? '' : 'hidden'} data-custom="${side}" style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-top:var(--space-2)">
          <input class="form-input" type="date" data-cf="${side}" value="${esc(from)}">
          <input class="form-input" type="date" data-ct="${side}" value="${esc(to)}">
        </div>
      </div>`;
  }

  function paintControls() {
    controls.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--space-3);margin-bottom:var(--space-3)">
        ${periodPicker('a')}${periodPicker('b')}
      </div>
      <div class="seg" style="margin-bottom:var(--space-4)">
        ${[['uap', 'UAP opportunity'], ['transacting', 'Transacting opportunity'], ['playground', 'Playground']]
          .map(([k, l]) => `<button class="seg-btn ${tab === k ? 'is-active' : ''}" data-tab="${k}">${l}</button>`).join('')}
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
    controls.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; paintControls(); render(); }));
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
    // playground: metric OP num on each period, AND'd.
    const m = METRICS.find(x => x.key === pMetric);
    const oA = OPS.find(x => x.key === pOpA), oB = OPS.find(x => x.key === pOpB);
    return { list: rows.filter(r => oA.test(r[m.a], pNumA) && oB.test(r[m.b], pNumB)), sort: (a, b) => b[m.b] - a[m.b] || b[m.a] - a[m.a] };
  }

  // Build the shell (columns depend on the tab / metric); table body fills separately
  // so typing in the search or number fields never rebuilds — and never steals — focus.
  function render() {
    const m = METRICS.find(x => x.key === pMetric);
    const oA = OPS.find(o => o.key === pOpA), oB = OPS.find(o => o.key === pOpB);
    const caption = tab === 'uap'
      ? `Partners with no TP in Period B — win them into UAP`
      : tab === 'transacting'
        ? `Transacted in Period A, silent in Period B — win-back`
        : `${esc(m.label)}: ${esc(opLabel(oA, pNumA))} in A · ${esc(opLabel(oB, pNumB))} in B`;

    let head;
    if (tab === 'transacting') head = `<th>Partner</th><th>Region</th><th>Owner</th><th style="text-align:right">Value A</th><th style="text-align:right">Value B</th><th style="text-align:right">Last buy</th>`;
    else if (tab === 'playground') head = `<th>Partner</th><th>Region</th><th>Owner</th><th style="text-align:right">${esc(m.label)} A</th><th style="text-align:right">${esc(m.label)} B</th><th style="text-align:right">Last buy</th>`;
    else head = `<th>Partner</th><th>Region</th><th>Owner</th><th style="text-align:right">TP (A)</th><th style="text-align:right">Value B</th><th style="text-align:right">Last buy</th>`;

    const cell = (r) => {
      if (tab === 'transacting') return `<td style="text-align:right;font-weight:var(--font-weight-semibold)">${inr(r.a_value)}</td><td style="text-align:right">${inr(r.b_value)}</td><td class="u-sm-muted" style="text-align:right">${r.last_activity ? esc(r.last_activity) : '—'}</td>`;
      if (tab === 'playground') return `<td style="text-align:right;font-weight:var(--font-weight-semibold)">${m.fmt(r[m.a])}</td><td style="text-align:right">${m.fmt(r[m.b])}</td><td class="u-sm-muted" style="text-align:right">${r.last_activity ? esc(r.last_activity) : '—'}</td>`;
      return `<td style="text-align:right">${num(r.a_tp)}</td><td style="text-align:right;font-weight:var(--font-weight-semibold)">${inr(r.b_value)}</td><td class="u-sm-muted" style="text-align:right">${r.last_activity ? esc(r.last_activity) : '—'}</td>`;
    };

    const opSel = (id, cur) => `<select class="form-input" id="${id}" style="max-width:74px;height:34px">${OPS.map(o => `<option value="${o.key}" ${o.key === cur ? 'selected' : ''}>${o.label}</option>`).join('')}</select>`;
    const playgroundBar = tab !== 'playground' ? '' : `
      <div class="control-bar nowrap">
        <div class="control-group"><span class="control-label">Metric</span>
          <select class="form-input" id="op-metric" style="max-width:170px;height:34px">${METRICS.map(x => `<option value="${x.key}" ${x.key === pMetric ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
        <div class="control-group"><span class="control-label">Period A</span>
          ${opSel('op-opA', pOpA)}
          <input class="form-input" type="number" id="op-numA" value="${pNumA}" ${oA.num ? '' : 'disabled'} style="max-width:100px;height:34px"></div>
        <div class="control-group"><span class="control-label">Period B</span>
          ${opSel('op-opB', pOpB)}
          <input class="form-input" type="number" id="op-numB" value="${pNumB}" ${oB.num ? '' : 'disabled'} style="max-width:100px;height:34px"></div>
      </div>`;

    body.innerHTML = `
      ${playgroundBar}
      <div class="card">
        <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
          <span style="font-weight:var(--font-weight-semibold)" id="op-total"></span>
          <span class="u-sm-muted">${caption}</span>
          <input type="text" class="form-input" id="op-search" placeholder="Search partner, region, owner…" value="${esc(searchVal)}" style="flex:1;min-width:180px;height:34px">
          <span class="u-meta" id="op-count"></span>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr>${head}</tr></thead>
          <tbody id="op-tbody"></tbody>
        </table></div>
      </div>`;

    // paintTable fills only the tbody + counts — safe to call on every keystroke.
    function paintTable() {
      const { list, sort } = currentSet();
      const q = searchVal.toLowerCase();
      let shown = list.slice().sort(sort);
      if (q) shown = shown.filter(r =>
        (r.partner_name || '').toLowerCase().includes(q) ||
        (r.region || '').toLowerCase().includes(q) ||
        (r.hub || '').toLowerCase().includes(q) ||
        (nameOf[r.owner_id] || '').toLowerCase().includes(q));
      document.getElementById('op-total').textContent = `${list.length.toLocaleString('en-IN')} partners`;
      document.getElementById('op-count').textContent = `${shown.length.toLocaleString('en-IN')}${shown.length > LIMIT ? ` · top ${LIMIT}` : ''}`;
      const tb = document.getElementById('op-tbody');
      tb.innerHTML = shown.length ? shown.slice(0, LIMIT).map(r => `<tr class="op-row" data-id="${esc(r.id)}" style="cursor:pointer">
        <td><div style="font-weight:var(--font-weight-medium)">${esc(r.partner_name || '—')}</div>${r.tier ? `<div class="u-meta">${esc(r.tier)}</div>` : ''}</td>
        <td class="u-sm-muted">${esc([r.hub, r.region].filter(Boolean).join(' · ') || '—')}</td>
        <td class="u-sm-muted">${esc(nameOf[r.owner_id] || '—')}</td>
        ${cell(r)}
      </tr>`).join('') : `<tr><td colspan="6" class="u-sm-muted" style="padding:var(--space-4)">No partners match.</td></tr>`;
      tb.querySelectorAll('.op-row').forEach(row => {
        if (row.dataset.id) row.addEventListener('click', () => navigate('crm/partner?id=' + row.dataset.id));
      });
    }

    document.getElementById('op-search').addEventListener('input', (e) => { searchVal = e.target.value; paintTable(); });
    if (tab === 'playground') {
      document.getElementById('op-metric').addEventListener('change', (e) => { pMetric = e.target.value; render(); }); // columns change → rebuild
      const wireOp = (selId, numId, set) => {
        const sel = document.getElementById(selId), n = document.getElementById(numId);
        sel.addEventListener('change', (e) => { const o = OPS.find(x => x.key === e.target.value); set.op(e.target.value); n.disabled = !o.num; paintTable(); });
        n.addEventListener('input', (e) => { set.num(Number(e.target.value) || 0); paintTable(); });
      };
      wireOp('op-opA', 'op-numA', { op: v => pOpA = v, num: v => pNumA = v });
      wireOp('op-opB', 'op-numB', { op: v => pOpB = v, num: v => pNumB = v });
    }
    paintTable();
  }

  paintControls();
  await load();
}
