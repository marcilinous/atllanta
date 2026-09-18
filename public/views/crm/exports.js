import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, toast, backButton } from '../../js/ui.js';
import { exportCSV } from '../../js/csv.js';

// CRM › Reports & exports. Canned CSV downloads for the MIS / analyst team.
// Every report runs under anon+RLS, so it only ever pulls the caller's org data.
// Raw-table dumps derive columns from the rows; RPC reports use fixed columns.

const iso = (d) => d.toISOString().slice(0, 10);
function fyWindow(offset = 0) {
  const n = new Date();
  const fy = (n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1) + offset;
  return { from: `${fy}-04-01`, to: `${fy + 1}-03-31`, label: `FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}` };
}
const colsFromRows = (rows) => rows.length ? Object.keys(rows[0]).map(k => ({ key: k, label: k })) : [];

export default async function crmExports(container) {
  const org = getOrg();
  const cfy = fyWindow(0), lfy = fyWindow(-1);

  const REPORTS = [
    { id: 'partners', title: 'Partner master', desc: 'Full crm_partner_details directory',
      run: async () => tableDump('crm_partner_details', 'partner_name') },
    { id: 'visits', title: 'Visits log', desc: 'Every field visit (registered + unregistered)',
      run: async () => tableDump('crm_visits', 'visited_at', false) },
    { id: 'calls', title: 'Calls log', desc: 'Telecaller call & follow-up records',
      run: async () => tableDump('crm_calls', 'called_at', false) },
    { id: 'leads', title: 'Leads', desc: 'Lead pipeline with stage & follow-up',
      run: async () => tableDump('crm_leads', 'created_at', false) },
    { id: 'sales-region', title: `Sales by region · ${cfy.label}`, desc: 'Revenue & units by region × category',
      run: async () => salesBy('region', cfy) },
    { id: 'sales-tier', title: `Sales by tier · ${cfy.label}`, desc: 'Revenue & units by partner tier × category',
      run: async () => salesBy('role', cfy) },
    { id: 'opp', title: `Partner opportunity · ${lfy.label} vs ${cfy.label}`, desc: 'Per-partner TP / TSS / value, both years',
      run: async () => opportunity(lfy, cfy) },
  ];

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title" style="margin:0">Reports &amp; exports</h1>
        <p class="page-subtitle" style="margin:0">${esc(org?.name || '')} · download CSVs for MIS &amp; analysts</p>
      </div>
      ${backButton('crm')}
    </div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
      ${REPORTS.map(r => `<div class="card"><div class="card-body">
        <div style="font-weight:var(--font-weight-semibold);margin-bottom:var(--space-1)">${esc(r.title)}</div>
        <div class="u-sm-muted" style="margin-bottom:var(--space-3)">${esc(r.desc)}</div>
        <button class="btn btn-secondary btn-sm" data-rep="${r.id}">Download CSV</button>
      </div></div>`).join('')}
    </div>
  `;
  if (!org) return;

  container.querySelectorAll('[data-rep]').forEach(b => b.addEventListener('click', async () => {
    const rep = REPORTS.find(r => r.id === b.dataset.rep);
    b.disabled = true; const label = b.textContent; b.textContent = 'Preparing…';
    try { await rep.run(); } catch (e) { toast('Export failed: ' + (e.message || e)); }
    b.disabled = false; b.textContent = label;
  }));

  const stamp = () => new Date().toISOString().slice(0, 10);

  async function tableDump(table, orderCol, asc = true) {
    const { data, error } = await sb.from(table).select('*').order(orderCol, { ascending: asc }).limit(50000);
    if (error) throw error;
    if (!(data || []).length) { toast('No rows to export.'); return; }
    exportCSV(`${table}-${stamp()}`, data, colsFromRows(data));
    toast(`Exported ${data.length.toLocaleString('en-IN')} rows`);
  }

  async function salesBy(dim, win) {
    const { data, error } = await sb.rpc('crm_sales_by', { p_dim: dim, p_from: win.from, p_to: win.to });
    if (error) throw error;
    exportCSV(`sales-by-${dim}-${win.label}-${stamp()}`, data || [], [
      { key: 'bucket', label: dim === 'role' ? 'Tier' : 'Region' }, { key: 'channel', label: 'Channel' },
      { key: 'category', label: 'Category' }, { key: 'sales_count', label: 'Units' }, { key: 'revenue', label: 'Revenue' },
    ]);
    toast(`Exported ${(data || []).length.toLocaleString('en-IN')} rows`);
  }

  async function opportunity(a, b) {
    const { data, error } = await sb.rpc('crm_partner_opportunity', { p_a_from: a.from, p_a_to: a.to, p_b_from: b.from, p_b_to: b.to });
    if (error) throw error;
    exportCSV(`partner-opportunity-${stamp()}`, data || [], [
      { key: 'partner_name', label: 'Partner' }, { key: 'region', label: 'Region' }, { key: 'hub', label: 'Hub' }, { key: 'tier', label: 'Tier' },
      { key: 'a_tp', label: `TP ${a.label}` }, { key: 'a_tss', label: `TSS ${a.label}` }, { key: 'a_value', label: `Value ${a.label}` },
      { key: 'b_tp', label: `TP ${b.label}` }, { key: 'b_tss', label: `TSS ${b.label}` }, { key: 'b_value', label: `Value ${b.label}` },
      { key: 'last_activity', label: 'Last activity' },
    ]);
    toast(`Exported ${(data || []).length.toLocaleString('en-IN')} partners`);
  }
}
