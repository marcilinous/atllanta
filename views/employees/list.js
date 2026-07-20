import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';

export default async function employeeList(container) {
  const org = getOrg();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <h1 class="page-title">Employees</h1>
        <p class="page-subtitle">Manage your team directory</p>
      </div>
      <button class="btn btn-primary" id="add-employee-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Employee
      </button>
    </div>
    <div class="card">
      <div class="card-header">
        <input type="text" class="form-input" id="emp-search" placeholder="Search employees..." style="max-width:300px;height:34px">
      </div>
      <div id="emp-table-wrap"></div>
    </div>
  `;

  if (!org) {
    document.getElementById('emp-table-wrap').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div><div class="empty-state-desc">Set up your organization first.</div></div>`;
    return;
  }

  await loadEmployees();
}

async function loadEmployees() {
  const wrap = document.getElementById('emp-table-wrap');
  if (!wrap) return;

  const { data, error } = await sb.from('memberships')
    .select('*, user:auth_user_id(*)')
    .order('created_at', { ascending: false });

  if (error || !data?.length) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
      <div class="empty-state-title">No employees yet</div>
      <div class="empty-state-desc">Add your first team member to get started.</div>
    </div>`;
    return;
  }

  wrap.innerHTML = `<div class="table-wrap"><table class="table">
    <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead>
    <tbody>${data.map(m => `<tr>
      <td>${esc(m.user?.full_name || m.user?.email || '—')}</td>
      <td><span class="badge badge-info">${esc(m.role)}</span></td>
      <td><span class="badge badge-success">Active</span></td>
      <td>${m.created_at ? new Date(m.created_at).toLocaleDateString('en-IN') : '—'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
