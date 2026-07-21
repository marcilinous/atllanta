import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, initials, avColor } from '../../js/ui.js';

export default async function leaveReport(container) {
  const org = getOrg();
  const membership = getMembership();
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);

  const currentYear = new Date().getFullYear();

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Leave Report</h1>
      <p class="page-subtitle">Leave usage breakdown by employee</p>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
        <span class="card-title">Report</span>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <select class="form-input" id="lr-year" style="height:34px;width:auto">
            <option value="${currentYear - 1}">${currentYear - 1}</option>
            <option value="${currentYear}" selected>${currentYear}</option>
          </select>
          <button class="btn btn-secondary btn-sm" id="lr-export">Export CSV</button>
        </div>
      </div>
      <div id="lr-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:var(--space-3);padding:var(--space-4)">
        <div class="stat-card"><div class="stat-label">Total Requests</div><div class="stat-value" id="lr-total">—</div></div>
        <div class="stat-card"><div class="stat-label">Approved</div><div class="stat-value" id="lr-approved">—</div></div>
        <div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value" id="lr-pending">—</div></div>
        <div class="stat-card"><div class="stat-label">Rejected</div><div class="stat-value" id="lr-rejected">—</div></div>
      </div>
      <div id="lr-table"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text" style="width:60%"></div></div></div>
    </div>
  `;

  if (!org) return;

  let reportData = [];

  async function loadReport() {
    const year = parseInt(document.getElementById('lr-year').value);
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const [{ data: requests, error: reqErr }, { data: balances, error: balErr }] = await Promise.all([
      sb.from('leave_requests')
        .select('*, user:user_id(full_name, email), leave_type:leave_type_id(name, code)')
        .gte('start_date', startDate)
        .lte('start_date', endDate)
        .order('start_date'),
      sb.from('leave_balances')
        .select('*, user:user_id(full_name, email), leave_type:leave_type_id(name, code)')
        .eq('year', year),
    ]);
    if (reqErr) { toast('Failed to load leave requests: ' + reqErr.message); return; }
    if (balErr) toast('Failed to load leave balances: ' + balErr.message);

    const allRequests = requests || [];
    const allBalances = balances || [];

    document.getElementById('lr-total').textContent = allRequests.length;
    document.getElementById('lr-approved').textContent = allRequests.filter(r => r.status === 'approved').length;
    document.getElementById('lr-pending').textContent = allRequests.filter(r => r.status === 'pending').length;
    document.getElementById('lr-rejected').textContent = allRequests.filter(r => r.status === 'rejected').length;

    const byUser = {};
    allBalances.forEach(b => {
      const uid = b.user_id;
      if (!byUser[uid]) {
        byUser[uid] = {
          name: b.user?.full_name || b.user?.email || 'Unknown',
          email: b.user?.email || '',
          types: {},
          totalUsed: 0,
          totalBalance: 0,
        };
      }
      const typeName = b.leave_type?.code || b.leave_type?.name || '—';
      byUser[uid].types[typeName] = {
        total: parseFloat(b.opening_balance || 0) + parseFloat(b.accrued || 0),
        used: parseFloat(b.used || 0),
        balance: parseFloat(b.balance || 0),
      };
      byUser[uid].totalUsed += parseFloat(b.used || 0);
      byUser[uid].totalBalance += parseFloat(b.balance || 0);
    });

    allRequests.forEach(r => {
      const uid = r.user_id;
      if (!byUser[uid]) {
        byUser[uid] = {
          name: r.user?.full_name || r.user?.email || 'Unknown',
          email: r.user?.email || '',
          types: {},
          totalUsed: 0,
          totalBalance: 0,
        };
      }
    });

    reportData = Object.entries(byUser).map(([id, u]) => ({ id, ...u }));

    const leaveTypeCodes = [...new Set(allBalances.map(b => b.leave_type?.code || b.leave_type?.name).filter(Boolean))];

    const tableEl = document.getElementById('lr-table');
    if (!reportData.length) {
      tableEl.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No leave data for this year</div>`;
      return;
    }

    tableEl.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr>
        <th>Employee</th>
        ${leaveTypeCodes.map(c => `<th style="text-align:center">${esc(c)}</th>`).join('')}
        <th style="text-align:center">Total Used</th>
        <th style="text-align:center">Balance</th>
      </tr></thead>
      <tbody>${reportData.map(u => {
        return `<tr>
          <td>
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <div style="width:28px;height:28px;border-radius:var(--radius-full);background:${avColor(u.name)};display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(u.name)}</div>
              <div style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(u.name)}</div>
            </div>
          </td>
          ${leaveTypeCodes.map(c => {
            const t = u.types[c];
            return `<td style="text-align:center">${t ? `<span style="color:var(--color-error)">${t.used}</span> / ${t.total}` : '—'}</td>`;
          }).join('')}
          <td style="text-align:center;font-weight:var(--font-weight-semibold);color:var(--color-error)">${u.totalUsed}</td>
          <td style="text-align:center;font-weight:var(--font-weight-semibold);color:var(--color-success)">${u.totalBalance}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  await loadReport();
  document.getElementById('lr-year').addEventListener('change', loadReport);

  document.getElementById('lr-export').addEventListener('click', () => {
    if (!reportData.length) return;
    const headers = 'Employee,Email,Total Used,Total Balance\n';
    const rows = reportData.map(u => `"${u.name}","${u.email}",${u.totalUsed},${u.totalBalance}`).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `leave_report_${document.getElementById('lr-year').value}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
