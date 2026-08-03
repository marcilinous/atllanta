import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, downloadCsv, loadingSkeleton, parseCsv, formatDate } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { navigate } from '../../js/router.js';
import { fetchOrgUsers } from './common.js';

const REPORT_TYPES = ['Renewals (TSS)', 'Sales', 'Licenses', 'Payments', 'Support', 'Other'];
const SITE_ID_RE = /^(site[\s_-]*id|siteid|external[\s_-]*id|site)$/i;
// Columns that name the staff member who did the activity (not the partner's own contact).
const PERSON_RE = /(allocated employee|visited by|created by|called by|caller|executive name|salesperson|\bbde\b|\btl\b|\bcm\b|telecaller|employee name)/i;

// Canonical columns for the Tally TSS AP scorecard (matches the flatten below).
const TSS_COLS = ['account_id_tally', 'site_id', 'partner_name', 'role', 'district', 'region', 'state', 'yau_cb',
  'old_cb', 'old_ach', 'lfy_cb', 'lfy_ach', 'tfy_cb', 'tfy_ach', 'cm_cb', 'cm_ach',
  'te9_cb', 'te9_ach', 'tpca_cb', 'tpca_ach', 'waba_cb', 'waba_ach'];

// SheetJS is only needed for Excel uploads — load it lazily from CDN.
let _xlsxLib = null;
async function loadXlsx() {
  if (!_xlsxLib) _xlsxLib = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  return _xlsxLib;
}

const cell = (v) => (v === undefined || v === null || v === '') ? '' : v;
const idStr = (v) => (v === undefined || v === null || v === '') ? '' : (typeof v === 'number' ? String(Math.round(v)) : String(v).trim());

// Flatten the Tally TSS "AP" sheet (two-row grouped header + totals band) into
// clean canonical rows keyed on site_id. Returns null if it isn't that shape.
function flattenTssAP(XLSX, wb) {
  const ws = wb.Sheets['AP'];
  if (!ws) return null;
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
  let h = -1;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    if ((aoa[i] || []).some(c => String(c).trim().toLowerCase() === 'site id')) { h = i; break; }
  }
  if (h < 0) return null;
  const out = [];
  for (let i = h + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (r[1] === undefined || r[1] === null || r[1] === '') continue; // needs a Site ID
    out.push({
      account_id_tally: idStr(r[0]), site_id: idStr(r[1]), partner_name: cell(r[2]),
      role: cell(r[3]), district: cell(r[4]), region: cell(r[5]), state: cell(r[6]),
      yau_cb: cell(r[7]),
      old_cb: cell(r[8]), old_ach: cell(r[9]), lfy_cb: cell(r[11]), lfy_ach: cell(r[12]),
      tfy_cb: cell(r[14]), tfy_ach: cell(r[15]), cm_cb: cell(r[17]), cm_ach: cell(r[18]),
      te9_cb: cell(r[20]), te9_ach: cell(r[21]), tpca_cb: cell(r[23]), tpca_ach: cell(r[24]),
      waba_cb: cell(r[26]), waba_ach: cell(r[27]),
    });
  }
  return out.length ? out : null;
}

// Read any supported file into { rows, cols, forcedSite, tss }.
async function readReportFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'csv' || file.type === 'text/csv') {
    const rows = parseCsv(await file.text());
    return { rows, cols: rows.length ? Object.keys(rows[0]) : [], forcedSite: null, tss: false };
  }
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const tss = flattenTssAP(XLSX, wb);
  if (tss) return { rows: tss, cols: TSS_COLS, forcedSite: 'site_id', tss: true };
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return { rows, cols: rows.length ? Object.keys(rows[0]) : [], forcedSite: null, tss: false };
}

