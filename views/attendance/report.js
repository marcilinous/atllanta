import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, formatDate, initials, avColor } from '../../js/ui.js';

export default async function attendanceReport(container) {
  const org = getOrg();
  const membership = getMembership();
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Attendance Report</h1>
      <p class="page-subtitle">Monthly attendance breakdown by employee</p>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
        <span class="card-title">Report</span>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <select class="form-input" id="rpt-month" style="height:34px;width:auto">
            ${Array.from({ length: 12 }, (_, i) => {
              const d = new Date(currentYear, i);
              return `<option value="${i}" ${i === currentMonth ? 'selected' : ''}>${d.toLocaleString('en', { month: 'long' })}</option>`;
            }).join('')}
          </select>
          <select class="form-input" id="rpt-year" style="height:34px;width:auto">
            <option value="${currentYear - 1}">${currentYear - 1}</option>
            <option value="${currentYear}" selected>${currentYear}</option>
          </select>
          <button class="btn btn-secondary btn-sm" id="rpt-export">Export CSV</button>
        </div>
      </div>
      <div id="rpt-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:var(--space-3);padding:var(--space-4)">
        <div class="stat-card"><div class="stat-label">Working Days</div><div class="stat-value" id="rpt-working">—</div></div>
        <div class="stat-card"><div class="stat-label">Avg Present</div><div class="stat-value" id="rpt-avg-present">—</div></div>
        <div class="stat-card"><div class="stat-label">Avg Hours</div><div class="stat-value" id="rpt-avg-hours">—</div></div>
        <div class="stat-card"><div class="stat-label">Total Late</div><div class="stat-value" id="rpt-total-late">—</div></div>
      </div>
      <div id="rpt-table"></div>
    </div>
  `;

  if (!org) return;

  let reportData = [];

  async function loadReport() {
    const month = parseInt(document.getElementById('rpt-month').value);
    const year = parseInt(document.getElementById('rpt-year').value);
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const { data, error: attErr } = await sb.from('attendance')
      .select('*, user:user_id(full_name, email)')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date');
    if (attErr) { toast('Failed to load report: ' + attErr.message); return; }

    const records = data || [];

    const byUser = {};
    records.forEach(a => {
      const uid = a.user_id;
      if (!byUser[uid]) {
        byUser[uid] = {
          name: a.user?.full_name || a.user?.email || 'Unknown',
          email: a.user?.email || '',
          present: 0, absent: 0, late: 0, leave: 0, halfDay: 0,
          totalHours: 0, days: 0,
        };
      }
      byUser[uid].days++;
      if (a.status === 'present') byUser[uid].present++;
      else if (a.status === 'absent') byUser[uid].absent++;
      else if (a.status === 'late') { byUser[uid].late++; byUser[uid].present++; }
      else if (a.status === 'on_leave') byUser[uid].leave++;
      else if (a.status === 'half_day') byUser[uid].halfDay++;
      if (a.total_hours) byUser[uid].totalHours += Number(a.total_hours);
    });

    reportData = Object.entries(byUser).map(([id, u]) => ({ id, ...u }));
    const totalEmployees = reportData.length || 1;

    const workingDays = new Set(records.filter(r => !['holiday', 'weekly_off'].includes(r.status)).map(r => r.date)).size || daysInMonth;
    const avgPresent = reportData.length ? (reportData.reduce((s, u) => s + u.present, 0) / totalEmployees).toFixed(1) : '—';
    const avgHours = reportData.length ? (reportData.reduce((s, u) => s + u.totalHours, 0) / totalEmployees).toFixed(1) : '—';
    const totalLate = reportData.reduce((s, u) => s + u.late, 0);

    document.getElementById('rpt-working').textContent = workingDays;
    document.getElementById('rpt-avg-present').textContent = avgPresent;
    document.getElementById('rpt-avg-hours').textContent = avgHours;
    document.getElementById('rpt-total-late').textContent = totalLate;

    const tableEl = document.getElementById('rpt-table');
    if (!reportData.length) {
      tableEl.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No attendance data for this period</div>`;
      return;
    }

    tableEl.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Employee</th><th>Present</th><th>Absent</th><th>Late</th><th>Leave</th><th>Half Day</th><th>Total Hours</th><th>Avg Hours/Day</th></tr></thead>
      <tbody>${reportData.map(u => {
        const avgPerDay = u.present > 0 ? (u.totalHours / u.present).toFixed(1) : '—';
        return `<tr>
          <td>
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <div style="width:28px;height:28px;border-radius:var(--radius-full);background:${avColor(u.name)};display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(u.name)}</div>
              <div>
                <div style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(u.name)}</div>
              </div>
            </div>
          </td>
          <td style="color:var(--color-success);font-weight:var(--font-weight-medium)">${u.present}</td>
          <td style="color:var(--color-error)">${u.absent}</td>
          <td style="color:var(--color-warning)">${u.late}</td>
          <td>${u.leave}</td>
          <td>${u.halfDay}</td>
          <td style="font-weight:var(--font-weight-medium)">${u.totalHours.toFixed(1)}</td>
          <td>${avgPerDay}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  await loadReport();
  document.getElementById('rpt-month').addEventListener('change', loadReport);
  document.getElementById('rpt-year').addEventListener('change', loadReport);

  document.getElementById('rpt-export').addEventListener('click', () => {
    if (!reportData.length) return;
    const headers = 'Employee,Email,Present,Absent,Late,Leave,Half Day,Total Hours\n';
    const rows = reportData.map(u => `"${u.name}","${u.email}",${u.present},${u.absent},${u.late},${u.leave},${u.halfDay},${u.totalHours.toFixed(1)}`).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `attendance_report_${document.getElementById('rpt-year').value}_${parseInt(document.getElementById('rpt-month').value) + 1}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
