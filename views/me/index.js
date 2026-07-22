import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, formatDate, initials, avColor, openModal, closeModal } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';
import { logAction } from '../../js/audit.js';

export default async function meView(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const currentYear = today.getFullYear();

  if (!org || !user) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Please log in</div></div>';
    return;
  }

  let activeTab = 'overview';
  let attMonth = today.getMonth();
  let attYear = today.getFullYear();

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-4);flex-wrap:wrap;gap:var(--space-2)">
      <div>
        <h1 class="page-title">My Hub</h1>
        <p class="page-subtitle">${today.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>
    </div>
    <div class="tabs" id="me-tabs">
      <button class="tab active" data-tab="overview">Overview</button>
      <button class="tab" data-tab="attendance">Attendance</button>
      <button class="tab" data-tab="leaves">Leaves</button>
      <button class="tab" data-tab="profile">Profile</button>
    </div>
    <div id="me-content" style="margin-top:var(--space-4)"></div>
  `;

  // Tab switching
  container.querySelector('#me-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    activeTab = tab.dataset.tab;
    container.querySelectorAll('#me-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderTab();
  });

  // Shared data loaded once
  const [attResult, balResult, typesResult, holidayResult, pendingLeavesResult, regsResult, profileResult] = await Promise.all([
    sb.from('attendance').select('*').eq('user_id', user.id).eq('date', todayStr).maybeSingle(),
    sb.from('leave_balances').select('*, leave_type:leave_type_id(name, code, annual_quota)').eq('user_id', user.id).eq('year', currentYear),
    sb.from('leave_types').select('*').eq('is_active', true).order('name'),
    sb.from('holidays').select('*').gte('date', todayStr).order('date').limit(3),
    sb.from('leave_requests').select('*, leave_type:leave_type_id(name, code)').eq('user_id', user.id).order('created_at', { ascending: false }),
    sb.from('attendance_regularizations').select('*').eq('user_id', user.id).eq('status', 'pending'),
    sb.from('users').select('*, department:department_id(name), manager:reporting_manager_id(full_name, email)').eq('id', user.id).maybeSingle(),
  ]);

  const todayAtt = attResult.data;
  const balances = balResult.data || [];
  const leaveTypes = typesResult.data || [];
  const holidays = holidayResult.data || [];
  const leaveRequests = pendingLeavesResult.data || [];
  const pendingRegs = regsResult.data || [];
  const profile = profileResult.data;

  renderTab();

  // ---- Tab Renderers ----

  function renderTab() {
    const el = container.querySelector('#me-content');
    if (activeTab === 'overview') renderOverview(el);
    else if (activeTab === 'attendance') renderAttendance(el);
    else if (activeTab === 'leaves') renderLeaves(el);
    else if (activeTab === 'profile') renderProfile(el);
  }

  // ---- OVERVIEW ----

  function renderOverview(el) {
    const inTime = todayAtt?.check_in ? new Date(todayAtt.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const outTime = todayAtt?.check_out ? new Date(todayAtt.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const hours = todayAtt?.total_hours ? Number(todayAtt.total_hours).toFixed(1) : '0.0';

    let actionLabel = 'Check In';
    let actionClass = 'btn btn-primary';
    let actionDisabled = false;
    if (todayAtt?.check_in && !todayAtt?.check_out) {
      actionLabel = 'Check Out';
      actionClass = 'btn btn-secondary';
    } else if (todayAtt?.check_out) {
      actionLabel = 'Done for today';
      actionDisabled = true;
      actionClass = 'btn btn-ghost';
    }

    const pendingLeavesList = leaveRequests.filter(r => r.status === 'pending');

    el.innerHTML = `
      <div class="dash-grid">
        <div class="card">
          <div class="card-header"><span class="card-title">Today's Attendance</span></div>
          <div class="card-body" style="text-align:center;padding:var(--space-5)">
            <div id="me-clock" style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);letter-spacing:1px;margin-bottom:var(--space-3)"></div>
            <button class="${actionClass}" id="me-checkin-btn" ${actionDisabled ? 'disabled' : ''} style="min-width:160px;margin-bottom:var(--space-4)">${actionLabel}</button>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-2)">
              <div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">In</div>
                <div style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold)">${inTime}</div>
              </div>
              <div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Out</div>
                <div style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold)">${outTime}</div>
              </div>
              <div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Hours</div>
                <div style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold)">${hours}h</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Leave Balances</span></div>
          <div class="card-body">
            ${balances.length ? `<div style="display:flex;gap:var(--space-3);overflow-x:auto;padding-bottom:var(--space-2)">
              ${balances.map(b => {
                const total = parseFloat(b.opening_balance || 0) + parseFloat(b.accrued || 0);
                const used = parseFloat(b.used || 0);
                const remaining = total - used;
                const pct = total > 0 ? Math.round((used / total) * 100) : 0;
                const barColor = pct > 80 ? 'var(--color-error)' : pct > 50 ? 'var(--color-warning)' : 'var(--color-success)';
                return `<div style="flex:0 0 auto;min-width:80px;text-align:center;padding:var(--space-2)">
                  <div style="font-size:10px;color:var(--color-accent);font-weight:var(--font-weight-semibold);text-transform:uppercase;letter-spacing:0.5px">${esc(b.leave_type?.code || '--')}</div>
                  <div style="font-size:var(--text-lg);font-weight:var(--font-weight-bold);margin:2px 0">${remaining}</div>
                  <div style="height:3px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);overflow:hidden;margin:4px 0">
                    <div style="width:${pct}%;height:100%;background:${barColor};border-radius:var(--radius-full)"></div>
                  </div>
                  <div style="font-size:9px;color:var(--color-text-tertiary)">${used}/${total} used</div>
                </div>`;
              }).join('')}
            </div>` : '<div style="color:var(--color-text-tertiary);font-size:var(--text-sm)">No leave balances configured</div>'}
          </div>
        </div>
      </div>

      <div class="dash-grid" style="margin-top:var(--space-4)">
        <div class="card">
          <div class="card-header"><span class="card-title">Upcoming Holidays</span></div>
          <div class="card-body">
            ${holidays.length ? holidays.map(h => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
                <div>
                  <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(h.name)}</div>
                  ${h.is_optional ? '<span class="badge badge-neutral" style="font-size:9px">Optional</span>' : ''}
                </div>
                <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${formatDate(h.date)}</div>
              </div>
            `).join('') : '<div class="empty-state" style="padding:var(--space-3)"><div class="empty-state-desc">No upcoming holidays</div></div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">My Pending Requests</span></div>
          <div class="card-body" style="max-height:220px;overflow-y:auto">
            ${pendingLeavesList.length || pendingRegs.length ? `
              ${pendingLeavesList.map(r => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
                  <div>
                    <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(r.leave_type?.name || '--')}</div>
                    <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${formatDate(r.start_date)} - ${formatDate(r.end_date)} (${r.days}d)</div>
                  </div>
                  <span class="badge badge-warning">Pending</span>
                </div>
              `).join('')}
              ${pendingRegs.map(r => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
                  <div>
                    <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">Regularization</div>
                    <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(r.reason || '')}</div>
                  </div>
                  <span class="badge badge-warning">Pending</span>
                </div>
              `).join('')}
            ` : '<div class="empty-state" style="padding:var(--space-3)"><div class="empty-state-desc">No pending requests</div></div>'}
          </div>
        </div>
      </div>
    `;

    // Clock
    const clockEl = el.querySelector('#me-clock');
    if (clockEl) {
      const updateClock = () => { clockEl.textContent = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
      updateClock();
      const clockInterval = setInterval(updateClock, 1000);
      const obs = new MutationObserver(() => { if (!document.contains(clockEl)) { clearInterval(clockInterval); obs.disconnect(); } });
      obs.observe(document.body, { childList: true, subtree: true });
    }

    // Check-in/out handler
    const btn = el.querySelector('#me-checkin-btn');
    if (btn && !actionDisabled) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Processing...';
        if (!todayAtt) {
          const { data, error } = await sb.from('attendance').insert({ org_id: org.id, user_id: user.id, date: todayStr, check_in: new Date().toISOString(), status: 'present' }).select().single();
          if (error) { toast(error.message, 'error'); btn.disabled = false; btn.textContent = 'Check In'; return; }
          Object.assign(todayAtt || {}, data);
          await publishEvent('attendance.checkin.completed', { user_id: user.id, time: data.check_in });
          await logAction('attendance', 'attendance', data.id, 'created', null, data);
          toast('Checked in successfully', 'success');
        } else {
          const now = new Date();
          const hrs = ((now - new Date(todayAtt.check_in)) / 3600000).toFixed(2);
          const { data, error } = await sb.from('attendance').update({ check_out: now.toISOString(), total_hours: hrs }).eq('id', todayAtt.id).select().single();
          if (error) { toast(error.message, 'error'); btn.disabled = false; btn.textContent = 'Check Out'; return; }
          Object.assign(todayAtt, data);
          await publishEvent('attendance.checkout.completed', { user_id: user.id, time: data.check_out });
          await logAction('attendance', 'attendance', data.id, 'updated', null, data);
          toast('Checked out successfully', 'success');
        }
        renderOverview(el);
      });
    }
  }

  // ---- ATTENDANCE TAB ----

  async function renderAttendance(el) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4)">
        <button class="btn btn-secondary btn-sm" id="att-prev">&larr;</button>
        <span style="font-weight:var(--font-weight-semibold);font-size:var(--text-md)" id="att-month-label">${monthNames[attMonth]} ${attYear}</span>
        <button class="btn btn-secondary btn-sm" id="att-next">&rarr;</button>
      </div>
      <div id="att-heatmap-wrap"><div class="skeleton skeleton-text"></div></div>
      <div class="stat-grid" id="att-month-stats" style="margin-top:var(--space-4)"></div>
    `;

    el.querySelector('#att-prev').addEventListener('click', () => { attMonth--; if (attMonth < 0) { attMonth = 11; attYear--; } renderAttendance(el); });
    el.querySelector('#att-next').addEventListener('click', () => { attMonth++; if (attMonth > 11) { attMonth = 0; attYear++; } renderAttendance(el); });

    const startDate = `${attYear}-${String(attMonth + 1).padStart(2, '0')}-01`;
    const endDay = new Date(attYear, attMonth + 1, 0).getDate();
    const endDate = `${attYear}-${String(attMonth + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

    const { data: monthData, error } = await sb.from('attendance').select('*').eq('user_id', user.id).gte('date', startDate).lte('date', endDate).order('date');
    if (error) { toast(error.message, 'error'); return; }

    const attByDate = {};
    (monthData || []).forEach(a => { attByDate[a.date] = a; });

    // Build heatmap grid
    const firstDow = new Date(attYear, attMonth, 1).getDay();
    let gridHTML = '<div class="heatmap"><div class="heatmap-header">';
    dayNames.forEach(d => { gridHTML += `<div class="heatmap-day-name">${d}</div>`; });
    gridHTML += '</div><div class="heatmap-body">';

    for (let i = 0; i < firstDow; i++) {
      gridHTML += '<div class="heatmap-cell empty"></div>';
    }

    for (let d = 1; d <= endDay; d++) {
      const dateStr = `${attYear}-${String(attMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const att = attByDate[dateStr];
      const dow = new Date(attYear, attMonth, d).getDay();
      const isFuture = dateStr > todayStr;
      const isToday = dateStr === todayStr;

      let cellClass = 'heatmap-cell clickable';
      if (isFuture) cellClass = 'heatmap-cell future';
      else if (isToday) cellClass += ' today';

      if (att) {
        if (att.status === 'present') cellClass += ' present';
        else if (att.status === 'late') cellClass += ' late';
        else if (att.status === 'absent') cellClass += ' absent';
        else if (att.status === 'on_leave') cellClass += ' leave';
        else if (att.status === 'weekly_off' || att.status === 'holiday') cellClass += ' off';
      } else if (!isFuture && (dow === 0 || dow === 6)) {
        cellClass += ' off';
      }

      const hoursLabel = att?.total_hours ? Number(att.total_hours).toFixed(1) + 'h' : '';
      gridHTML += `<div class="${cellClass}"><div class="heatmap-day">${d}</div>${hoursLabel ? `<div class="heatmap-hours">${hoursLabel}</div>` : ''}</div>`;
    }

    gridHTML += '</div></div>';

    el.querySelector('#att-heatmap-wrap').innerHTML = gridHTML;
    el.querySelector('#att-month-label').textContent = `${monthNames[attMonth]} ${attYear}`;

    // Stats
    const records = monthData || [];
    const present = records.filter(r => r.status === 'present').length;
    const absent = records.filter(r => r.status === 'absent').length;
    const late = records.filter(r => r.status === 'late').length;
    const onLeave = records.filter(r => r.status === 'on_leave').length;
    const totalHrs = records.reduce((s, r) => s + parseFloat(r.total_hours || 0), 0);
    const avgHrs = present + late > 0 ? (totalHrs / (present + late)).toFixed(1) : '0.0';

    el.querySelector('#att-month-stats').innerHTML = `
      <div class="stat-card"><div class="stat-label">Present</div><div class="stat-value" style="color:var(--color-success)">${present}</div></div>
      <div class="stat-card"><div class="stat-label">Absent</div><div class="stat-value" style="color:var(--color-error)">${absent}</div></div>
      <div class="stat-card"><div class="stat-label">Late</div><div class="stat-value" style="color:var(--color-warning)">${late}</div></div>
      <div class="stat-card"><div class="stat-label">On Leave</div><div class="stat-value" style="color:var(--color-info)">${onLeave}</div></div>
      <div class="stat-card"><div class="stat-label">Total Hours</div><div class="stat-value">${totalHrs.toFixed(1)}</div></div>
      <div class="stat-card"><div class="stat-label">Avg/Day</div><div class="stat-value">${avgHrs}</div></div>
    `;
  }

  // ---- LEAVES TAB ----

  function renderLeaves(el) {
    el.innerHTML = `
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-header"><span class="card-title">My Leave Balances</span></div>
        <div class="card-body">
          ${balances.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:var(--space-3)">
            ${balances.map(b => {
              const total = parseFloat(b.opening_balance || 0) + parseFloat(b.accrued || 0);
              const used = parseFloat(b.used || 0);
              const avail = total - used;
              const pct = total > 0 ? Math.round((used / total) * 100) : 0;
              const barColor = pct > 80 ? 'var(--color-error)' : pct > 50 ? 'var(--color-warning)' : 'var(--color-accent)';
              return `<div class="leave-balance-card card" style="padding:var(--space-3)">
                <div class="leave-bal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2)">
                  <span class="leave-bal-code badge badge-info" style="font-size:10px">${esc(b.leave_type?.code || '--')}</span>
                  <span class="leave-bal-avail" style="font-size:var(--text-lg);font-weight:var(--font-weight-bold)">${avail}</span>
                </div>
                <div class="leave-bal-name" style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-2)">${esc(b.leave_type?.name || '--')}</div>
                <div class="leave-bal-bar" style="height:4px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);overflow:hidden;margin-bottom:var(--space-1)">
                  <div class="leave-bal-bar-fill" style="width:${pct}%;height:100%;background:${barColor};border-radius:var(--radius-full)"></div>
                </div>
                <div class="leave-bal-meta" style="font-size:10px;color:var(--color-text-tertiary)">${used} used of ${total}</div>
              </div>`;
            }).join('')}
          </div>` : '<div style="color:var(--color-text-tertiary);font-size:var(--text-sm)">No leave balances configured</div>'}
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-header"><span class="card-title">Apply for Leave</span></div>
        <div class="card-body">
          <form id="leave-apply-form">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-3)">
              <div class="form-group">
                <label class="form-label">Leave Type</label>
                <select class="form-input" id="leave-type-sel" required>
                  <option value="">Select type</option>
                  ${leaveTypes.map(t => `<option value="${t.id}">${esc(t.name)} (${esc(t.code)})</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Start Date</label>
                <input type="date" class="form-input" id="leave-start" required>
              </div>
              <div class="form-group">
                <label class="form-label">End Date</label>
                <input type="date" class="form-input" id="leave-end" required>
              </div>
            </div>
            <div style="margin:var(--space-2) 0;font-size:var(--text-sm);color:var(--color-text-secondary)">
              Days: <strong id="leave-days-calc">0</strong>
            </div>
            <div class="form-group">
              <label class="form-label">Reason</label>
              <textarea class="form-input" id="leave-reason" rows="2" placeholder="Optional reason"></textarea>
            </div>
            <button type="submit" class="btn btn-primary btn-sm">Submit Request</button>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">My Leave Requests</span></div>
        <div class="card-body">
          ${leaveRequests.length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${leaveRequests.map(r => {
                const badgeClass = r.status === 'approved' ? 'badge-success' : r.status === 'rejected' ? 'badge-error' : r.status === 'cancelled' ? 'badge-neutral' : 'badge-warning';
                return `<tr>
                  <td>${esc(r.leave_type?.name || '--')}</td>
                  <td>${formatDate(r.start_date)}</td>
                  <td>${formatDate(r.end_date)}</td>
                  <td>${r.days}</td>
                  <td><span class="badge ${badgeClass}">${esc(r.status)}</span></td>
                  <td>${r.status === 'pending' ? `<button class="btn btn-danger btn-sm cancel-leave-btn" data-id="${r.id}">Cancel</button>` : ''}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>` : '<div class="empty-state" style="padding:var(--space-3)"><div class="empty-state-desc">No leave requests yet</div></div>'}
        </div>
      </div>
    `;

    // Calculate days on date change
    const startInput = el.querySelector('#leave-start');
    const endInput = el.querySelector('#leave-end');
    const daysCalc = el.querySelector('#leave-days-calc');
    const calcDays = () => {
      if (!startInput.value || !endInput.value) { daysCalc.textContent = '0'; return; }
      const s = new Date(startInput.value);
      const e = new Date(endInput.value);
      if (e < s) { daysCalc.textContent = '0'; return; }
      const diff = Math.round((e - s) / 86400000) + 1;
      daysCalc.textContent = diff;
    };
    startInput.addEventListener('change', calcDays);
    endInput.addEventListener('change', calcDays);

    // Submit leave
    el.querySelector('#leave-apply-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const leaveTypeId = el.querySelector('#leave-type-sel').value;
      const startDate = startInput.value;
      const endDate = endInput.value;
      const reason = el.querySelector('#leave-reason').value.trim();
      const days = parseInt(daysCalc.textContent);

      if (!leaveTypeId || !startDate || !endDate || days < 1) { toast('Please fill all required fields', 'error'); return; }

      const { data, error } = await sb.from('leave_requests').insert({
        org_id: org.id, user_id: user.id, leave_type_id: leaveTypeId,
        start_date: startDate, end_date: endDate, days, reason, status: 'pending'
      }).select('*, leave_type:leave_type_id(name, code)').single();

      if (error) { toast(error.message, 'error'); return; }
      toast('Leave request submitted', 'success');
      await publishEvent('leave.request.created', { leave_request_id: data.id, days, leave_type_id: leaveTypeId });
      await logAction('leave', 'leave_request', data.id, 'created', null, data);
      leaveRequests.unshift(data);
      renderLeaves(el);
    });

    // Cancel leave
    el.querySelectorAll('.cancel-leave-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        btn.disabled = true;
        btn.textContent = '...';
        const { error } = await sb.from('leave_requests').update({ status: 'cancelled' }).eq('id', id);
        if (error) { toast(error.message, 'error'); btn.disabled = false; btn.textContent = 'Cancel'; return; }
        toast('Leave request cancelled', 'success');
        const idx = leaveRequests.findIndex(r => r.id === id);
        if (idx >= 0) leaveRequests[idx].status = 'cancelled';
        await logAction('leave', 'leave_request', id, 'updated', { status: 'pending' }, { status: 'cancelled' });
        renderLeaves(el);
      });
    });
  }

  // ---- PROFILE TAB ----

  function renderProfile(el) {
    if (!profile) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-title">Profile not found</div></div>';
      return;
    }

    const av = initials(profile.full_name || profile.email);
    const bgColor = avColor(profile.full_name || profile.email);

    el.innerHTML = `
      <div class="card">
        <div class="card-body" style="padding:var(--space-6)">
          <div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-6)">
            <div style="width:64px;height:64px;border-radius:var(--radius-full);background:${bgColor};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:var(--font-weight-bold);font-size:var(--text-xl);flex-shrink:0">${esc(av)}</div>
            <div>
              <div style="font-size:var(--text-xl);font-weight:var(--font-weight-bold)">${esc(profile.full_name)}</div>
              <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(profile.designation || 'No designation')}</div>
              <span class="badge ${profile.status === 'active' ? 'badge-success' : 'badge-neutral'}" style="margin-top:var(--space-1)">${esc(profile.status)}</span>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:var(--space-6)">
            <div>
              <h3 style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold);color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:var(--space-3)">Personal Info</h3>
              <div style="display:grid;gap:var(--space-3)">
                <div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Full Name</div>
                  <div style="font-size:var(--text-sm)">${esc(profile.full_name)}</div>
                </div>
                <div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Email</div>
                  <div style="font-size:var(--text-sm)">${esc(profile.email)}</div>
                </div>
                <div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Phone</div>
                  <div style="font-size:var(--text-sm)">${esc(profile.phone || 'Not set')}</div>
                </div>
              </div>
            </div>

            <div>
              <h3 style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold);color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:var(--space-3)">Employment Details</h3>
              <div style="display:grid;gap:var(--space-3)">
                <div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Department</div>
                  <div style="font-size:var(--text-sm)">${esc(profile.department?.name || 'Not assigned')}</div>
                </div>
                <div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Designation</div>
                  <div style="font-size:var(--text-sm)">${esc(profile.designation || 'Not set')}</div>
                </div>
                <div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Date of Joining</div>
                  <div style="font-size:var(--text-sm)">${profile.date_of_joining ? formatDate(profile.date_of_joining) : 'Not set'}</div>
                </div>
                <div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Reporting Manager</div>
                  <div style="font-size:var(--text-sm)">${esc(profile.manager?.full_name || 'Not assigned')}</div>
                </div>
                <div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Role</div>
                  <div style="font-size:var(--text-sm)"><span class="badge badge-neutral">${esc(profile.role)}</span></div>
                </div>
              </div>
            </div>
          </div>

          ${isAdmin ? `<div style="margin-top:var(--space-6);border-top:1px solid var(--color-border);padding-top:var(--space-4)">
            <button class="btn btn-secondary btn-sm" id="edit-profile-btn">Edit Profile</button>
          </div>` : ''}
        </div>
      </div>
    `;

    if (isAdmin) {
      el.querySelector('#edit-profile-btn').addEventListener('click', () => {
        openModal('Edit Profile', `
          <form id="edit-profile-form">
            <div class="form-group">
              <label class="form-label">Full Name</label>
              <input class="form-input" id="ep-name" value="${esc(profile.full_name)}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Phone</label>
              <input class="form-input" id="ep-phone" value="${esc(profile.phone || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Designation</label>
              <input class="form-input" id="ep-designation" value="${esc(profile.designation || '')}">
            </div>
            <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-4)">
              <button type="button" class="btn btn-secondary btn-sm" onclick="document.querySelector('.modal-overlay')?.remove()">Cancel</button>
              <button type="submit" class="btn btn-primary btn-sm">Save</button>
            </div>
          </form>
        `);

        document.querySelector('#edit-profile-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const updates = {
            full_name: document.querySelector('#ep-name').value.trim(),
            phone: document.querySelector('#ep-phone').value.trim() || null,
            designation: document.querySelector('#ep-designation').value.trim() || null,
          };
          const old = { full_name: profile.full_name, phone: profile.phone, designation: profile.designation };
          const { error } = await sb.from('users').update(updates).eq('id', user.id);
          if (error) { toast(error.message, 'error'); return; }
          Object.assign(profile, updates);
          await logAction('people', 'employee', user.id, 'updated', old, updates);
          toast('Profile updated', 'success');
          closeModal();
          renderProfile(el);
        });
      });
    }
  }
}
