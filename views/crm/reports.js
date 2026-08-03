import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, downloadCsv, loadingSkeleton, parseCsv, formatDate } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { navigate } from '../../js/router.js';

const REPORT_TYPES = ['Renewals (TSS)', 'Sales', 'Licenses', 'Payments', 'Support', 'Other'];
const SITE_ID_RE = /^(site[\s_-]*id|siteid|external[\s_-]*id|site)$/i;

export default async function crmReports(container) {
  const org = getOrg();
  const user = getUser();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  let imports = [];
  let siteMap = null; // Site ID -> account_id, built lazily (7k+ accounts)

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

  function detectSiteCol(cols) {
    return cols.find(c => SITE_ID_RE.test(c)) || cols.find(c => /site/i.test(c)) || '';
  }

  function openImport() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div style="display:grid;gap:var(--space-3)">
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">
          Upload a report CSV. Every row is stored as-is; we just need to know which column is the <strong>Site ID</strong> so it can link to a partner.
        </div>
        <div class="crm-cols-2">
          <div><label class="form-label">Report name</label><input class="form-input" id="rep-name" placeholder="e.g. TSS Renewals — Aug 2026"></div>
          <div><label class="form-label">Type</label><input class="form-input" id="rep-type" list="rep-types" placeholder="Renewals (TSS)">
            <datalist id="rep-types">${REPORT_TYPES.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
        </div>
        <input type="file" accept=".csv,text/csv" class="form-input" id="rep-file">
        <div id="rep-sitecol-wrap" style="display:none">
          <label class="form-label">Site ID column</label>
          <select class="form-input" id="rep-sitecol"></select>
        </div>
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
    const siteWrap = wrap.querySelector('#rep-sitecol-wrap');
    const siteSel = wrap.querySelector('#rep-sitecol');
    const preview = wrap.querySelector('#rep-preview');
    const go = wrap.querySelector('#rep-go');
    let fileName = '';

    wrap.querySelector('#rep-cancel').addEventListener('click', closeModal);

    async function refreshPreview() {
      if (!rows.length) { preview.textContent = ''; go.disabled = true; return; }
      const siteCol = siteSel.value;
      const map = await ensureSiteMap();
      let matched = 0;
      for (const r of rows) { const sid = siteCol ? String(r[siteCol] ?? '').trim() : ''; if (sid && map.has(sid)) matched++; }
      const unmatched = rows.length - matched;
      preview.innerHTML = `Ready to import <strong>${rows.length.toLocaleString('en-IN')}</strong> rows across ${cols.length} columns — `
        + `${matched.toLocaleString('en-IN')} matched to a partner`
        + `${unmatched ? `, <span style="color:var(--color-warning)">${unmatched.toLocaleString('en-IN')} unmatched</span>` : ''}.`;
      go.disabled = false;
    }

    wrap.querySelector('#rep-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      fileName = file.name;
      if (!nameEl.value.trim()) nameEl.value = file.name.replace(/\.csv$/i, '');
      const text = await file.text();
      rows = parseCsv(text);
      cols = rows.length ? Object.keys(rows[0]) : [];
      if (!rows.length) { preview.innerHTML = `<span style="color:var(--color-error)">No rows found. Check the file.</span>`; go.disabled = true; siteWrap.style.display = 'none'; return; }
      const detected = detectSiteCol(cols);
      siteSel.innerHTML = `<option value="">— none —</option>` + cols.map(c => `<option value="${esc(c)}"${c === detected ? ' selected' : ''}>${esc(c)}</option>`).join('');
      siteWrap.style.display = '';
      await refreshPreview();
    });
    siteSel.addEventListener('change', refreshPreview);

    go.addEventListener('click', async () => {
      const name = nameEl.value.trim() || fileName || 'Report';
      const reportType = typeEl.value.trim() || null;
      const siteCol = siteSel.value;
      go.disabled = true;
      const map = await ensureSiteMap();

      const { data: imp, error: impErr } = await sb.from('crm_report_imports').insert({
        org_id: org.id, name, report_type: reportType, source_filename: fileName || null,
        columns: cols, site_id_column: siteCol || null, imported_by: user?.id || null,
      }).select('id').single();
      if (impErr || !imp) { toast('Could not start import'); go.disabled = false; return; }

      const payload = rows.map(r => {
        const sid = siteCol ? String(r[siteCol] ?? '').trim() : '';
        return {
          org_id: org.id, import_id: imp.id, report_type: reportType,
          site_id: sid || null, account_id: (sid && map.get(sid)) || null, data: r,
        };
      });

      let done = 0, failed = 0, matched = 0;
      const CHUNK = 500;
      for (let i = 0; i < payload.length; i += CHUNK) {
        go.textContent = `Importing… ${done.toLocaleString('en-IN')}/${payload.length.toLocaleString('en-IN')}`;
        const slice = payload.slice(i, i + CHUNK);
        const { error } = await sb.from('crm_report_rows').insert(slice);
        if (error) { failed += slice.length; }
        else { done += slice.length; matched += slice.filter(r => r.account_id).length; }
      }
      await sb.from('crm_report_imports').update({ row_count: done, matched_count: matched }).eq('id', imp.id);
      await logAction('crm', 'report_import', imp.id, 'imported', null, { name, rows: done, matched });
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
