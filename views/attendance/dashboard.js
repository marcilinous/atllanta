import sb from '../../js/supabase.js';
import { getUser, getOrg } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';
import { logAction } from '../../js/audit.js';

export default async function attendanceDashboard(container) {
  const user = getUser();
  const org = getOrg();
  const today = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Attendance</h1>
        <p class="page-subtitle">Track daily attendance</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <a href="#/attendance/checkin" class="btn btn-secondary btn-sm">Check In/Out</a>
        <a href="#/attendance/report" class="btn btn-secondary btn-sm">Reports</a>
        <a href="#/attendance/regularize" class="btn btn-secondary btn-sm">Regularize</a>
      </div>
    </div>
    <div class="card" style="margin-bottom:var(--space-6)">
      <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-4)">
        <div>
          <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${new Date().toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
          <div id="checkin-status" style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold);margin-top:var(--space-1)">Checking...</div>
        </div>
        <button class="btn btn-primary btn-lg" id="checkin-btn" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span id="checkin-btn-text">Loading...</span>
        </button>
      </div>
    </div>
    <div class="stat-grid" id="att-stats">
      <div class="stat-card"><div class="stat-label">Present</div><div class="stat-value" id="att-present">—</div></div>
      <div class="stat-card"><div class="stat-label">Absent</div><div class="stat-value" id="att-absent">—</div></div>
      <div class="stat-card"><div class="stat-label">Late</div><div class="stat-value" id="att-late">—</div></div>
      <div class="stat-card"><div class="stat-label">On Leave</div><div class="stat-value" id="att-leave">—</div></div>
    </div>
    <div class="card" style="margin-top:var(--space-6)">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <span class="card-title">Team Attendance Today</span>
      </div>
      <div id="team-att-list"></div>
    </div>
    <div class="card" style="margin-top:var(--space-6)">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
        <span class="card-title">Monthly Report</span>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <select class="form-input" id="report-month" style="height:34px;width:auto">
            ${Array.from({ length: 12 }, (_, i) => {
              const d = new Date(2026, i);
              return `<option value="${i}" ${i === new Date().getMonth() ? 'selected' : ''}>${d.toLocaleString('en', { month: 'long' })}</option>`;
            }).join('')}
          </select>
        </div>
      </div>
      <div id="monthly-report"></div>
    </div>
  `;

  if (!org || !user) return;

  // Check-in/out logic
  const { data: myAtt, error: myAttErr } = await sb.from('attendance')
    .select('*').eq('user_id', user.id).eq('date', today).maybeSingle();
  if (myAttErr) toast('Failed to load attendance: ' + myAttErr.message);

  const statusEl = document.getElementById('checkin-status');
  const btn = document.getElementById('checkin-btn');
  const btnText = document.getElementById('checkin-btn-text');

  if (!myAtt) {
    statusEl.textContent = 'Not checked in';
    btnText.textContent = 'Check In';
    btn.disabled = false;
    btn.onclick = async () => {
      btn.disabled = true;
      const now = new Date().toISOString();
      const { error } = await sb.from('attendance').insert({
        org_id: org.id, user_id: user.id, date: today, check_in: now, status: 'present',
      });
      if (error) { toast('Check-in failed: ' + error.message); btn.disabled = false; return; }
      await logAction('attendance', 'attendance', null, 'check_in', null, { date: today, check_in: now });
      await publishEvent('attendance.checkin.completed', { user_id: user.id, time: now });
      toast('Checked in!');
      attendanceDashboard(container);
    };
  } else if (myAtt.check_in && !myAtt.check_out) {
    statusEl.textContent = `Checked in at ${new Date(myAtt.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}`;
    btnText.textContent = 'Check Out';
    btn.disabled = false;
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
    btn.onclick = async () => {
      btn.disabled = true;
      const now = new Date();
      const checkIn = new Date(myAtt.check_in);
      const totalHours = ((now - checkIn) / 3600000).toFixed(2);
      const { error } = await sb.from('attendance').update({
        check_out: now.toISOString(), total_hours: parseFloat(totalHours),
      }).eq('id', myAtt.id);
      if (error) { toast('Check-out failed: ' + error.message); btn.disabled = false; return; }
      await logAction('attendance', 'attendance', myAtt.id, 'check_out', null, { check_out: now.toISOString(), total_hours: totalHours });
      toast('Checked out!');
      attendanceDashboard(container);
    };
  } else {
    const hours = myAtt.total_hours ? Number(myAtt.total_hours).toFixed(1) : '—';
    statusEl.textContent = `Done for the day (${hours} hours)`;
    btnText.textContent = 'Completed';
    btn.disabled = true;
  }

  // Today's stats
  const { data: allAtt, error: allAttErr } = await sb.from('attendance').select('*, user:user_id(full_name, email)').eq('date', today);
  if (allAttErr) toast('Failed to load team attendance: ' + allAttErr.message);
  if (allAtt) {
    document.getElementById('att-present').textContent = allAtt.filter(a => a.status === 'present').length;
    document.getElementById('att-absent').textContent = allAtt.filter(a => a.status === 'absent').length;
    document.getElementById('att-late').textContent = allAtt.filter(a => a.status === 'late').length;
    document.getElementById('att-leave').textContent = allAtt.filter(a => a.status === 'on_leave').length;

    // Team attendance table
    const teamEl = document.getElementById('team-att-list');
    if (allAtt.length) {
      teamEl.innerHTML = `<div class="table-wrap"><table class="table">
        <thead><tr><th>Employee</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Status</th></tr></thead>
        <tbody>${allAtt.map(a => {
          const statusColors = { present: 'success', absent: 'error', late: 'warning', on_leave: 'info', half_day: 'warning' };
          return `<tr>
            <td>${esc(a.user?.full_name || a.user?.email || '—')}</td>
            <td>${a.check_in ? new Date(a.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
            <td>${a.check_out ? new Date(a.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
            <td>${a.total_hours ? Number(a.total_hours).toFixed(1) : '—'}</td>
            <td><span class="badge badge-${statusColors[a.status] || 'neutral'}"><span class="badge-dot"></span>${esc(a.status || '—')}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    } else {
      teamEl.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No attendance records for today</div>`;
    }
  }

  // Monthly report
  async function loadMonthlyReport() {
    const month = parseInt(document.getElementById('report-month').value);
    const year = new Date().getFullYear();
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];

    const { data: monthData, error: monthErr } = await sb.from('attendance')
      .select('*, user:user_id(full_name, email)')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date');
    if (monthErr) { toast('Failed to load monthly report: ' + monthErr.message); return; }

    const reportEl = document.getElementById('monthly-report');
    if (!monthData?.length) {
      reportEl.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No attendance data for this month</div>`;
      return;
    }

    const byUser = {};
    monthData.forEach(a => {
      const name = a.user?.full_name || a.user?.email || 'Unknown';
      if (!byUser[a.user_id]) byUser[a.user_id] = { name, present: 0, absent: 0, late: 0, leave: 0, totalHours: 0 };
      if (a.status === 'present') byUser[a.user_id].present++;
      else if (a.status === 'absent') byUser[a.user_id].absent++;
      else if (a.status === 'late') { byUser[a.user_id].late++; byUser[a.user_id].present++; }
      else if (a.status === 'on_leave') byUser[a.user_id].leave++;
      if (a.total_hours) byUser[a.user_id].totalHours += Number(a.total_hours);
    });

    reportEl.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Employee</th><th>Present</th><th>Absent</th><th>Late</th><th>Leave</th><th>Total Hours</th></tr></thead>
      <tbody>${Object.values(byUser).map(u => `<tr>
        <td style="font-weight:var(--font-weight-medium)">${esc(u.name)}</td>
        <td>${u.present}</td>
        <td>${u.absent}</td>
        <td>${u.late}</td>
        <td>${u.leave}</td>
        <td>${u.totalHours.toFixed(1)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  loadMonthlyReport();
  document.getElementById('report-month').addEventListener('change', loadMonthlyReport);
}
