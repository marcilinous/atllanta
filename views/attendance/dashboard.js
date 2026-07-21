import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate, initials, avColor } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';
import { logAction } from '../../js/audit.js';

export default async function attendanceDashboard(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  if (!org || !user) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Please log in</div></div>';
    return;
  }

  let viewMonth = today.getMonth();
  let viewYear = today.getFullYear();
  let currentTab = 'log';
  let myMonthData = [];
  let myRegs = [];
  let teamData = [];
  let myAtt = null;
  let currentLat = null, currentLng = null;

  container.innerHTML = `
    <div class="page-header" style="margin-bottom:var(--space-4)">
      <h1 class="page-title">Attendance</h1>
      <p class="page-subtitle">${today.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </div>

    <div class="att-top-row">
      <div class="card att-checkin-card">
        <div class="card-body" style="text-align:center;padding:var(--space-5)">
          <div id="att-clock" style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);letter-spacing:1px;margin-bottom:var(--space-2)"></div>
          <div id="att-checkin-status" style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-4)">Loading...</div>
          <button class="btn btn-primary" id="att-action-btn" disabled style="min-width:160px;height:40px">
            <span id="att-action-text">Loading...</span>
          </button>
          <div id="att-today-times" style="margin-top:var(--space-4);display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-2)"></div>
        </div>
      </div>

      <div class="card att-stats-card">
        <div class="card-body" style="padding:var(--space-4)">
          <div style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold);margin-bottom:var(--space-3);color:var(--color-text-secondary)">This Month</div>
          <div class="att-mini-stats">
            <div class="att-mini-stat">
              <div class="att-mini-stat-value" style="color:var(--color-success)" id="ms-present">-</div>
              <div class="att-mini-stat-label">Present</div>
            </div>
            <div class="att-mini-stat">
              <div class="att-mini-stat-value" style="color:var(--color-error)" id="ms-absent">-</div>
              <div class="att-mini-stat-label">Absent</div>
            </div>
            <div class="att-mini-stat">
              <div class="att-mini-stat-value" style="color:var(--color-warning)" id="ms-late">-</div>
              <div class="att-mini-stat-label">Late</div>
            </div>
            <div class="att-mini-stat">
              <div class="att-mini-stat-value" style="color:var(--color-info)" id="ms-leave">-</div>
              <div class="att-mini-stat-label">Leave</div>
            </div>
            <div class="att-mini-stat">
              <div class="att-mini-stat-value" id="ms-hours">-</div>
              <div class="att-mini-stat-label">Hours</div>
            </div>
            <div class="att-mini-stat">
              <div class="att-mini-stat-value" id="ms-avg">-</div>
              <div class="att-mini-stat-label">Avg/Day</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4)">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2)">
        <div style="display:flex;align-items:center;gap:var(--space-3)">
          <button class="btn btn-ghost btn-sm" id="hm-prev" style="padding:var(--space-1) var(--space-2)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span style="font-weight:var(--font-weight-semibold);min-width:140px;text-align:center" id="hm-title"></span>
          <button class="btn btn-ghost btn-sm" id="hm-next" style="padding:var(--space-1) var(--space-2)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="att-legend">
          <span class="att-legend-item"><span class="att-legend-dot" style="background:var(--color-success)"></span>Present</span>
          <span class="att-legend-item"><span class="att-legend-dot" style="background:var(--color-warning)"></span>Late</span>
          <span class="att-legend-item"><span class="att-legend-dot" style="background:var(--color-error)"></span>Absent</span>
          <span class="att-legend-item"><span class="att-legend-dot" style="background:var(--color-info)"></span>Leave</span>
          <span class="att-legend-item"><span class="att-legend-dot" style="background:var(--color-bg-tertiary)"></span>Off/Holiday</span>
        </div>
      </div>
      <div id="heatmap-grid" style="padding:var(--space-3)"></div>
    </div>

    <div style="margin-top:var(--space-4)">
      <div class="tabs" id="att-tabs">
        <button class="tab active" data-tab="log">Attendance Log</button>
        <button class="tab" data-tab="regularization">Regularization</button>
        ${isManager ? '<button class="tab" data-tab="team">Team</button>' : ''}
      </div>
      <div id="att-tab-content" style="margin-top:var(--space-3)"></div>
    </div>
  `;

  // Clock
  function tickClock() {
    const el = document.getElementById('att-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  tickClock();
  const clockInterval = setInterval(tickClock, 1000);

  // Geolocation
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
    }, () => {});
  }

  // Load initial data
  const [attResult, monthResult, regsResult] = await Promise.all([
    sb.from('attendance').select('*').eq('user_id', user.id).eq('date', todayStr).maybeSingle(),
    loadMonthData(viewYear, viewMonth),
    sb.from('attendance_regularizations').select('*, attendance:attendance_id(date)').eq('user_id', user.id).order('created_at', { ascending: false }),
  ]);

  if (attResult.error) toast('Failed to load attendance: ' + attResult.error.message);
  myAtt = attResult.data;
  myMonthData = monthResult;
  myRegs = regsResult.data || [];

  renderCheckinCard();
  renderMonthStats();
  renderHeatmap();
  renderTab();

  // Navigation
  document.getElementById('hm-prev').addEventListener('click', async () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    myMonthData = await loadMonthData(viewYear, viewMonth);
    renderMonthStats();
    renderHeatmap();
  });
  document.getElementById('hm-next').addEventListener('click', async () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    myMonthData = await loadMonthData(viewYear, viewMonth);
    renderMonthStats();
    renderHeatmap();
  });

  document.getElementById('att-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#att-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderTab();
  });

  async function loadMonthData(year, month) {
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];
    const { data, error } = await sb.from('attendance')
      .select('*').eq('user_id', user.id)
      .gte('date', startDate).lte('date', endDate).order('date');
    if (error) toast('Failed to load: ' + error.message);
    return data || [];
  }

  function renderCheckinCard() {
    const statusEl = document.getElementById('att-checkin-status');
    const btn = document.getElementById('att-action-btn');
    const btnText = document.getElementById('att-action-text');
    const timesEl = document.getElementById('att-today-times');

    if (!myAtt) {
      statusEl.textContent = 'Not checked in yet';
      btnText.textContent = 'Check In';
      btn.disabled = false;
      btn.className = 'btn btn-primary';
      btn.onclick = handleCheckIn;
      timesEl.innerHTML = miniTimeBlock('In', '—') + miniTimeBlock('Out', '—') + miniTimeBlock('Hours', '—');
    } else if (myAtt.check_in && !myAtt.check_out) {
      const inTime = new Date(myAtt.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
      statusEl.textContent = 'Working since ' + inTime;
      btnText.textContent = 'Check Out';
      btn.disabled = false;
      btn.className = 'btn btn-secondary';
      btn.onclick = handleCheckOut;
      timesEl.innerHTML = miniTimeBlock('In', inTime) + miniTimeBlock('Out', '—') + miniTimeBlock('Hours', runningHours());
    } else {
      const inTime = myAtt.check_in ? new Date(myAtt.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
      const outTime = myAtt.check_out ? new Date(myAtt.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
      const hours = myAtt.total_hours ? Number(myAtt.total_hours).toFixed(1) + 'h' : '—';
      statusEl.textContent = 'Day complete';
      btnText.textContent = 'Done';
      btn.disabled = true;
      btn.className = 'btn btn-ghost';
      timesEl.innerHTML = miniTimeBlock('In', inTime) + miniTimeBlock('Out', outTime) + miniTimeBlock('Hours', hours);
    }
  }

  function miniTimeBlock(label, value) {
    return `<div style="text-align:center">
      <div style="font-size:10px;text-transform:uppercase;color:var(--color-text-tertiary);letter-spacing:0.5px">${label}</div>
      <div style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold);margin-top:2px">${value}</div>
    </div>`;
  }

  function runningHours() {
    if (!myAtt?.check_in) return '—';
    const diff = (Date.now() - new Date(myAtt.check_in).getTime()) / 3600000;
    return diff.toFixed(1) + 'h';
  }

  async function handleCheckIn() {
    const btn = document.getElementById('att-action-btn');
    btn.disabled = true;
    const now = new Date().toISOString();
    const { data, error } = await sb.from('attendance').insert({
      org_id: org.id, user_id: user.id, date: todayStr, check_in: now, status: 'present',
      check_in_lat: currentLat, check_in_lng: currentLng,
    }).select().single();
    if (error) { toast('Check-in failed: ' + error.message); btn.disabled = false; return; }
    myAtt = data;
    await logAction('attendance', 'attendance', myAtt.id, 'check_in', null, { date: todayStr, check_in: now });
    await publishEvent('attendance.checkin.completed', { user_id: user.id, org_id: org.id, check_in_time: now });
    toast('Checked in!');
    renderCheckinCard();
  }

  async function handleCheckOut() {
    const btn = document.getElementById('att-action-btn');
    btn.disabled = true;
    const now = new Date();
    const totalHours = ((now - new Date(myAtt.check_in)) / 3600000).toFixed(2);
    const { data, error } = await sb.from('attendance').update({
      check_out: now.toISOString(), total_hours: parseFloat(totalHours),
      check_out_lat: currentLat, check_out_lng: currentLng,
    }).eq('id', myAtt.id).select().single();
    if (error) { toast('Check-out failed: ' + error.message); btn.disabled = false; return; }
    myAtt = data;
    await logAction('attendance', 'attendance', myAtt.id, 'check_out', null, { check_out: now.toISOString(), total_hours: totalHours });
    toast('Checked out!');
    renderCheckinCard();
  }

  function renderMonthStats() {
    const present = myMonthData.filter(a => a.status === 'present' || a.status === 'late').length;
    const absent = myMonthData.filter(a => a.status === 'absent').length;
    const late = myMonthData.filter(a => a.status === 'late').length;
    const leave = myMonthData.filter(a => a.status === 'on_leave').length;
    const totalHours = myMonthData.reduce((s, a) => s + (Number(a.total_hours) || 0), 0);
    const avg = present > 0 ? (totalHours / present).toFixed(1) : '—';

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('ms-present', present);
    set('ms-absent', absent);
    set('ms-late', late);
    set('ms-leave', leave);
    set('ms-hours', totalHours.toFixed(1));
    set('ms-avg', avg);
  }

  function renderHeatmap() {
    const titleEl = document.getElementById('hm-title');
    const gridEl = document.getElementById('heatmap-grid');
    const monthName = new Date(viewYear, viewMonth).toLocaleString('en', { month: 'long', year: 'numeric' });
    titleEl.textContent = monthName;

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const attMap = {};
    myMonthData.forEach(a => { attMap[a.date] = a; });

    let html = '<div class="heatmap">';
    html += '<div class="heatmap-header">';
    dayNames.forEach(d => { html += `<div class="heatmap-day-name">${d}</div>`; });
    html += '</div><div class="heatmap-body">';

    for (let i = 0; i < firstDayOfWeek; i++) {
      html += '<div class="heatmap-cell empty"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const att = attMap[dateStr];
      const d = new Date(viewYear, viewMonth, day);
      const isToday = dateStr === todayStr;
      const isFuture = d > today;
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;

      let colorClass = 'none';
      let statusText = '';
      let hoursText = '';

      if (att) {
        if (att.status === 'present') { colorClass = 'present'; statusText = 'Present'; }
        else if (att.status === 'late') { colorClass = 'late'; statusText = 'Late'; }
        else if (att.status === 'absent') { colorClass = 'absent'; statusText = 'Absent'; }
        else if (att.status === 'on_leave') { colorClass = 'leave'; statusText = 'Leave'; }
        else if (att.status === 'half_day') { colorClass = 'late'; statusText = 'Half Day'; }
        else if (att.status === 'holiday') { colorClass = 'off'; statusText = 'Holiday'; }
        else if (att.status === 'weekly_off') { colorClass = 'off'; statusText = 'Off'; }
        if (att.total_hours) hoursText = Number(att.total_hours).toFixed(1) + 'h';
      } else if (isWeekend && !isFuture) {
        colorClass = 'off';
      }

      const hasReg = myRegs.some(r => r.attendance_id === att?.id && r.status === 'pending');
      const clickable = att && !isFuture && !['holiday', 'weekly_off', 'on_leave'].includes(att.status);

      html += `<div class="heatmap-cell ${colorClass}${isToday ? ' today' : ''}${isFuture ? ' future' : ''}${clickable ? ' clickable' : ''}"
        ${clickable ? `data-att-id="${att.id}" data-date="${dateStr}"` : ''}
        ${!att && !isFuture && !isWeekend ? `data-empty-date="${dateStr}"` : ''}
        title="${statusText}${hoursText ? ' — ' + hoursText : ''}">
        <span class="heatmap-day">${day}</span>
        ${hoursText ? `<span class="heatmap-hours">${hoursText}</span>` : ''}
        ${hasReg ? '<span class="heatmap-reg-dot"></span>' : ''}
      </div>`;
    }

    html += '</div></div>';
    gridEl.innerHTML = html;

    gridEl.querySelectorAll('.heatmap-cell.clickable').forEach(cell => {
      cell.addEventListener('click', () => {
        showDayActions(cell.dataset.attId, cell.dataset.date);
      });
    });
  }

  function showDayActions(attId, dateStr) {
    const att = myMonthData.find(a => a.id === attId);
    if (!att) return;

    const inTime = att.check_in ? new Date(att.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
    const outTime = att.check_out ? new Date(att.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
    const hours = att.total_hours ? Number(att.total_hours).toFixed(1) + 'h' : '—';
    const statusBadge = {
      present: 'success', late: 'warning', absent: 'error', half_day: 'warning', on_leave: 'info'
    };

    const hasExistingReg = myRegs.some(r => r.attendance_id === attId && r.status === 'pending');

    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-3);text-align:center;padding:var(--space-3);background:var(--color-bg-secondary);border-radius:var(--radius-md)">
          <div>
            <div style="font-size:10px;text-transform:uppercase;color:var(--color-text-tertiary)">Check In</div>
            <div style="font-weight:var(--font-weight-semibold);margin-top:2px">${inTime}</div>
          </div>
          <div>
            <div style="font-size:10px;text-transform:uppercase;color:var(--color-text-tertiary)">Check Out</div>
            <div style="font-weight:var(--font-weight-semibold);margin-top:2px">${outTime}</div>
          </div>
          <div>
            <div style="font-size:10px;text-transform:uppercase;color:var(--color-text-tertiary)">Hours</div>
            <div style="font-weight:var(--font-weight-semibold);margin-top:2px">${hours}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">Status:</span>
          <span class="badge badge-${statusBadge[att.status] || 'neutral'}"><span class="badge-dot"></span>${esc(att.status)}</span>
        </div>
        ${hasExistingReg
          ? '<div style="padding:var(--space-3);background:var(--color-warning-light);border-radius:var(--radius-md);font-size:var(--text-sm);color:var(--color-warning)">A regularization request is already pending for this date.</div>'
          : `<div style="border-top:1px solid var(--color-border);padding-top:var(--space-3)">
              <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-sm);margin-bottom:var(--space-3)">Request Correction</div>
              <div class="form-group"><label class="form-label">Corrected Check-in</label><input type="datetime-local" class="form-input" id="day-reg-in"></div>
              <div class="form-group"><label class="form-label">Corrected Check-out</label><input type="datetime-local" class="form-input" id="day-reg-out"></div>
              <div class="form-group"><label class="form-label">Reason <span style="color:var(--color-error)">*</span></label><textarea class="form-input" id="day-reg-reason" rows="2" placeholder="Why is the correction needed?"></textarea></div>
              <button class="btn btn-primary" id="day-reg-submit" style="width:100%">Submit Regularization</button>
            </div>`
        }
        <div style="border-top:1px solid var(--color-border);padding-top:var(--space-3)">
          <button class="btn btn-secondary btn-sm" id="day-apply-leave" style="width:100%">Apply Leave for ${formatDate(dateStr)}</button>
        </div>
      </div>
    `;

    openModal(formatDate(dateStr), f);

    if (!hasExistingReg) {
      f.querySelector('#day-reg-submit')?.addEventListener('click', async () => {
        const reason = f.querySelector('#day-reg-reason').value.trim();
        if (!reason) return toast('Reason is required');
        const regIn = f.querySelector('#day-reg-in').value;
        const regOut = f.querySelector('#day-reg-out').value;
        if (!regIn && !regOut) return toast('Provide at least one corrected time');

        const btn = f.querySelector('#day-reg-submit');
        btn.disabled = true;
        btn.textContent = 'Submitting...';

        const { error } = await sb.from('attendance_regularizations').insert({
          org_id: org.id, user_id: user.id, attendance_id: attId, reason,
          requested_check_in: regIn ? new Date(regIn).toISOString() : null,
          requested_check_out: regOut ? new Date(regOut).toISOString() : null,
        });
        if (error) { toast('Failed: ' + error.message); btn.disabled = false; btn.textContent = 'Submit Regularization'; return; }

        await logAction('attendance', 'regularization', attId, 'created', null, { reason });
        await publishEvent('attendance.regularization.requested', { attendance_id: attId });
        closeModal();
        toast('Regularization submitted');
        const { data: updatedRegs } = await sb.from('attendance_regularizations')
          .select('*, attendance:attendance_id(date)').eq('user_id', user.id).order('created_at', { ascending: false });
        myRegs = updatedRegs || [];
        renderHeatmap();
        if (currentTab === 'regularization') renderTab();
      });
    }

    f.querySelector('#day-apply-leave')?.addEventListener('click', () => {
      closeModal();
      window.location.hash = '#/leave';
    });
  }

  async function renderTab() {
    const el = document.getElementById('att-tab-content');
    if (currentTab === 'log') await renderLog(el);
    else if (currentTab === 'regularization') await renderRegs(el);
    else if (currentTab === 'team') await renderTeam(el);
  }

  async function renderLog(el) {
    const startDate = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
    const endDate = new Date(viewYear, viewMonth + 1, 0).toISOString().split('T')[0];

    el.innerHTML = `<div class="card"><div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
      <span class="card-title">Daily Log</span>
      <button class="btn btn-secondary btn-sm" id="att-export">Export CSV</button>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Date</th><th>Day</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Status</th></tr></thead>
      <tbody>${myMonthData.length ? myMonthData.map(a => {
        const d = new Date(a.date + 'T00:00:00');
        const statusColors = { present: 'success', absent: 'error', late: 'warning', on_leave: 'info', half_day: 'warning', holiday: 'neutral', weekly_off: 'neutral' };
        return `<tr>
          <td style="font-weight:var(--font-weight-medium)">${formatDate(a.date)}</td>
          <td style="color:var(--color-text-secondary)">${d.toLocaleDateString('en', { weekday: 'short' })}</td>
          <td>${a.check_in ? new Date(a.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
          <td>${a.check_out ? new Date(a.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
          <td>${a.total_hours ? Number(a.total_hours).toFixed(1) : '—'}</td>
          <td><span class="badge badge-${statusColors[a.status] || 'neutral'}"><span class="badge-dot"></span>${esc(a.status || '—')}</span></td>
        </tr>`;
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-6)">No records this month</td></tr>'}</tbody>
    </table></div></div>`;

    el.querySelector('#att-export')?.addEventListener('click', () => {
      if (!myMonthData.length) return toast('No data to export');
      const headers = 'Date,Day,Check In,Check Out,Hours,Status\n';
      const rows = myMonthData.map(a => {
        const d = new Date(a.date + 'T00:00:00');
        return `"${a.date}","${d.toLocaleDateString('en', { weekday: 'short' })}","${a.check_in || ''}","${a.check_out || ''}","${a.total_hours || ''}","${a.status || ''}"`;
      }).join('\n');
      const blob = new Blob([headers + rows], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `attendance_${viewYear}_${viewMonth + 1}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    });
  }

  async function renderRegs(el) {
    const statusColors = { pending: 'warning', approved: 'success', rejected: 'error' };

    el.innerHTML = `<div class="card">
      <div class="card-header"><span class="card-title">My Regularization Requests</span></div>
      <div class="card-body">
        ${myRegs.length ? myRegs.map(r => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3) 0;border-bottom:1px solid var(--color-border-light)">
            <div>
              <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${formatDate(r.attendance?.date)}</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">
                ${r.requested_check_in ? 'In: ' + new Date(r.requested_check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : ''}
                ${r.requested_check_out ? ' Out: ' + new Date(r.requested_check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : ''}
              </div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:2px">${esc(r.reason)}</div>
            </div>
            <span class="badge badge-${statusColors[r.status] || 'neutral'}"><span class="badge-dot"></span>${esc(r.status)}</span>
          </div>
        `).join('') : '<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm)">No regularization requests. Click any day on the calendar above to request a correction.</div>'}
      </div>
    </div>`;
  }

  async function renderTeam(el) {
    el.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>';

    const { data: allAtt, error: attErr } = await sb.from('attendance')
      .select('*, user:user_id(full_name, email)').eq('date', todayStr);
    if (attErr) { toast('Failed to load: ' + attErr.message); return; }

    teamData = allAtt || [];
    const present = teamData.filter(a => a.status === 'present' || a.status === 'late').length;
    const absent = teamData.filter(a => a.status === 'absent').length;
    const onLeave = teamData.filter(a => a.status === 'on_leave').length;

    el.innerHTML = `<div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <span class="card-title">Team Attendance — Today</span>
        <div style="display:flex;gap:var(--space-3);font-size:var(--text-sm)">
          <span style="color:var(--color-success);font-weight:var(--font-weight-semibold)">${present} present</span>
          <span style="color:var(--color-error)">${absent} absent</span>
          <span style="color:var(--color-info)">${onLeave} on leave</span>
        </div>
      </div>
      ${teamData.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Employee</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Status</th></tr></thead>
        <tbody>${teamData.map(a => {
          const sc = { present: 'success', absent: 'error', late: 'warning', on_leave: 'info', half_day: 'warning' };
          return `<tr>
            <td>
              <div style="display:flex;align-items:center;gap:var(--space-2)">
                <div style="width:28px;height:28px;border-radius:var(--radius-full);background:${avColor(a.user?.full_name || '')};display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(a.user?.full_name || a.user?.email || '?')}</div>
                <span style="font-size:var(--text-sm)">${esc(a.user?.full_name || a.user?.email || '—')}</span>
              </div>
            </td>
            <td>${a.check_in ? new Date(a.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
            <td>${a.check_out ? new Date(a.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
            <td>${a.total_hours ? Number(a.total_hours).toFixed(1) : '—'}</td>
            <td><span class="badge badge-${sc[a.status] || 'neutral'}"><span class="badge-dot"></span>${esc(a.status || '—')}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No attendance records for today</div>'}
    </div>`;
  }
}