export default async function crmReports(container) {
  const org = getOrg();
  const user = getUser();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  let imports = [];
  let siteMap = null;   // Site ID -> account_id, built lazily (7k+ accounts)
  let peopleMap = null; // lower(full_name) -> user id

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><button class="btn btn-ghost btn-sm" id="back">← CRM</button></div>
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Reports</h1>
        <p class="page-subtitle">Drop any partner report here — renewals, sales, licenses, payments. Rows are stored raw and keyed on <strong>Site ID</strong>, ready to wire into accounts later.</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-primary" id="import-report">+ Import report</button>
      </div>
    </div>
    <div class="card"><div id="reports-list">${loadingSkeleton()}</div></div>
  `;
  container.querySelector('#back').addEventListener('click', () => navigate('crm'));
  container.querySelector('#import-report').addEventListener('click', openImport);

  async function load() {
    const { data } = await sb.from('crm_report_imports').select('*').order('created_at', { ascending: false });
    imports = data || [];
    render();
  }

  function render() {
    const el = container.querySelector('#reports-list');
    if (!imports.length) {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">No reports yet</div>
        <div class="empty-state-desc">Import your first Tally report — as long as it carries a Site ID, we'll match it to partners.</div>
      </div>`;
      return;
    }
    el.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Report</th><th>Type</th><th>Rows</th><th>Matched to partner</th><th>Imported</th><th></th></tr></thead>
      <tbody>${imports.map(r => {
        const pct = r.row_count ? Math.round((r.matched_count / r.row_count) * 100) : 0;
        return `<tr>
          <td style="font-weight:var(--font-weight-medium)">${esc(r.name)}${r.source_filename ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(r.source_filename)}</div>` : ''}</td>
          <td>${r.report_type ? esc(r.report_type) : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>
          <td>${(r.row_count || 0).toLocaleString('en-IN')}</td>
          <td>${(r.matched_count || 0).toLocaleString('en-IN')} <span style="color:var(--color-text-tertiary)">(${pct}%)</span></td>
          <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${formatDate(r.created_at)}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-ghost btn-sm" data-preview="${r.id}">Preview</button>
            <button class="btn btn-ghost btn-sm" data-export="${r.id}">Export</button>
            <button class="btn btn-ghost btn-sm" data-delete="${r.id}" style="color:var(--color-error)">Delete</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    el.querySelectorAll('[data-preview]').forEach(b => b.addEventListener('click', () => previewReport(imports.find(r => r.id === b.dataset.preview))));
    el.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => exportReport(imports.find(r => r.id === b.dataset.export))));
    el.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => deleteReport(imports.find(r => r.id === b.dataset.delete))));
  }

  async function ensureSiteMap() {
    if (siteMap) return siteMap;
    siteMap = new Map();
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from('crm_accounts')
        .select('id, external_id')
        .not('external_id', 'is', null)
        .range(from, from + pageSize - 1);
      if (error || !data || !data.length) break;
      data.forEach(a => { const k = String(a.external_id).trim(); if (k) siteMap.set(k, a.id); });
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return siteMap;
  }

  async function ensurePeopleMap() {
    if (peopleMap) return peopleMap;
    peopleMap = new Map();
    const users = await fetchOrgUsers();
    (users || []).forEach(u => { if (u.full_name) peopleMap.set(u.full_name.toLowerCase(), u.id); });
    return peopleMap;
  }

  function detectSiteCol(cols) {
    return cols.find(c => SITE_ID_RE.test(c)) || cols.find(c => /site/i.test(c)) || '';
  }
  function detectPersonCol(cols) {
    return cols.find(c => PERSON_RE.test(c)) || '';
  }

  function openImport() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div style="display:grid;gap:var(--space-3)">
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">
          Drop the raw Tally file (<strong>.xlsb</strong> / <strong>.xlsx</strong>) or a CSV. Rows link to a partner by <strong>Site ID</strong> and/or to a staff member by <strong>person name</strong> (BDE/TL/CM/Telecaller) — pick whichever columns apply below.
        </div>
        <div class="crm-cols-2">
          <div><label class="form-label">Report name</label><input class="form-input" id="rep-name" placeholder="e.g. TSS Renewals — Aug 2026"></div>
          <div><label class="form-label">Type</label><input class="form-input" id="rep-type" list="rep-types" placeholder="Renewals (TSS)">
            <datalist id="rep-types">${REPORT_TYPES.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
        </div>
        <input type="file" accept=".csv,.xlsx,.xlsb,text/csv" class="form-input" id="rep-file">
        <div class="crm-cols-2" id="rep-cols-wrap" style="display:none">
          <div>
            <label class="form-label">Site ID column <span style="color:var(--color-text-tertiary)">(partner)</span></label>
            <select class="form-input" id="rep-sitecol"></select>
          </div>
          <div>
            <label class="form-label">Person column <span style="color:var(--color-text-tertiary)">(staff)</span></label>
            <select class="form-input" id="rep-personcol"></select>
          </div>
        </div>
        <label style="display:flex;gap:var(--space-2);align-items:center;font-size:var(--text-sm);color:var(--color-text-secondary)">
          <input type="checkbox" id="rep-snapshot"> Replace the previous import of this type (daily snapshot)
        </label>
        <div id="rep-preview" style="font-size:var(--text-sm);color:var(--color-text-secondary)"></div>
        <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
          <button type="button" class="btn btn-secondary" id="rep-cancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="rep-go" disabled>Import</button>
        </div>
      </div>`;

    let rows = [];       // parsed row objects
    let cols = [];       // column keys
    const nameEl = wrap.querySelector('#rep-name');
    const typeEl = wrap.querySelector('#rep-type');
    const colsWrap = wrap.querySelector('#rep-cols-wrap');
    const siteSel = wrap.querySelector('#rep-sitecol');
    const personSel = wrap.querySelector('#rep-personcol');
    const snapshotEl = wrap.querySelector('#rep-snapshot');
    const preview = wrap.querySelector('#rep-preview');
    const go = wrap.querySelector('#rep-go');
    let fileName = '';

    wrap.querySelector('#rep-cancel').addEventListener('click', closeModal);

    async function refreshPreview() {
      if (!rows.length) { preview.textContent = ''; go.disabled = true; return; }
      const siteCol = siteSel.value;
      const personCol = personSel.value;
      const map = siteCol ? await ensureSiteMap() : null;
      const pmap = personCol ? await ensurePeopleMap() : null;
      let partner = 0, person = 0;
      for (const r of rows) {
        if (map) { const sid = String(r[siteCol] ?? '').trim(); if (sid && map.has(sid)) partner++; }
        if (pmap) { const nm = String(r[personCol] ?? '').trim().toLowerCase(); if (nm && pmap.has(nm)) person++; }
      }
      const parts = [];
      if (siteCol) parts.push(`${partner.toLocaleString('en-IN')} linked to a partner`);
      if (personCol) parts.push(`${person.toLocaleString('en-IN')} linked to staff`);
      preview.innerHTML = `Ready to import <strong>${rows.length.toLocaleString('en-IN')}</strong> rows across ${cols.length} columns`
        + (parts.length ? ` — ${parts.join(', ')}.` : `. <span style="color:var(--color-warning)">Pick a Site ID or Person column so rows can be linked.</span>`);
      go.disabled = false;
    }

    wrap.querySelector('#rep-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      fileName = file.name;
      if (!nameEl.value.trim()) nameEl.value = file.name.replace(/\.(csv|xlsx|xlsb)$/i, '');
      preview.textContent = 'Reading file…';
      go.disabled = true;
      let parsedFile;
      try { parsedFile = await readReportFile(file); }
      catch (err) { preview.innerHTML = `<span style="color:var(--color-error)">Could not read that file. Try exporting it as CSV.</span>`; colsWrap.style.display = 'none'; return; }
      rows = parsedFile.rows || [];
      cols = parsedFile.cols || [];
      if (!rows.length) { preview.innerHTML = `<span style="color:var(--color-error)">No rows found. Check the file.</span>`; colsWrap.style.display = 'none'; return; }
      if (parsedFile.tss) {
        if (!typeEl.value.trim()) typeEl.value = 'Renewals (TSS)';
        snapshotEl.checked = true;
      }
      const detectedSite = parsedFile.forcedSite || detectSiteCol(cols);
      const detectedPerson = detectPersonCol(cols);
      const opts = (sel) => `<option value="">— none —</option>` + cols.map(c => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(c)}</option>`).join('');
      siteSel.innerHTML = opts(detectedSite);
      personSel.innerHTML = opts(detectedPerson);
      colsWrap.style.display = '';
      await refreshPreview();
    });
    siteSel.addEventListener('change', refreshPreview);
    personSel.addEventListener('change', refreshPreview);

    go.addEventListener('click', async () => {
      const name = nameEl.value.trim() || fileName || 'Report';
      const reportType = typeEl.value.trim() || null;
      const siteCol = siteSel.value;
      const personCol = personSel.value;
      go.disabled = true;
      const map = siteCol ? await ensureSiteMap() : null;
      const pmap = personCol ? await ensurePeopleMap() : null;

      const { data: imp, error: impErr } = await sb.from('crm_report_imports').insert({
        org_id: org.id, name, report_type: reportType, source_filename: fileName || null,
        columns: cols, site_id_column: siteCol || null, person_column: personCol || null, imported_by: user?.id || null,
      }).select('id').single();
      if (impErr || !imp) { toast('Could not start import'); go.disabled = false; return; }

      const payload = rows.map(r => {
        const sid = siteCol ? String(r[siteCol] ?? '').trim() : '';
        const pnm = personCol ? String(r[personCol] ?? '').trim() : '';
        return {
          org_id: org.id, import_id: imp.id, report_type: reportType,
          site_id: sid || null, account_id: (map && sid && map.get(sid)) || null,
          person_name: pnm || null, person_user_id: (pmap && pnm && pmap.get(pnm.toLowerCase())) || null,
          data: r,
        };
      });

      let done = 0, failed = 0, matched = 0;
      const CHUNK = 500;
      for (let i = 0; i < payload.length; i += CHUNK) {
        go.textContent = `Importing… ${done.toLocaleString('en-IN')}/${payload.length.toLocaleString('en-IN')}`;
        const slice = payload.slice(i, i + CHUNK);
        const { error } = await sb.from('crm_report_rows').insert(slice);
        if (error) { failed += slice.length; }
        else { done += slice.length; matched += slice.filter(r => r.account_id || r.person_user_id).length; }
      }
      await sb.from('crm_report_imports').update({ row_count: done, matched_count: matched }).eq('id', imp.id);
      await logAction('crm', 'report_import', imp.id, 'imported', null, { name, rows: done, matched });

      // Daily snapshot: drop older imports of the same type (rows cascade).
      if (snapshotEl.checked && reportType) {
        await sb.from('crm_report_imports').delete().eq('org_id', org.id).eq('report_type', reportType).neq('id', imp.id);
      }
      toast(`Imported ${done.toLocaleString('en-IN')} rows${failed ? ` · ${failed} failed` : ''} · ${matched.toLocaleString('en-IN')} matched`);
      closeModal();
      load();
    });

    openModal('Import report', wrap);
  }

  async function previewReport(rep) {
    const body = document.createElement('div');
    body.innerHTML = loadingSkeleton(4);
    openModal(`${rep.name} — first 25 rows`, body);
    const { data } = await sb.from('crm_report_rows').select('site_id, account_id, data').eq('import_id', rep.id).limit(25);
    const list = data || [];
    if (!list.length) { body.innerHTML = `<div class="empty-state"><div class="empty-state-desc">No rows.</div></div>`; return; }
    const cols = (rep.columns && rep.columns.length) ? rep.columns : Object.keys(list[0].data || {});
    body.innerHTML = `<div class="table-wrap" style="max-height:60vh;overflow:auto"><table class="table">
      <thead><tr><th>Match</th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${list.map(r => `<tr>
        <td>${r.account_id ? '<span class="badge badge-success" style="font-size:10px">linked</span>' : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>
        ${cols.map(c => `<td>${esc(String(r.data?.[c] ?? ''))}</td>`).join('')}
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  async function exportReport(rep) {
    toast('Preparing export…');
    const out = [];
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await sb.from('crm_report_rows').select('data').eq('import_id', rep.id).range(from, from + pageSize - 1);
      if (error || !data || !data.length) break;
      data.forEach(r => out.push(r.data || {}));
      if (data.length < pageSize) break;
      from += pageSize;
    }
    if (!out.length) return toast('Nothing to export');
    downloadCsv(`${rep.name.replace(/[^\w.-]+/g, '_')}.csv`, out);
  }

  async function deleteReport(rep) {
    if (!confirm(`Delete "${rep.name}" and its ${(rep.row_count || 0).toLocaleString('en-IN')} rows? This cannot be undone.`)) return;
    const { error } = await sb.from('crm_report_imports').delete().eq('id', rep.id);
    if (error) return toast('Could not delete report');
    await logAction('crm', 'report_import', rep.id, 'deleted', rep, null);
    toast('Report deleted');
    load();
  }

  await load();
}
