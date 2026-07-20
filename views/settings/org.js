import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';

export default async function settingsOrg(container) {
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Organization and account settings</p>
    </div>
    <div class="tabs" id="settings-tabs">
      <button class="tab active" data-tab="org">Organization</button>
      <button class="tab" data-tab="departments">Departments</button>
      <button class="tab" data-tab="leave-types">Leave Types</button>
      <button class="tab" data-tab="holidays">Holidays</button>
      <button class="tab" data-tab="schedules">Work Schedules</button>
    </div>
    <div id="settings-content" style="margin-top:var(--space-4)"></div>
  `;

  let currentTab = 'org';

  document.getElementById('settings-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#settings-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderTab();
  });

  const contentEl = document.getElementById('settings-content');

  if (!org) {
    contentEl.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;color:var(--color-text-tertiary)">No organization configured</div></div>`;
    return;
  }

  async function renderTab() {
    if (currentTab === 'org') renderOrgSettings();
    else if (currentTab === 'departments') await renderDepartments();
    else if (currentTab === 'leave-types') await renderLeaveTypes();
    else if (currentTab === 'holidays') await renderHolidays();
    else if (currentTab === 'schedules') await renderSchedules();
  }

  function renderOrgSettings() {
    contentEl.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Organization Details</span></div>
        <div class="card-body">
          <div style="display:grid;gap:var(--space-4);max-width:480px">
            <div class="form-group"><label class="form-label">Name</label><input type="text" class="form-input" value="${esc(org.name)}" ${isAdmin ? '' : 'disabled'} id="org-name-edit"></div>
            <div class="form-group"><label class="form-label">Timezone</label><input type="text" class="form-input" value="${esc(org.timezone || 'Asia/Kolkata')}" disabled></div>
            <div class="form-group"><label class="form-label">Currency</label><input type="text" class="form-input" value="${esc(org.currency || 'INR')}" disabled></div>
            ${isAdmin ? '<button class="btn btn-primary" id="save-org">Save Changes</button>' : ''}
          </div>
        </div>
      </div>`;

    if (isAdmin) {
      document.getElementById('save-org')?.addEventListener('click', async () => {
        const newName = document.getElementById('org-name-edit').value.trim();
        if (!newName) return;
        const { error } = await sb.from('organizations').update({ name: newName }).eq('id', org.id);
        if (error) toast('Error: ' + error.message);
        else toast('Organization updated');
      });
    }
  }

  async function renderDepartments() {
    const [{ data: depts }, { data: teams }] = await Promise.all([
      sb.from('departments').select('*').order('name'),
      sb.from('teams').select('*').order('name'),
    ]);

    contentEl.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">Departments & Teams</span>
          ${isAdmin ? '<button class="btn btn-primary btn-sm" id="add-dept-btn">+ Add Department</button>' : ''}
        </div>
        <div class="card-body">
          ${(depts || []).length ? (depts || []).map(d => {
            const deptTeams = (teams || []).filter(t => t.department_id === d.id);
            return `<div style="border:1px solid var(--color-border);border-radius:var(--radius-md);margin-bottom:var(--space-3);overflow:hidden">
              <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3) var(--space-4);background:var(--color-bg-secondary)">
                <div style="font-weight:var(--font-weight-semibold)">${esc(d.name)}</div>
                <div style="display:flex;gap:var(--space-2)">
                  ${isAdmin ? `<button class="btn btn-ghost btn-sm" data-add-team="${d.id}">+ Team</button>
                  <button class="btn btn-ghost btn-sm" data-del-dept="${d.id}" style="color:var(--color-error)">&times;</button>` : ''}
                </div>
              </div>
              ${deptTeams.length ? `<div style="padding:var(--space-2) var(--space-4)">
                ${deptTeams.map(t => `<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
                  <span style="font-size:var(--text-sm)">${esc(t.name)}</span>
                  ${isAdmin ? `<button class="btn btn-ghost btn-sm" data-del-team="${t.id}" style="color:var(--color-error);font-size:var(--text-xs)">&times;</button>` : ''}
                </div>`).join('')}
              </div>` : ''}
            </div>`;
          }).join('') : '<div style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-4)">No departments yet</div>'}
        </div>
      </div>`;

    if (isAdmin) {
      document.getElementById('add-dept-btn')?.addEventListener('click', () => {
        const f = document.createElement('div');
        f.innerHTML = `<div style="display:grid;gap:var(--space-3)">
          <div class="form-group"><label class="form-label">Department Name</label><input type="text" class="form-input" id="dept-name"></div>
          <button class="btn btn-primary" id="dept-save">Create</button>
        </div>`;
        openModal('Add Department', f);
        f.querySelector('#dept-save').addEventListener('click', async () => {
          const name = f.querySelector('#dept-name').value.trim();
          if (!name) return toast('Name required');
          const { error } = await sb.from('departments').insert({ org_id: org.id, name });
          if (error) return toast(error.message);
          closeModal(); toast('Department added'); renderDepartments();
        });
      });

      contentEl.querySelectorAll('[data-add-team]').forEach(btn => {
        btn.addEventListener('click', () => {
          const f = document.createElement('div');
          f.innerHTML = `<div style="display:grid;gap:var(--space-3)">
            <div class="form-group"><label class="form-label">Team Name</label><input type="text" class="form-input" id="team-name"></div>
            <button class="btn btn-primary" id="team-save">Create</button>
          </div>`;
          openModal('Add Team', f);
          f.querySelector('#team-save').addEventListener('click', async () => {
            const name = f.querySelector('#team-name').value.trim();
            if (!name) return toast('Name required');
            const { error } = await sb.from('teams').insert({ org_id: org.id, department_id: btn.dataset.addTeam, name });
            if (error) return toast(error.message);
            closeModal(); toast('Team added'); renderDepartments();
          });
        });
      });

      contentEl.querySelectorAll('[data-del-dept]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this department?')) return;
          const { error } = await sb.from('departments').delete().eq('id', btn.dataset.delDept);
          if (error) return toast(error.message);
          toast('Department deleted'); renderDepartments();
        });
      });

      contentEl.querySelectorAll('[data-del-team]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this team?')) return;
          const { error } = await sb.from('teams').delete().eq('id', btn.dataset.delTeam);
          if (error) return toast(error.message);
          toast('Team deleted'); renderDepartments();
        });
      });
    }
  }

  async function renderLeaveTypes() {
    const { data: types } = await sb.from('leave_types').select('*').order('name');

    contentEl.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">Leave Types</span>
          ${isAdmin ? '<button class="btn btn-primary btn-sm" id="add-lt-btn">+ Add Leave Type</button>' : ''}
        </div>
        <div class="card-body">
          ${(types || []).length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Name</th><th>Code</th><th>Annual Quota</th><th>Carry Forward</th><th>Paid</th><th>Active</th><th></th></tr></thead>
            <tbody>${types.map(t => `<tr>
              <td style="font-weight:var(--font-weight-medium)">${esc(t.name)}</td>
              <td><span class="badge badge-neutral">${esc(t.code)}</span></td>
              <td>${t.annual_quota} days</td>
              <td>${t.carry_forward ? `Yes (max ${t.max_carry_forward})` : 'No'}</td>
              <td>${t.is_paid ? 'Yes' : 'No'}</td>
              <td><span class="badge badge-${t.is_active ? 'success' : 'error'}"><span class="badge-dot"></span>${t.is_active ? 'Active' : 'Inactive'}</span></td>
              <td>${isAdmin ? `<button class="btn btn-ghost btn-sm" data-del-lt="${t.id}" style="color:var(--color-error)">&times;</button>` : ''}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : '<div style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-4)">No leave types configured</div>'}
        </div>
      </div>`;

    if (isAdmin) {
      document.getElementById('add-lt-btn')?.addEventListener('click', () => {
        const f = document.createElement('div');
        f.innerHTML = `<div style="display:grid;gap:var(--space-4)">
          <div class="form-group"><label class="form-label">Name</label><input type="text" class="form-input" id="lt-name" placeholder="e.g. Casual Leave"></div>
          <div class="form-group"><label class="form-label">Code</label><input type="text" class="form-input" id="lt-code" placeholder="e.g. CL" style="text-transform:uppercase"></div>
          <div class="form-group"><label class="form-label">Annual Quota (days)</label><input type="number" class="form-input" id="lt-quota" value="12" min="0"></div>
          <div class="form-group"><label style="display:flex;align-items:center;gap:var(--space-2)"><input type="checkbox" id="lt-carry"> Carry forward unused days</label></div>
          <div class="form-group"><label style="display:flex;align-items:center;gap:var(--space-2)"><input type="checkbox" id="lt-paid" checked> Paid leave</label></div>
          <button class="btn btn-primary" id="lt-save">Create Leave Type</button>
        </div>`;
        openModal('Add Leave Type', f);
        f.querySelector('#lt-save').addEventListener('click', async () => {
          const name = f.querySelector('#lt-name').value.trim();
          const code = f.querySelector('#lt-code').value.trim().toUpperCase();
          if (!name || !code) return toast('Name and code required');
          const { error } = await sb.from('leave_types').insert({
            org_id: org.id, name, code,
            annual_quota: parseInt(f.querySelector('#lt-quota').value) || 12,
            carry_forward: f.querySelector('#lt-carry').checked,
            is_paid: f.querySelector('#lt-paid').checked,
          });
          if (error) return toast(error.message);
          closeModal(); toast('Leave type added'); renderLeaveTypes();
        });
      });

      contentEl.querySelectorAll('[data-del-lt]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this leave type?')) return;
          const { error } = await sb.from('leave_types').delete().eq('id', btn.dataset.delLt);
          if (error) return toast(error.message);
          toast('Leave type deleted'); renderLeaveTypes();
        });
      });
    }
  }

  async function renderHolidays() {
    const year = new Date().getFullYear();
    const { data: holidays } = await sb.from('holidays').select('*').eq('year', year).order('date');

    contentEl.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">Holidays ${year}</span>
          ${isAdmin ? '<button class="btn btn-primary btn-sm" id="add-hol-btn">+ Add Holiday</button>' : ''}
        </div>
        <div class="card-body">
          ${(holidays || []).length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Date</th><th>Name</th><th>Type</th><th></th></tr></thead>
            <tbody>${holidays.map(h => `<tr>
              <td>${new Date(h.date).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
              <td style="font-weight:var(--font-weight-medium)">${esc(h.name)}</td>
              <td><span class="badge badge-${h.is_optional ? 'warning' : 'success'}">${h.is_optional ? 'Optional' : 'Mandatory'}</span></td>
              <td>${isAdmin ? `<button class="btn btn-ghost btn-sm" data-del-hol="${h.id}" style="color:var(--color-error)">&times;</button>` : ''}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : '<div style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-4)">No holidays configured for this year</div>'}
        </div>
      </div>`;

    if (isAdmin) {
      document.getElementById('add-hol-btn')?.addEventListener('click', () => {
        const f = document.createElement('div');
        f.innerHTML = `<div style="display:grid;gap:var(--space-4)">
          <div class="form-group"><label class="form-label">Name</label><input type="text" class="form-input" id="hol-name" placeholder="e.g. Independence Day"></div>
          <div class="form-group"><label class="form-label">Date</label><input type="date" class="form-input" id="hol-date"></div>
          <div class="form-group"><label style="display:flex;align-items:center;gap:var(--space-2)"><input type="checkbox" id="hol-optional"> Optional holiday</label></div>
          <button class="btn btn-primary" id="hol-save">Add Holiday</button>
        </div>`;
        openModal('Add Holiday', f);
        f.querySelector('#hol-save').addEventListener('click', async () => {
          const name = f.querySelector('#hol-name').value.trim();
          const date = f.querySelector('#hol-date').value;
          if (!name || !date) return toast('Name and date required');
          const { error } = await sb.from('holidays').insert({
            org_id: org.id, name, date,
            is_optional: f.querySelector('#hol-optional').checked,
            year: new Date(date).getFullYear(),
          });
          if (error) return toast(error.message);
          closeModal(); toast('Holiday added'); renderHolidays();
        });
      });

      contentEl.querySelectorAll('[data-del-hol]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this holiday?')) return;
          const { error } = await sb.from('holidays').delete().eq('id', btn.dataset.delHol);
          if (error) return toast(error.message);
          toast('Holiday deleted'); renderHolidays();
        });
      });
    }
  }

  async function renderSchedules() {
    const { data: schedules } = await sb.from('work_schedules').select('*').order('name');

    contentEl.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">Work Schedules</span>
          ${isAdmin ? '<button class="btn btn-primary btn-sm" id="add-ws-btn">+ Add Schedule</button>' : ''}
        </div>
        <div class="card-body">
          ${(schedules || []).length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Name</th><th>Shift</th><th>Weekly Off</th><th>Default</th><th></th></tr></thead>
            <tbody>${schedules.map(s => {
              const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
              const offs = (s.weekly_offs || []).map(d => days[d % 7] || d).join(', ');
              return `<tr>
                <td style="font-weight:var(--font-weight-medium)">${esc(s.name)}</td>
                <td>${s.shift_start} – ${s.shift_end}</td>
                <td>${offs || '—'}</td>
                <td>${s.is_default ? '<span class="badge badge-success">Default</span>' : ''}</td>
                <td>${isAdmin ? `<button class="btn btn-ghost btn-sm" data-del-ws="${s.id}" style="color:var(--color-error)">&times;</button>` : ''}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>` : '<div style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-4)">No work schedules configured</div>'}
        </div>
      </div>`;

    if (isAdmin) {
      document.getElementById('add-ws-btn')?.addEventListener('click', () => {
        const f = document.createElement('div');
        f.innerHTML = `<div style="display:grid;gap:var(--space-4)">
          <div class="form-group"><label class="form-label">Schedule Name</label><input type="text" class="form-input" id="ws-name" placeholder="e.g. Default, Night Shift"></div>
          <div style="display:flex;gap:var(--space-3)">
            <div class="form-group" style="flex:1"><label class="form-label">Shift Start</label><input type="time" class="form-input" id="ws-start" value="09:00"></div>
            <div class="form-group" style="flex:1"><label class="form-label">Shift End</label><input type="time" class="form-input" id="ws-end" value="18:00"></div>
          </div>
          <div class="form-group"><label style="display:flex;align-items:center;gap:var(--space-2)"><input type="checkbox" id="ws-default"> Set as default</label></div>
          <button class="btn btn-primary" id="ws-save">Create Schedule</button>
        </div>`;
        openModal('Add Work Schedule', f);
        f.querySelector('#ws-save').addEventListener('click', async () => {
          const name = f.querySelector('#ws-name').value.trim();
          if (!name) return toast('Name required');
          const { error } = await sb.from('work_schedules').insert({
            org_id: org.id, name,
            shift_start: f.querySelector('#ws-start').value,
            shift_end: f.querySelector('#ws-end').value,
            is_default: f.querySelector('#ws-default').checked,
          });
          if (error) return toast(error.message);
          closeModal(); toast('Schedule added'); renderSchedules();
        });
      });

      contentEl.querySelectorAll('[data-del-ws]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this schedule?')) return;
          const { error } = await sb.from('work_schedules').delete().eq('id', btn.dataset.delWs);
          if (error) return toast(error.message);
          toast('Schedule deleted'); renderSchedules();
        });
      });
    }
  }

  renderTab();
}
