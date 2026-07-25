import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, initials, avColor, formatDate, openModal, closeModal } from '../../js/ui.js';
import { navigate, routeParams } from '../../js/router.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

export default async function employeeProfile(container) {
  const org = getOrg();
  const params = routeParams();
  const empId = params.id;

  if (!empId) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
      <div class="empty-state-title">No employee selected</div>
      <div class="empty-state-desc">Select an employee from the directory.</div>
    </div>`;
    return;
  }

  container.innerHTML = `<div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-text" style="width:40%"></div></div>`;

  const { data: emp, error } = await sb
    .from('users')
    .select('*, department:department_id(name)')
    .eq('id', empId)
    .maybeSingle();

  if (error || !emp) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></div>
      <div class="empty-state-title">Employee not found</div>
      <div class="empty-state-desc">${error ? esc(error.message) : 'This employee record does not exist.'}</div>
    </div>`;
    return;
  }

  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin', 'manager'].includes(membership.role);
  const statusColors = { active: 'success', on_notice: 'warning', exited: 'error' };
  const roleColors = { owner: 'error', admin: 'warning', manager: 'info', member: 'neutral' };

  container.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap">
      <button class="btn btn-ghost" id="back-btn" style="padding:var(--space-2)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <div style="display:flex;align-items:center;gap:var(--space-4);flex:1">
        <div style="width:56px;height:56px;border-radius:var(--radius-full);background:${avColor(emp.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold);font-size:var(--text-xl);flex-shrink:0">${initials(emp.full_name)}</div>
        <div>
          <h1 class="page-title" style="margin:0">${esc(emp.full_name)}</h1>
          <p class="page-subtitle" style="margin:0;margin-top:var(--space-1)">${esc(emp.designation || '—')}</p>
        </div>
      </div>
      <div style="display:flex;gap:var(--space-2);align-items:center">
        <span class="badge badge-${roleColors[emp.role] || 'neutral'}">${esc(emp.role || 'member')}</span>
        <span class="badge badge-${statusColors[emp.status] || 'neutral'}"><span class="badge-dot"></span>${esc(emp.status || 'active')}</span>
        ${isAdmin ? '<button class="btn btn-secondary btn-sm" id="edit-emp-btn">Edit</button>' : ''}
      </div>
    </div>

    <div class="grid-2col" style="margin-bottom:var(--space-6)">
      <div class="card">
        <div class="card-header"><span class="card-title">Personal Information</span></div>
        <div class="card-body">
          <div style="display:grid;gap:var(--space-4)">
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Full Name</div>
              <div style="font-size:var(--text-sm)">${esc(emp.full_name)}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Email</div>
              <div style="font-size:var(--text-sm)">${esc(emp.email || '—')}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Phone</div>
              <div style="font-size:var(--text-sm)">${esc(emp.phone || '—')}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Employment Details</span></div>
        <div class="card-body">
          <div style="display:grid;gap:var(--space-4)">
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Department</div>
              <div style="font-size:var(--text-sm)">${esc(emp.department?.name || '—')}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Designation</div>
              <div style="font-size:var(--text-sm)">${esc(emp.designation || '—')}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Date of Joining</div>
              <div style="font-size:var(--text-sm)">${emp.date_of_joining ? formatDate(emp.date_of_joining) : '—'}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Reporting Manager</div>
              <div style="font-size:var(--text-sm)" id="manager-name">—</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="tabs" id="profile-tabs">
      <button class="tab active" data-tab="attendance">Attendance</button>
      <button class="tab" data-tab="leave">Leave</button>
      <button class="tab" data-tab="assets">Assets</button>
      <button class="tab" data-tab="documents">Documents</button>
    </div>
    <div id="profile-tab-content" style="margin-top:var(--space-4)"></div>
  `;

  // Load reporting manager name if set
  if (emp.reporting_manager_id) {
    sb.from('users').select('full_name').eq('id', emp.reporting_manager_id).maybeSingle().then(({ data }) => {
      const el = document.getElementById('manager-name');
      if (el && data) el.textContent = data.full_name;
    });
  }

  // Back button
  document.getElementById('back-btn').addEventListener('click', () => navigate('employees'));

  // Edit employee
  if (isAdmin) {
    document.getElementById('edit-emp-btn')?.addEventListener('click', async () => {
      const { data: depts, error: deptsErr } = await sb.from('departments').select('id, name').order('name');
      if (deptsErr) { console.error(deptsErr); }
      const { data: managers, error: managersErr } = await sb.from('users').select('id, full_name').neq('id', empId).order('full_name');
      if (managersErr) { console.error(managersErr); }

      const f = document.createElement('div');
      f.innerHTML = `<div style="display:grid;gap:var(--space-4)">
        <div class="form-group"><label class="form-label">Full Name</label><input type="text" class="form-input" id="ed-name" value="${esc(emp.full_name || '')}"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <div class="form-group"><label class="form-label">Email</label><input type="email" class="form-input" id="ed-email" value="${esc(emp.email || '')}"></div>
          <div class="form-group"><label class="form-label">Phone</label><input type="text" class="form-input" id="ed-phone" value="${esc(emp.phone || '')}"></div>
        </div>
        <div class="form-group"><label class="form-label">Designation</label><input type="text" class="form-input" id="ed-designation" value="${esc(emp.designation || '')}"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <div class="form-group"><label class="form-label">Department</label>
            <select class="form-input" id="ed-dept">
              <option value="">None</option>
              ${(depts || []).map(d => `<option value="${d.id}"${d.id === emp.department_id ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label class="form-label">Role</label>
            <select class="form-input" id="ed-role">
              ${['member', 'manager', 'admin', 'owner'].map(r => `<option value="${r}"${r === emp.role ? ' selected' : ''}>${r}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <div class="form-group"><label class="form-label">Status</label>
            <select class="form-input" id="ed-status">
              ${['active', 'on_notice', 'exited'].map(s => `<option value="${s}"${s === emp.status ? ' selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label class="form-label">Date of Joining</label><input type="date" class="form-input" id="ed-doj" value="${emp.date_of_joining || ''}"></div>
        </div>
        <div class="form-group"><label class="form-label">Reporting Manager</label>
          <select class="form-input" id="ed-manager">
            <option value="">None</option>
            ${(managers || []).map(m => `<option value="${m.id}"${m.id === emp.reporting_manager_id ? ' selected' : ''}>${esc(m.full_name)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" id="ed-save">Save Changes</button>
      </div>`;

      openModal('Edit Employee', f);

      f.querySelector('#ed-save').addEventListener('click', async () => {
        const name = f.querySelector('#ed-name').value.trim();
        const email = f.querySelector('#ed-email').value.trim();
        if (!name || !email) return toast('Name and email are required');

        const btn = f.querySelector('#ed-save');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        const updates = {
          full_name: name,
          email,
          phone: f.querySelector('#ed-phone').value.trim() || null,
          designation: f.querySelector('#ed-designation').value.trim() || null,
          department_id: f.querySelector('#ed-dept').value || null,
          role: f.querySelector('#ed-role').value,
          status: f.querySelector('#ed-status').value,
          date_of_joining: f.querySelector('#ed-doj').value || null,
          reporting_manager_id: f.querySelector('#ed-manager').value || null,
        };

        const oldValues = {};
        for (const key of Object.keys(updates)) {
          if (emp[key] !== updates[key]) oldValues[key] = emp[key];
        }

        const { error: updateErr } = await sb.from('users').update(updates).eq('id', empId);
        if (updateErr) {
          toast('Failed: ' + updateErr.message);
          btn.disabled = false;
          btn.textContent = 'Save Changes';
          return;
        }

        await logAction('people', 'employee', empId, 'updated', oldValues, updates);
        await publishEvent('people.employee.updated', { employee_id: empId, changes: Object.keys(oldValues) });
        closeModal();
        toast('Employee updated');
        employeeProfile(container);
      });
    });
  }

  // Tab logic
  let currentTab = 'attendance';

  document.getElementById('profile-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#profile-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderTab();
  });

  const tabContent = document.getElementById('profile-tab-content');

  async function renderTab() {
    if (currentTab === 'attendance') await renderAttendance();
    else if (currentTab === 'leave') await renderLeave();
    else if (currentTab === 'assets') await renderAssets();
    else if (currentTab === 'documents') renderDocuments();
  }

  async function renderAttendance() {
    tabContent.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading attendance...</div>`;

    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const { data: records, error: attError } = await sb
      .from('attendance')
      .select('*')
      .eq('user_id', empId)
      .gte('date', sixMonthsAgo.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (attError) {
      tabContent.innerHTML = `<div class="card"><div class="card-body" style="color:var(--color-error)">Failed to load attendance: ${esc(attError.message)}</div></div>`;
      return;
    }

    if (!records?.length) {
      tabContent.innerHTML = `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
        <div class="empty-state-title">No attendance records</div>
        <div class="empty-state-desc">No attendance history found for this employee.</div>
      </div></div>`;
      return;
    }

    const byDate = {};
    let present = 0, absent = 0, late = 0, leaves = 0;
    for (const r of records) {
      byDate[r.date] = r.status;
      if (r.status === 'present') present++;
      else if (r.status === 'absent') absent++;
      else if (r.status === 'late') late++;
      else if (r.status === 'on_leave') leaves++;
    }

    const heatmapColors = {
      present: 'var(--color-success)',
      late: 'var(--color-warning)',
      absent: 'var(--color-error)',
      on_leave: 'var(--color-info)',
      half_day: 'var(--color-warning)',
      holiday: 'var(--color-bg-tertiary)',
      weekly_off: 'var(--color-bg-tertiary)',
    };

    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ year: d.getFullYear(), month: d.getMonth() });
    }

    const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    let heatmapHtml = months.map(({ year, month }) => {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const firstDay = new Date(year, month, 1).getDay();
      let cells = '';
      for (let b = 0; b < firstDay; b++) cells += `<div style="width:18px;height:18px"></div>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const st = byDate[dateStr];
        const bg = st ? heatmapColors[st] || 'var(--color-bg-tertiary)' : 'var(--color-border-light)';
        const title = st ? `${dateStr}: ${st}` : dateStr;
        cells += `<div style="width:18px;height:18px;border-radius:3px;background:${bg};cursor:default" title="${title}"></div>`;
      }
      return `<div style="flex-shrink:0">
        <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1);font-weight:var(--font-weight-medium)">${monthNames[month]} ${year}</div>
        <div style="display:grid;grid-template-columns:repeat(7,18px);gap:2px">${dayLabels.map(l => `<div style="width:18px;height:14px;font-size:9px;color:var(--color-text-tertiary);text-align:center">${l}</div>`).join('')}${cells}</div>
      </div>`;
    }).join('');

    const statusBadges = { present: 'success', absent: 'error', late: 'warning', on_leave: 'info', half_day: 'warning', holiday: 'neutral', weekly_off: 'neutral' };
    const recent = records.slice(0, 20);

    tabContent.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:var(--space-3);margin-bottom:var(--space-4)">
        <div class="card"><div class="card-body" style="text-align:center;padding:var(--space-3)">
          <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-success)">${present}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Present</div>
        </div></div>
        <div class="card"><div class="card-body" style="text-align:center;padding:var(--space-3)">
          <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-warning)">${late}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Late</div>
        </div></div>
        <div class="card"><div class="card-body" style="text-align:center;padding:var(--space-3)">
          <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-error)">${absent}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Absent</div>
        </div></div>
        <div class="card"><div class="card-body" style="text-align:center;padding:var(--space-3)">
          <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-info)">${leaves}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">On Leave</div>
        </div></div>
      </div>
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-header"><span class="card-title">Attendance Heatmap (6 months)</span></div>
        <div class="card-body" style="overflow-x:auto">
          <div style="display:flex;gap:var(--space-4)">${heatmapHtml}</div>
          <div style="display:flex;gap:var(--space-3);margin-top:var(--space-3);flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:4px;font-size:var(--text-xs);color:var(--color-text-secondary)"><div style="width:12px;height:12px;border-radius:2px;background:var(--color-success)"></div>Present</div>
            <div style="display:flex;align-items:center;gap:4px;font-size:var(--text-xs);color:var(--color-text-secondary)"><div style="width:12px;height:12px;border-radius:2px;background:var(--color-warning)"></div>Late</div>
            <div style="display:flex;align-items:center;gap:4px;font-size:var(--text-xs);color:var(--color-text-secondary)"><div style="width:12px;height:12px;border-radius:2px;background:var(--color-error)"></div>Absent</div>
            <div style="display:flex;align-items:center;gap:4px;font-size:var(--text-xs);color:var(--color-text-secondary)"><div style="width:12px;height:12px;border-radius:2px;background:var(--color-info)"></div>On Leave</div>
            <div style="display:flex;align-items:center;gap:4px;font-size:var(--text-xs);color:var(--color-text-secondary)"><div style="width:12px;height:12px;border-radius:2px;background:var(--color-bg-tertiary)"></div>Holiday/Off</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Recent Records</span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Status</th></tr></thead>
          <tbody>${recent.map(a => `<tr>
            <td style="font-weight:var(--font-weight-medium)">${formatDate(a.date)}</td>
            <td>${a.check_in ? new Date(a.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
            <td>${a.check_out ? new Date(a.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
            <td>${a.total_hours ? Number(a.total_hours).toFixed(1) : '—'}</td>
            <td><span class="badge badge-${statusBadges[a.status] || 'neutral'}"><span class="badge-dot"></span>${esc(a.status || '—')}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
  }

  async function renderLeave() {
    tabContent.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading leave...</div>`;

    const currentYear = new Date().getFullYear();

    const [balResult, reqResult] = await Promise.all([
      sb.from('leave_balances')
        .select('*, leave_type:leave_type_id(name, code)')
        .eq('user_id', empId)
        .eq('year', currentYear),
      sb.from('leave_requests')
        .select('*, leave_type:leave_type_id(name, code)')
        .eq('user_id', empId)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    const balances = balResult.data || [];
    const requests = reqResult.data || [];

    if (reqResult.error) {
      tabContent.innerHTML = `<div class="card"><div class="card-body" style="color:var(--color-error)">Failed to load leave: ${esc(reqResult.error.message)}</div></div>`;
      return;
    }

    let balanceHtml = '';
    if (balances.length) {
      balanceHtml = `<div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-header"><span class="card-title">Leave Balances (${currentYear})</span></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:var(--space-3)">
            ${balances.map(b => {
              const total = Number(b.opening_balance || 0) + Number(b.accrued || 0);
              const used = Number(b.used || 0);
              const remaining = Number(b.balance || 0);
              const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
              return `<div style="padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md)">
                <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-bottom:var(--space-1)">${esc(b.leave_type?.name || 'Unknown')} <span class="badge badge-neutral" style="font-size:9px">${esc(b.leave_type?.code || '')}</span></div>
                <div style="font-size:var(--text-xl);font-weight:var(--font-weight-bold)">${remaining}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${used} used of ${total}</div>
                <div style="height:4px;background:var(--color-bg-tertiary);border-radius:2px;margin-top:var(--space-2);overflow:hidden">
                  <div style="height:100%;width:${pct}%;background:${pct > 80 ? 'var(--color-error)' : 'var(--color-accent)'};border-radius:2px"></div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
    }

    if (!requests.length && !balances.length) {
      tabContent.innerHTML = `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></div>
        <div class="empty-state-title">No leave data</div>
        <div class="empty-state-desc">No leave balances or requests found for this employee.</div>
      </div></div>`;
      return;
    }

    const statusColors = { pending: 'warning', approved: 'success', rejected: 'error', cancelled: 'neutral' };

    const requestsHtml = requests.length ? `<div class="card">
      <div class="card-header"><span class="card-title">Leave Requests</span></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th></tr></thead>
        <tbody>${requests.map(r => `<tr>
          <td><span class="badge badge-neutral">${esc(r.leave_type?.code || '—')}</span> ${esc(r.leave_type?.name || '')}</td>
          <td>${formatDate(r.start_date)}</td>
          <td>${formatDate(r.end_date)}</td>
          <td>${r.days}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.reason || '—')}</td>
          <td><span class="badge badge-${statusColors[r.status] || 'neutral'}"><span class="badge-dot"></span>${esc(r.status || '—')}</span></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>` : '';

    tabContent.innerHTML = balanceHtml + requestsHtml;
  }

  async function renderAssets() {
    tabContent.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading assets...</div>`;

    const [currentResult, historyResult] = await Promise.all([
      sb.from('assets')
        .select('*')
        .eq('assigned_to', empId)
        .eq('status', 'assigned')
        .order('assigned_at', { ascending: false }),
      sb.from('asset_assignments')
        .select('*, asset:asset_id(name, type, serial_number)')
        .eq('user_id', empId)
        .order('assigned_at', { ascending: false })
        .limit(20),
    ]);

    const current = currentResult.data || [];
    const history = historyResult.data || [];

    const typeIcons = { Laptop: '\u{1F4BB}', Phone: '\u{1F4F1}', 'Access Card': '\u{1FAAA}', Monitor: '\u{1F5A5}️', Keyboard: '⌨️', Mouse: '\u{1F5B1}️', Headset: '\u{1F3A7}', Other: '\u{1F4E6}' };

    if (!current.length && !history.length) {
      tabContent.innerHTML = `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon">\u{1F4BB}</div>
        <div class="empty-state-title">No assets</div>
        <div class="empty-state-desc">No assets assigned to this employee.</div>
      </div></div>`;
      return;
    }

    const currentHtml = current.length ? `<div class="card" style="margin-bottom:var(--space-4)">
      <div class="card-header"><span class="card-title">Currently Assigned (${current.length})</span></div>
      <div class="card-body">
        <div style="display:grid;gap:var(--space-3)">
          ${current.map(a => `<div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md)">
            <div style="font-size:var(--text-xl)">${typeIcons[a.type] || '\u{1F4E6}'}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(a.name)}</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(a.type)}${a.serial_number ? ' • ' + esc(a.serial_number) : ''}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Assigned</div>
              <div style="font-size:var(--text-xs)">${a.assigned_at ? formatDate(a.assigned_at) : '—'}</div>
            </div>
          </div>`).join('')}
        </div>
      </div>
    </div>` : '';

    const returned = history.filter(h => h.returned_at);
    const historyHtml = returned.length ? `<div class="card">
      <div class="card-header"><span class="card-title">Assignment History</span></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Asset</th><th>Type</th><th>Assigned</th><th>Returned</th></tr></thead>
        <tbody>${returned.map(h => `<tr>
          <td style="font-weight:var(--font-weight-medium)">${typeIcons[h.asset?.type] || '\u{1F4E6}'} ${esc(h.asset?.name || 'Unknown')}</td>
          <td style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(h.asset?.type || '—')}</td>
          <td style="font-size:var(--text-sm)">${formatDate(h.assigned_at)}</td>
          <td style="font-size:var(--text-sm)">${h.returned_at ? formatDate(h.returned_at) : '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>` : '';

    tabContent.innerHTML = currentHtml + historyHtml;
  }

  async function renderDocuments() {
    tabContent.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading documents...</div>`;

    const { data: files, error: filesErr } = await sb
      .from('files')
      .select('*')
      .eq('entity_type', 'employee')
      .eq('entity_id', empId)
      .order('created_at', { ascending: false });

    const docs = files || [];

    tabContent.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">Documents</span>
          <button class="btn btn-primary btn-sm" id="doc-upload-btn">Upload Document</button>
        </div>
        <div class="card-body" id="docs-list"></div>
      </div>
      <input type="file" id="doc-file-input" style="display:none" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.txt">
    `;

    const listEl = document.getElementById('docs-list');

    if (!docs.length) {
      listEl.innerHTML = `<div class="empty-state" style="padding:var(--space-6)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        <div class="empty-state-title">No documents</div>
        <div class="empty-state-desc">Upload documents like offer letters, ID proofs, or certificates.</div>
      </div>`;
    } else {
      const mimeIcons = { 'application/pdf': '📄', 'image/': '🖼️', 'application/msword': '📝' };
      listEl.innerHTML = `<div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
        <tbody>${docs.map(f => {
          const icon = Object.entries(mimeIcons).find(([k]) => (f.mime_type || '').startsWith(k))?.[1] || '📎';
          const size = f.file_size ? (f.file_size < 1024 ? f.file_size + ' B' : f.file_size < 1048576 ? (f.file_size / 1024).toFixed(1) + ' KB' : (f.file_size / 1048576).toFixed(1) + ' MB') : '—';
          return `<tr>
            <td style="font-size:var(--text-sm)">${icon} ${esc(f.file_name)}</td>
            <td style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(f.mime_type || '—')}</td>
            <td style="font-size:var(--text-xs)">${size}</td>
            <td style="font-size:var(--text-xs);color:var(--color-text-secondary)">${formatDate(f.created_at)}</td>
            <td style="display:flex;gap:var(--space-1)">
              <button class="btn btn-ghost btn-sm" data-dl-doc="${esc(f.file_path)}" data-dl-name="${esc(f.file_name)}">Download</button>
              <button class="btn btn-ghost btn-sm" data-del-doc="${f.id}" data-path="${esc(f.file_path)}">Delete</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;

      listEl.querySelectorAll('[data-dl-doc]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const { data, error } = await sb.storage.from('documents').download(btn.dataset.dlDoc);
          if (error) { toast('Download failed: ' + error.message); return; }
          const url = URL.createObjectURL(data);
          const a = document.createElement('a');
          a.href = url;
          a.download = btn.dataset.dlName || 'document';
          a.click();
          URL.revokeObjectURL(url);
        });
      });

      listEl.querySelectorAll('[data-del-doc]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await sb.storage.from('documents').remove([btn.dataset.path]);
          const { error } = await sb.from('files').delete().eq('id', btn.dataset.delDoc);
          if (error) { toast('Failed: ' + error.message); return; }
          await logAction('people', 'file', btn.dataset.delDoc, 'deleted', null, null);
          toast('Document deleted');
          renderDocuments();
        });
      });
    }

    const fileInput = document.getElementById('doc-file-input');
    document.getElementById('doc-upload-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const path = `employees/${empId}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await sb.storage.from('documents').upload(path, file);
      if (uploadErr) return toast('Upload failed: ' + uploadErr.message);
      const { error: insertErr } = await sb.from('files').insert({
        org_id: org?.id,
        uploaded_by: getUser().id,
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        mime_type: file.type,
        entity_type: 'employee',
        entity_id: empId,
      });
      if (insertErr) { toast('Failed: ' + insertErr.message); return; }
      await logAction('people', 'file', null, 'uploaded', null, { file_name: file.name, entity_type: 'employee', entity_id: empId });
      toast('Document uploaded');
      fileInput.value = '';
      renderDocuments();
    });
  }

  renderTab();
}
