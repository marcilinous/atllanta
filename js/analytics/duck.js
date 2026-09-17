// In-browser analytics with DuckDB-Wasm — a local OLAP engine for fast
// slice/dice, window functions, pivots and summary stats over a query result
// WITHOUT another server round-trip.
//
// SECURITY (non-negotiable): DuckDB here is never a data-access channel. It
// only ever ingests rows the caller ALREADY fetched through the RLS-enforced
// analytics_run_sql path, and it runs:
//   • in the browser, in a sandboxed Web Worker (no DOM, no ambient network);
//   • fully IN-MEMORY — we never open OPFS/IndexedDB, so no org data is written
//     to disk;
//   • only against the in-memory table `data` we load from that result.
// It therefore cannot surface a row RLS wouldn't already allow, and leaves
// nothing persisted. The engine + wasm load lazily from the jsdelivr CDN (the
// same CDN the app already uses) only when the user opens the panel.

import { esc } from '../ui.js';

const DUCKDB_ESM = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

let _connPromise = null;

async function getConn() {
  if (_connPromise) return _connPromise;
  _connPromise = (async () => {
    const duckdb = await import(DUCKDB_ESM);
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker); // in-memory; no file store opened
    URL.revokeObjectURL(workerUrl);
    const conn = await db.connect();
    return { db, conn };
  })().catch(err => { _connPromise = null; throw err; });
  return _connPromise;
}

// Replace the in-memory `data` table with the given rows (already RLS-scoped).
async function setData(rows) {
  const { db, conn } = await getConn();
  await db.registerFileText('rows.json', JSON.stringify(rows || []));
  await conn.query(`CREATE OR REPLACE TABLE data AS SELECT * FROM read_json_auto('rows.json')`);
}

// Run local SQL against `data`. Returns { columns, rows } with BigInt coerced.
async function runLocal(sql) {
  const { conn } = await getConn();
  const table = await conn.query(sql);
  const fields = table.schema.fields.map(f => f.name);
  const rows = table.toArray().map(r => {
    const o = {};
    for (const f of fields) { let v = r[f]; if (typeof v === 'bigint') v = Number(v); o[f] = v; }
    return o;
  });
  return { columns: fields, rows };
}

function tableHTML(columns, rows) {
  if (!rows.length) return `<div style="color:var(--color-text-tertiary);font-size:var(--text-sm);padding:var(--space-3)">No rows.</div>`;
  const cell = v => v === null || v === undefined ? '—' : (typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toFixed(2)) : esc(String(v)));
  return `<div class="table-wrap" style="max-height:340px;overflow:auto"><table class="table">
    <thead><tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.slice(0, 500).map(r => `<tr>${columns.map(c => `<td>${cell(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

const PRESETS = [
  { label: 'All rows', sql: 'SELECT * FROM data LIMIT 200' },
  { label: 'Summary stats', sql: 'SUMMARIZE data' },
  { label: 'Columns', sql: 'DESCRIBE data' },
  { label: 'Row count', sql: 'SELECT count(*) AS rows FROM data' },
];

// Mount the local-analysis panel into rootEl. getResult() returns the current
// { columns, rows } (from engine.js) to analyse; it's read on each Run.
export function mountLab(rootEl, getResult) {
  rootEl.innerHTML = `
    <details style="margin-top:var(--space-4)">
      <summary style="cursor:pointer;font-weight:var(--font-weight-medium);color:var(--color-text-primary)">⚡ Explore this result</summary>
      <div class="card" style="margin-top:var(--space-3)"><div class="card-body">
        <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-3)">
          Slice, pivot and re-aggregate the current result with SQL. Table name: <code>data</code>.
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--space-2)">
          ${PRESETS.map((p, i) => `<button class="btn btn-ghost btn-sm" data-preset="${i}">${esc(p.label)}</button>`).join('')}
        </div>
        <textarea class="form-input" id="duck-sql" spellcheck="false" style="font-family:var(--font-mono);min-height:90px;resize:vertical">SELECT * FROM data LIMIT 200</textarea>
        <div style="display:flex;align-items:center;gap:var(--space-3);margin-top:var(--space-2)">
          <button class="btn btn-secondary btn-sm" id="duck-run">Run locally</button>
          <span id="duck-note" style="font-size:var(--text-xs);color:var(--color-text-tertiary)"></span>
        </div>
        <div id="duck-out" style="margin-top:var(--space-3)"></div>
      </div></div>
    </details>`;

  const ta = rootEl.querySelector('#duck-sql');
  const out = rootEl.querySelector('#duck-out');
  const note = rootEl.querySelector('#duck-note');
  const runBtn = rootEl.querySelector('#duck-run');

  rootEl.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    ta.value = PRESETS[Number(b.dataset.preset)].sql; run();
  }));

  async function run() {
    const result = getResult();
    if (!result || !result.rows || !result.rows.length) { note.textContent = 'Run a query above first — there is no result to analyse.'; return; }
    runBtn.disabled = true; note.textContent = 'Loading engine & running…';
    try {
      await setData(result.rows);
      const { columns, rows } = await runLocal(ta.value.trim() || 'SELECT * FROM data LIMIT 200');
      out.innerHTML = tableHTML(columns, rows);
      note.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'} · local`;
    } catch (e) {
      out.innerHTML = `<div style="color:var(--color-error);font-size:var(--text-sm);white-space:pre-wrap">${esc(e.message || String(e))}</div>`;
      note.textContent = '';
    } finally {
      runBtn.disabled = false;
    }
  }
  runBtn.addEventListener('click', run);
  ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
}
