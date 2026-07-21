import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

export default async function employeeImport(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  if (!isAdmin) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Access denied</div><div class="empty-state-desc">Only admins can import employees.</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Import Employees</h1>
      <p class="page-subtitle">Bulk import employees from a CSV file</p>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6)">
      <div class="card">
        <div class="card-header"><span class="card-title">Upload CSV</span></div>
        <div class="card-body">
          <div style="border:2px dashed var(--color-border);border-radius:var(--radius-lg);padding:var(--space-8);text-align:center;cursor:pointer;transition:border-color var(--transition-fast)" id="drop-zone">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="2" width="40" height="40" style="margin:0 auto var(--space-3)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <div style="font-weight:var(--font-weight-medium);margin-bottom:var(--space-1)">Drop CSV file here or click to browse</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Supports .csv files</div>
            <input type="file" accept=".csv" id="csv-input" style="display:none">
          </div>
          <div id="file-info" class="hidden" style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--color-text-secondary)"></div>
          <div id="import-actions" class="hidden" style="margin-top:var(--space-4);display:flex;gap:var(--space-3)">
            <button class="btn btn-primary" id="import-btn">Import Employees</button>
            <button class="btn btn-secondary" id="clear-btn">Clear</button>
          </div>
          <div id="import-progress" class="hidden" style="margin-top:var(--space-4)">
            <div style="height:6px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);overflow:hidden">
              <div id="progress-bar" style="width:0%;height:100%;background:var(--color-accent);border-radius:var(--radius-full);transition:width 0.3s ease"></div>
            </div>
            <div id="progress-text" style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:var(--space-2)"></div>
          </div>
          <div id="import-result" class="hidden" style="margin-top:var(--space-4)"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">CSV Format</span></div>
        <div class="card-body">
          <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-3)">Your CSV should include the following columns:</p>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Column</th><th>Required</th><th>Example</th></tr></thead>
            <tbody>
              <tr><td style="font-weight:var(--font-weight-medium)">full_name</td><td><span class="badge badge-error">Required</span></td><td>Ravi Kumar</td></tr>
              <tr><td style="font-weight:var(--font-weight-medium)">email</td><td><span class="badge badge-error">Required</span></td><td>ravi@example.com</td></tr>
              <tr><td style="font-weight:var(--font-weight-medium)">phone</td><td><span class="badge badge-neutral">Optional</span></td><td>+919876543210</td></tr>
              <tr><td style="font-weight:var(--font-weight-medium)">designation</td><td><span class="badge badge-neutral">Optional</span></td><td>Software Engineer</td></tr>
              <tr><td style="font-weight:var(--font-weight-medium)">role</td><td><span class="badge badge-neutral">Optional</span></td><td>member</td></tr>
              <tr><td style="font-weight:var(--font-weight-medium)">date_of_joining</td><td><span class="badge badge-neutral">Optional</span></td><td>2024-01-15</td></tr>
            </tbody>
          </table></div>
          <button class="btn btn-secondary btn-sm" id="download-template" style="margin-top:var(--space-3)">Download Template</button>
        </div>
      </div>
    </div>
    <div id="preview-section" class="hidden" style="margin-top:var(--space-6)">
      <div class="card">
        <div class="card-header"><span class="card-title">Preview</span><span id="preview-count" style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-left:var(--space-2)"></span></div>
        <div id="preview-table" style="max-height:400px;overflow:auto"></div>
      </div>
    </div>
  `;

  if (!org) return;

  let parsedRows = [];

  const dropZone = document.getElementById('drop-zone');
  const csvInput = document.getElementById('csv-input');

  dropZone.addEventListener('click', () => csvInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--color-accent)'; });
  dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--color-border)'; });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--color-border)';
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  csvInput.addEventListener('change', () => {
    if (csvInput.files.length) handleFile(csvInput.files[0]);
  });

  document.getElementById('download-template').addEventListener('click', () => {
    const csv = 'full_name,email,phone,designation,role,date_of_joining\nJohn Doe,john@example.com,+919876543210,Software Engineer,member,2024-01-15\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'employee_import_template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));
    return lines.slice(1).map(line => {
      const vals = [];
      let current = '';
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ',' && !inQuotes) { vals.push(current.trim()); current = ''; continue; }
        current += ch;
      }
      vals.push(current.trim());
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
      return obj;
    });
  }

  function handleFile(file) {
    if (!file.name.endsWith('.csv')) { toast('Please upload a .csv file'); return; }
    document.getElementById('file-info').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    document.getElementById('file-info').classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = (e) => {
      parsedRows = parseCSV(e.target.result);
      if (!parsedRows.length) { toast('No data rows found in CSV'); return; }

      const errors = [];
      parsedRows.forEach((row, i) => {
        if (!row.full_name) errors.push(`Row ${i + 1}: missing full_name`);
        if (!row.email) errors.push(`Row ${i + 1}: missing email`);
      });

      if (errors.length) {
        document.getElementById('import-result').innerHTML = `<div style="color:var(--color-error);font-size:var(--text-sm)">${errors.slice(0, 10).map(e => esc(e)).join('<br>')}${errors.length > 10 ? `<br>...and ${errors.length - 10} more errors` : ''}</div>`;
        document.getElementById('import-result').classList.remove('hidden');
        return;
      }

      document.getElementById('import-actions').classList.remove('hidden');
      document.getElementById('import-result').classList.add('hidden');
      renderPreview();
    };
    reader.readAsText(file);
  }

  function renderPreview() {
    const section = document.getElementById('preview-section');
    const tableEl = document.getElementById('preview-table');
    section.classList.remove('hidden');
    document.getElementById('preview-count').textContent = `${parsedRows.length} row${parsedRows.length !== 1 ? 's' : ''}`;

    const cols = ['full_name', 'email', 'phone', 'designation', 'role', 'date_of_joining'];
    tableEl.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${parsedRows.slice(0, 50).map(row => `<tr>${cols.map(c => `<td style="font-size:var(--text-sm)">${esc(row[c] || '—')}</td>`).join('')}</tr>`).join('')}
      ${parsedRows.length > 50 ? `<tr><td colspan="${cols.length}" style="text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm)">...and ${parsedRows.length - 50} more rows</td></tr>` : ''}
      </tbody>
    </table></div>`;
  }

  document.getElementById('clear-btn').addEventListener('click', () => {
    parsedRows = [];
    csvInput.value = '';
    document.getElementById('file-info').classList.add('hidden');
    document.getElementById('import-actions').classList.add('hidden');
    document.getElementById('preview-section').classList.add('hidden');
    document.getElementById('import-result').classList.add('hidden');
    document.getElementById('import-progress').classList.add('hidden');
  });

  document.getElementById('import-btn').addEventListener('click', async () => {
    if (!parsedRows.length) return;

    const importBtn = document.getElementById('import-btn');
    importBtn.disabled = true;
    importBtn.textContent = 'Importing...';
    document.getElementById('import-progress').classList.remove('hidden');

    const validRoles = ['owner', 'admin', 'manager', 'member'];
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      const pct = Math.round(((i + 1) / parsedRows.length) * 100);
      document.getElementById('progress-bar').style.width = pct + '%';
      document.getElementById('progress-text').textContent = `Processing ${i + 1} of ${parsedRows.length}...`;

      const role = validRoles.includes(row.role) ? row.role : 'member';

      const { error } = await sb.from('memberships').insert({
        organization_id: org.id,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone || null,
        role,
        invited_at: new Date().toISOString(),
      });

      if (error) {
        if (error.message.includes('duplicate') || error.code === '23505') {
          skipped++;
        } else {
          errors.push(`Row ${i + 1} (${row.email}): ${error.message}`);
        }
      } else {
        imported++;
      }
    }

    if (imported > 0) {
      await publishEvent('people.employees.bulk_imported', { count: imported });
    }

    importBtn.disabled = false;
    importBtn.textContent = 'Import Employees';

    const resultEl = document.getElementById('import-result');
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `
      <div style="padding:var(--space-3);border-radius:var(--radius-md);background:var(--color-success-light);font-size:var(--text-sm)">
        <div style="font-weight:var(--font-weight-semibold);color:var(--color-success)">Import complete</div>
        <div>${imported} imported, ${skipped} skipped (duplicates)${errors.length ? `, ${errors.length} errors` : ''}</div>
      </div>
      ${errors.length ? `<div style="margin-top:var(--space-2);font-size:var(--text-xs);color:var(--color-error)">${errors.slice(0, 5).map(e => esc(e)).join('<br>')}</div>` : ''}
    `;
  });
}
