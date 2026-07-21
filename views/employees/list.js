import sb from '../../js/supabase.js';
import { getOrg, getMembership, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, initials, avColor } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

export default async function employeeList(container) {
  const org = getOrg();
  const membership = getMembership();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Employees</h1>
        <p class="page-subtitle">Manage your team directory</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <a href="#/employees/orgchart" class="btn btn-secondary">Org Chart</a>
        <a href="#/employees/import" class="btn btn-secondary">Import CSV</a>
        <button class="btn btn-primary" id="add-employee-btn">+ Add Employee</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        <input type="text" class="form-input" id="emp-search" placeholder="Search by name or email..." style="max-width:300px;height:34px;flex:1">
        <select class="form-input" id="emp-dept-filter" style="max-width:180px;height:34px">
          <option value="">All departments</option>
        </select>
        <select class="form-input" id="emp-status-filter" style="max-width:140px;height:34px">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="on_notice">On Notice</option>
          <option value="exited">Exited</option>
        </select>
      </div>
      <div id="emp-table-wrap"></div>
    </div>
  `;

  if (!org) {
    document.getElementById('emp-table-wrap').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`;
    return;
  }

  let allEmployees = [];
  let departments = [];

  const [{ data: users }, { data: depts }] = await Promise.all([
    sb.from('users').select('*, department:department_id(name)').order('full_name'),
    sb.from('departments').select('*').order('name'),
  ]);
  allEmployees = users || [];
  departments = depts || [];

  // If users table is empty, fall back to memberships
  if (!allEmployees.length) {
    const { data: members } = await sb.from('memberships').select('*').order('created_at', { ascending: false });
    if (members?.length) {
      allEmployees = members.map(m => ({
        id: m.user_id || m.id,
        full_name: m.email,
        email: m.email,
        role: m.role,
        status: 'active',
        created_at: m.created_at,
      }));
    }
  }

  const deptSelect = document.getElementById('emp-dept-filter');
  departments.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    deptSelect.appendChild(opt);
  });

  function renderTable() {
    const wrap = document.getElementById('emp-table-wrap');
    const searchTerm = (document.getElementById('emp-search')?.value || '').toLowerCase();
    const deptFilter = document.getElementById('emp-dept-filter')?.value || '';
    const statusFilter = document.getElementById('emp-status-filter')?.value || '';

    let filtered = allEmployees;
    if (searchTerm) {
      filtered = filtered.filter(e =>
        (e.full_name || '').toLowerCase().includes(searchTerm) ||
        (e.email || '').toLowerCase().includes(searchTerm)
      );
    }
    if (deptFilter) filtered = filtered.filter(e => e.department_id === deptFilter);
    if (statusFilter) filtered = filtered.filter(e => e.status === statusFilter);

    if (!filtered.length) {
      wrap.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
        <div class="empty-state-title">${searchTerm || deptFilter || statusFilter ? 'No matching employees' : 'No employees yet'}</div>
        <div class="empty-state-desc">${searchTerm || deptFilter || statusFilter ? 'Try adjusting your filters.' : 'Add your first team member to get started.'}</div>
      </div>`;
      return;
    }

    wrap.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Employee</th><th>Department</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead>
      <tbody>${filtered.map(e => {
        const statusColors = { active: 'success', on_notice: 'warning', exited: 'error' };
        return `<tr style="cursor:pointer" data-emp-id="${e.id}">
          <td>
            <div style="display:flex;align-items:center;gap:var(--space-3)">
              <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${avColor(e.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(e.full_name)}</div>
              <div>
                <div style="font-weight:var(--font-weight-medium)">${esc(e.full_name || '—')}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(e.email || '')}</div>
              </div>
            </div>
          </td>
          <td>${esc(e.department?.name || e.designation || '—')}</td>
          <td><span class="badge badge-info">${esc((e.role || 'member').replaceAll('_', ' '))}</span></td>
          <td><span class="badge badge-${statusColors[e.status] || 'neutral'}"><span class="badge-dot"></span>${esc(e.status || 'active')}</span></td>
          <td>${e.date_of_joining ? new Date(e.date_of_joining).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : e.created_at ? new Date(e.created_at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    wrap.querySelectorAll('tr[data-emp-id]').forEach(row => {
      row.addEventListener('click', () => showEmployeeProfile(row.dataset.empId));
    });
  }

  renderTable();

  document.getElementById('emp-search').addEventListener('input', renderTable);
  document.getElementById('emp-dept-filter').addEventListener('change', renderTable);
  document.getElementById('emp-status-filter').addEventListener('change', renderTable);

  document.getElementById('add-employee-btn').addEventListener('click', () => {
    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div class="form-group"><label class="form-label">Full Name</label><input type="text" class="form-input" id="ae-name" required></div>
        <div class="form-group"><label class="form-label">Email</label><input type="email" class="form-input" id="ae-email" required></div>
        <div class="form-group"><label class="form-label">Phone</label><input type="text" class="form-input" id="ae-phone"></div>
        <div class="form-group"><label class="form-label">Designation</label><input type="text" class="form-input" id="ae-designation"></div>
        <div class="form-group">
          <label class="form-label">Department</label>
          <select class="form-input" id="ae-dept"><option value="">None</option>${departments.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select class="form-input" id="ae-role">
            <option value="member">Member</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Date of Joining</label><input type="date" class="form-input" id="ae-doj"></div>
        <button class="btn btn-primary" id="ae-save">Add Employee</button>
      </div>`;
    openModal('Add Employee', f);

    f.querySelector('#ae-save').addEventListener('click', async () => {
      const name = f.querySelector('#ae-name').value.trim();
      const email = f.querySelector('#ae-email').value.trim();
      if (!name || !email) return toast('Name and email are required');

      const btn = f.querySelector('#ae-save');
      btn.disabled = true;
      btn.textContent = 'Adding...';

      const { error } = await sb.from('users').insert({
        id: crypto.randomUUID(),
        org_id: org.id,
        full_name: name,
        email,
        phone: f.querySelector('#ae-phone').value.trim() || null,
        designation: f.querySelector('#ae-designation').value.trim() || null,
        department_id: f.querySelector('#ae-dept').value || null,
        role: f.querySelector('#ae-role').value,
        date_of_joining: f.querySelector('#ae-doj').value || null,
        status: 'active',
      });

      if (error) {
        toast(error.message);
        btn.disabled = false;
        btn.textContent = 'Add Employee';
        return;
      }

      closeModal();
      toast('Employee added');
      await logAction('people', 'employee', null, 'created', null, { full_name: name, email });
      await publishEvent('people.employee.created', { name, email });
      const { data: refreshed } = await sb.from('users').select('*, department:department_id(name)').order('full_name');
      allEmployees = refreshed || [];
      renderTable();
    });
  });

  function showEmployeeProfile(empId) {
    const emp = allEmployees.find(e => e.id === empId);
    if (!emp) return;

    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div style="display:flex;align-items:center;gap:var(--space-4)">
          <div style="width:56px;height:56px;border-radius:var(--radius-full);background:${avColor(emp.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold);font-size:var(--text-xl)">${initials(emp.full_name)}</div>
          <div>
            <div style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold)">${esc(emp.full_name || '—')}</div>
            <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(emp.designation || emp.role || '—')}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <div class="card" style="padding:var(--space-3)"><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Email</div><div style="font-size:var(--text-sm)">${esc(emp.email || '—')}</div></div>
          <div class="card" style="padding:var(--space-3)"><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Phone</div><div style="font-size:var(--text-sm)">${esc(emp.phone || '—')}</div></div>
          <div class="card" style="padding:var(--space-3)"><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Department</div><div style="font-size:var(--text-sm)">${esc(emp.department?.name || '—')}</div></div>
          <div class="card" style="padding:var(--space-3)"><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Status</div><div style="font-size:var(--text-sm)">${esc(emp.status || 'active')}</div></div>
          <div class="card" style="padding:var(--space-3)"><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Role</div><div style="font-size:var(--text-sm)">${esc((emp.role || 'member').replaceAll('_', ' '))}</div></div>
          <div class="card" style="padding:var(--space-3)"><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Joined</div><div style="font-size:var(--text-sm)">${emp.date_of_joining ? new Date(emp.date_of_joining).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div></div>
        </div>
      </div>`;
    openModal('Employee Profile', f);
  }
}
