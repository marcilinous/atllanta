import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, formatDate, initials, avColor } from '../../js/ui.js';

export default async function attendanceReport(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  if (!org || !user) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Please log in</div></div>';
    return;
  }

  let reportMonth = new Date().getMonth();
  let reportYear = new Date().getFullYear();
  let filterDept = '';

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Attendance Report</h1>
      <p class="page-subtitle">Monthly attendance summary across the team</p>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2)">
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <button class="btn btn-secondary btn-sm" id="rpt-prev">&larr;</button>
          <span id="rpt-month-label" style="font-weight:var(--font-weight-semibold);min-width:140px;text-align:center"></span>
          <button class="btn btn-secondary btn-sm" id="rpt-next">&rarr;</button>
        </div>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <select class="form-input form-input-sm" id="rpt-dept" style="min-width:150px">
            <option value="">All Departments</option>
          </select>
          <button class="btn btn-secondary btn-sm" id="rpt-export">Export CSV</button>
        </div>
      </div>
      <div id="rpt-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:var(--space-3);padding:var(--space-4);border-bottom:1px solid var(--color-border)"></div>
      <div id="rpt-body" style="overflow-x:auto">
        <div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div></div>
      </div>
    </div>
  `;

  const { data: depts } = await sb.from('departments').select('id, name').eq('org_id', org.id).order('name');
  const deptSelect = document.getElementById('rpt-dept');
  (depts || []).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    deptSelect.appendChild(opt);
  });

  let reportData = [];

  async function loadAndRender() {
    document.getElementById('rpt-month-label').textContent =
      new Date(reportYear, reportMonth).toLocaleString('en', { month: 'long', year: 'numeric' });

    const daysInMonth = new Date(reportYear, reportMonth + 1, 0).getDate();
    const monthStart = `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-01`;
    const monthEnd = `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    let userQuery = sb.from('users').select('id, full_name, email, department_id, department:department_id(name)')
      .eq('org_id', org.id).eq('status', 'active').order('full_name');
    if (filterDept) userQuery = userQuery.eq('department_id', filterDept);
    const { data: users } = await userQuery;
    const teamUsers = users || [];

    const userIds = teamUsers.map(u => u.id);
    let attData = [];
    if (userIds.length) {
      const { data } = await sb.from('attendance').select('user_id, date, status, total_hours, check_in, check_out')
        .in('user_id', userIds).gte('date', monthStart).lte('date', monthEnd);
      attData = data || [];
    }

    const attByUser = {};
    attData.forEach(a => {
      if (!attByUser[a.user_id]) attByUser[a.user_id] = [];
      attByUser[a.user_id].push(a);
    });

    let workingDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(reportYear, reportMonth, d);
      if (dt.getDay() !== 0 && dt.getDay() !== 6) workingDays++;
    }

    reportData = teamUsers.map(u => {
      const records = attByUser[u.id] || [];
      const present = records.filter(a => a.status === 'present' || a.status === 'late').length;
      const absent = records.filter(a => a.status === 'absent').length;
      const late = records.filter(a => a.status === 'late').length;
      const leave = records.filter(a => a.status === 'on_leave').length;
      const halfDay = records.filter(a => a.status === 'half_day').length;
      const totalHours = records.reduce((s, a) => s + (Number(a.total_hours) || 0), 0);
      const avgHours = present > 0 ? (totalHours / present).toFixed(1) : '—';
      const attendancePct = workingDays > 0 ? ((present / workingDays) * 100).toFixed(0) : '—';

      return {
        id: u.id,
        name: u.full_name || u.email,
        dept: u.department?.name || '—',
        present, absent, late, leave, halfDay,
        totalHours: totalHours.toFixed(1),
        avgHours,
        attendancePct,
        records,
      };
    });

    const totPresent = reportData.reduce((s, r) => s + r.present, 0);
    const totAbsent = reportData.reduce((s, r) => s + r.absent, 0);
    const totLate = reportData.reduce((s, r) => s + r.late, 0);
    const totLeave = reportData.reduce((s, r) => s + r.leave, 0);
    const avgAttPct = reportData.length
      ? (reportData.reduce((s, r) => s + (r.attendancePct !== '—' ? parseFloat(r.attendancePct) : 0), 0) / reportData.length).toFixed(0)
      : '—';

    document.getElementById('rpt-stats').innerHTML = `
      <div class="att-mini-stat"><div class="att-mini-stat-value">${teamUsers.length}</div><div class="att-mini-stat-label">Employees</div></div>
      <div class="att-mini-stat"><div class="att-mini-stat-value">${workingDays}</div><div class="att-mini-stat-label">Working Days</div></div>
      <div class="att-mini-stat"><div class="att-mini-stat-value" style="color:var(--color-success)">${totPresent}</div><div class="att-mini-stat-label">Present (total)</div></div>
      <div class="att-mini-stat"><div class="att-mini-stat-value" style="color:var(--color-error)">${totAbsent}</div><div class="att-mini-stat-label">Absent (total)</div></div>
      <div class="att-mini-stat"><div class="att-mini-stat-value" style="color:var(--color-warning)">${totLate}</div><div class="att-mini-stat-label">Late (total)</div></div>
      <div class="att-mini-stat"><div class="att-mini-stat-value" style="color:var(--color-accent)">${avgAttPct}%</div><div class="att-mini-stat-label">Avg Attendance</div></div>
    `;

    const rptBody = document.getElementById('rpt-body');
    if (!reportData.length) {
      rptBody.innerHTML = '<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No employees found for the selected filter.</div>';
      return;
    }

    const dayHeaders = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(reportYear, reportMonth, d);
      dayHeaders.push({
        day: d,
        dayName: dt.toLocaleString('en', { weekday: 'narrow' }),
        isWeekend: dt.getDay() === 0 || dt.getDay() === 6,
        date: `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      });
    }

    const statusChar = { present: 'P', late: 'L', absent: 'A', on_leave: 'V', half_day: 'H', holiday: 'O', weekly_off: 'O' };
    const statusColor = { present: 'var(--color-success)', late: 'var(--color-warning)', absent: 'var(--color-error)', on_leave: 'var(--color-info)', half_day: 'var(--color-warning)' };

    rptBody.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:var(--text-xs);min-width:${300 + daysInMonth * 28}px">
        <thead>
          <tr>
            <th style="padding:6px 8px;text-align:left;position:sticky;left:0;background:var(--color-bg-secondary);z-index:2;min-width:160px;border-bottom:1px solid var(--color-border)">Employee</th>
            ${dayHeaders.map(h => `<th style="padding:3px 1px;text-align:center;border-bottom:1px solid var(--color-border);min-width:24px;${h.isWeekend ? 'background:var(--color-bg-tertiary);color:var(--color-text-tertiary);' : ''}">
              <div style="font-size:9px;font-weight:var(--font-weight-normal)">${h.dayName}</div>
              <div>${h.day}</div>
            </th>`).join('')}
            <th style="padding:6px;text-align:center;border-bottom:1px solid var(--color-border);min-width:36px;border-left:2px solid var(--color-border)">P</th>
            <th style="padding:6px;text-align:center;border-bottom:1px solid var(--color-border);min-width:36px">A</th>
            <th style="padding:6px;text-align:center;border-bottom:1px solid var(--color-border);min-width:36px">L</th>
            <th style="padding:6px;text-align:center;border-bottom:1px solid var(--color-border);min-width:44px">Hrs</th>
            <th style="padding:6px;text-align:center;border-bottom:1px solid var(--color-border);min-width:36px">%</th>
          </tr>
        </thead>
        <tbody>
          ${reportData.map(r => {
            const recMap = {};
            r.records.forEach(a => { recMap[a.date] = a; });
            const pctColor = r.attendancePct !== '—'
              ? (parseFloat(r.attendancePct) >= 90 ? 'var(--color-success)' : parseFloat(r.attendancePct) >= 75 ? 'var(--color-warning)' : 'var(--color-error)')
              : '';

            return `<tr>
              <td style="padding:6px 8px;position:sticky;left:0;background:var(--color-surface);z-index:1;border-bottom:1px solid var(--color-border-light);white-space:nowrap">
                <div style="display:flex;align-items:center;gap:var(--space-2)">
                  <div style="width:22px;height:22px;border-radius:var(--radius-full);background:${avColor(r.name)};display:flex;align-items:center;justify-content:center;color:white;font-size:8px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(r.name)}</div>
                  <div>
                    <div style="font-weight:var(--font-weight-medium)">${esc(r.name)}</div>
                    <div style="font-size:9px;color:var(--color-text-tertiary)">${esc(r.dept)}</div>
                  </div>
                </div>
              </td>
              ${dayHeaders.map(h => {
                const rec = recMap[h.date];
                const char = rec ? (statusChar[rec.status] || '·') : (h.isWeekend ? '' : '');
                const color = rec ? (statusColor[rec.status] || '') : '';
                const bg = h.isWeekend ? 'var(--color-bg-tertiary)' : '';
                const title = rec ? `${rec.status}${rec.total_hours ? ' — ' + Number(rec.total_hours).toFixed(1) + 'h' : ''}` : '';
                return `<td style="padding:2px 1px;text-align:center;border-bottom:1px solid var(--color-border-light);${bg ? 'background:' + bg + ';' : ''}${color ? 'color:' + color + ';font-weight:var(--font-weight-semibold);' : ''}" title="${title}">${char}</td>`;
              }).join('')}
              <td style="padding:4px;text-align:center;border-bottom:1px solid var(--color-border-light);font-weight:var(--font-weight-semibold);color:var(--color-success);border-left:2px solid var(--color-border)">${r.present}</td>
              <td style="padding:4px;text-align:center;border-bottom:1px solid var(--color-border-light);color:var(--color-error)">${r.absent}</td>
              <td style="padding:4px;text-align:center;border-bottom:1px solid var(--color-border-light);color:var(--color-warning)">${r.late}</td>
              <td style="padding:4px;text-align:center;border-bottom:1px solid var(--color-border-light)">${r.totalHours}</td>
              <td style="padding:4px;text-align:center;border-bottom:1px solid var(--color-border-light);font-weight:var(--font-weight-semibold);${pctColor ? 'color:' + pctColor : ''}">${r.attendancePct}${r.attendancePct !== '—' ? '%' : ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  document.getElementById('rpt-prev').addEventListener('click', () => {
    reportMonth--;
    if (reportMonth < 0) { reportMonth = 11; reportYear--; }
    loadAndRender();
  });
  document.getElementById('rpt-next').addEventListener('click', () => {
    reportMonth++;
    if (reportMonth > 11) { reportMonth = 0; reportYear++; }
    loadAndRender();
  });
  deptSelect.addEventListener('change', () => {
    filterDept = deptSelect.value;
    loadAndRender();
  });
  document.getElementById('rpt-export').addEventListener('click', () => {
    if (!reportData.length) return toast('No data to export');
    const headers = 'Employee,Department,Present,Absent,Late,Leave,Total Hours,Avg Hours,Attendance %\n';
    const rows = reportData.map(r =>
      `"${r.name}","${r.dept}",${r.present},${r.absent},${r.late},${r.leave},${r.totalHours},${r.avgHours},${r.attendancePct}`
    ).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `attendance_report_${reportYear}_${String(reportMonth + 1).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  await loadAndRender();
}
