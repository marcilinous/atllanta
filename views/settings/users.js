import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, initials, avColor, formatDate, timeAgo } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';
import { logAction } from '../../js/audit.js';

export default async function settingsUsers(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Staff & Access</h1>
        <p class="page-subtitle">Add staff, set roles, and place them in the reporting hierarchy</p>
      </div>
      ${isAdmin ? '<button class="btn btn-primary" id="invite-btn">+ Add Staff</button>' : ''}
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        <input type="text" class="form-input" id="member-search" placeholder="Search by name or email..." style="max-width:300px;height:34px;flex:1">
        <select class="form-input" id="member-role-filter" style="max-width:160px;height:34px">
          <option value="">All roles</option>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
          <option value="member">Member</option>
        </select>
      </div>
      <div id="members-table-wrap">
        <div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>
      </div>
    </div>
  `;

  if (!org) {
    document.getElementById('members-table-wrap').innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">No organization</div></div>`;
    return;
  }

  let allMembers = [];

  async function loadMembers() {
    const { data: members, error } = await sb
      .from('memberships')
      .select('*')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: true });

    if (error) {
      toast('Failed to load members: ' + error.message);
      return;
    }
    allMembers = members || [];
    renderTable();
  }

  function renderTable() {
    const wrap = document.getElementById('members-table-wrap');
    const searchTerm = (document.getElementById('member-search')?.value || '').toLowerCase();
    const roleFilter = document.getElementById('member-role-filter')?.value || '';

    let filtered = allMembers;
    if (searchTerm) {
      filtered = filtered.filter(m =>
        (m.full_name || '').toLowerCase().includes(searchTerm) ||
        (m.email || '').toLowerCase().includes(searchTerm)
      );
    }
    if (roleFilter) filtered = filtered.filter(m => m.role === roleFilter);

    if (!filtered.length) {
      wrap.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
        <div class="empty-state-title">${searchTerm || roleFilter ? 'No matching members' : 'No members yet'}</div>
        <div class="empty-state-desc">${searchTerm || roleFilter ? 'Try adjusting your filters.' : 'Invite your first team member to get started.'}</div>
      </div>`;
      return;
    }

    const roleColors = { owner: 'error', admin: 'warning', manager: 'info', member: 'neutral' };

    wrap.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Member</th><th>Role</th><th>Invited</th><th>Joined</th>${isAdmin ? '<th>Actions</th>' : ''}</tr></thead>
      <tbody>${filtered.map(m => {
        const displayName = m.full_name || m.email || '—';
        const isSelf = m.user_id === user?.id;
        return `<tr>
          <td>
            <div style="display:flex;align-items:center;gap:var(--space-3)">
              <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${avColor(displayName)};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(displayName)}</div>
              <div>
                <div style="font-weight:var(--font-weight-medium)">${esc(displayName)}${isSelf ? ' <span style="color:var(--color-text-tertiary);font-weight:normal">(you)</span>' : ''}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(m.email || '')}</div>
              </div>
            </div>
          </td>
          <td><span class="badge badge-${roleColors[m.role] || 'neutral'}">${esc(m.role || 'member')}</span></td>
          <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${m.invited_at ? formatDate(m.invited_at) : '—'}</td>
          <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${m.created_at ? formatDate(m.created_at) : '—'}</td>
          ${isAdmin ? `<td>
            <div style="display:flex;gap:var(--space-2);align-items:center">
              ${!isSelf ? `<select class="form-input" data-role-change="${m.id}" style="height:30px;width:auto;font-size:var(--text-xs);padding:0 var(--space-2)">
                <option value="member" ${m.role === 'member' ? 'selected' : ''}>Member</option>
                <option value="manager" ${m.role === 'manager' ? 'selected' : ''}>Manager</option>
                <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
                <option value="owner" ${m.role === 'owner' ? 'selected' : ''}>Owner</option>
              </select>
              <button class="btn btn-ghost btn-sm" data-remove-member="${m.id}" style="color:var(--color-error)" title="Remove member">&times;</button>` : '<span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">—</span>'}
            </div>
          </td>` : ''}
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    if (isAdmin) {
      // Role change handlers
      wrap.querySelectorAll('[data-role-change]').forEach(select => {
        select.addEventListener('change', async () => {
          const memberId = select.dataset.roleChange;
          const newRole = select.value;
          const member = allMembers.find(m => m.id === memberId);
          const { error } = await sb.from('memberships').update({ role: newRole }).eq('id', memberId);
          if (error) {
            toast('Failed to update role: ' + error.message);
            loadMembers();
            return;
          }
          await logAction('people', 'membership', memberId, 'role_changed', { role: member?.role }, { role: newRole });
          toast('Role updated');
        });
      });

      // Remove member handlers
      wrap.querySelectorAll('[data-remove-member]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Remove this member from the organization?')) return;
          const memberId = btn.dataset.removeMember;
          const member = allMembers.find(m => m.id === memberId);
          const { error } = await sb.from('memberships').delete().eq('id', memberId);
          if (error) {
            toast('Failed to remove member: ' + error.message);
            return;
          }
          await logAction('people', 'membership', memberId, 'removed', { email: member?.email, role: member?.role }, null);
          toast('Member removed');
          loadMembers();
        });
      });
    }
  }

  await loadMembers();

  document.getElementById('member-search')?.addEventListener('input', renderTable);
  document.getElementById('member-role-filter')?.addEventListener('change', renderTable);

  // Add staff modal
  if (isAdmin) {
    document.getElementById('invite-btn')?.addEventListener('click', async () => {
      const [{ data: depts }, { data: staff }] = await Promise.all([
        sb.from('departments').select('id, name').order('name'),
        sb.from('users').select('id, full_name, email').eq('status', 'active').order('full_name'),
      ]);

      const f = document.createElement('div');
      f.innerHTML = `
        <div style="display:grid;gap:var(--space-4)">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            <div class="form-group" style="margin:0">
              <label class="form-label">Full name</label>
              <input type="text" class="form-input" id="invite-name" placeholder="Jane Doe">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Email *</label>
              <input type="email" class="form-input" id="invite-email" placeholder="jane@school.edu" required>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Role</label>
              <select class="form-input" id="invite-role">
                <option value="member">Member (staff)</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Designation</label>
              <input type="text" class="form-input" id="invite-designation" placeholder="e.g. Teacher">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Department</label>
              <select class="form-input" id="invite-dept">
                <option value="">— None —</option>
                ${(depts || []).map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Reporting manager</label>
              <select class="form-input" id="invite-manager">
                <option value="">— None —</option>
                ${(staff || []).map(s => `<option value="${s.id}">${esc(s.full_name || s.email)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Date of joining</label>
            <input type="date" class="form-input" id="invite-doj" style="max-width:200px">
          </div>
          <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">A login is created immediately with a temporary password you can share — no email required.</div>
          <button class="btn btn-primary" id="invite-save">Add staff member</button>
        </div>`;
      openModal('Add Staff Member', f);

      f.querySelector('#invite-save').addEventListener('click', async () => {
        const email = f.querySelector('#invite-email').value.trim();
        const role = f.querySelector('#invite-role').value;
        const full_name = f.querySelector('#invite-name').value.trim();
        const designation = f.querySelector('#invite-designation').value.trim();
        const department_id = f.querySelector('#invite-dept').value || null;
        const reporting_manager_id = f.querySelector('#invite-manager').value || null;
        const date_of_joining = f.querySelector('#invite-doj').value || null;
        if (!email) return toast('Email is required');

        const btn = f.querySelector('#invite-save');
        btn.disabled = true;
        btn.textContent = 'Adding...';

        try {
          const { data: { session } } = await sb.auth.getSession();
          const resp = await fetch('/api/create-org', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ action: 'invite', email, role, full_name, designation, department_id, reporting_manager_id, date_of_joining }),
          });
          const result = await resp.json();

          if (!resp.ok) {
            toast(result.error || 'Failed to add staff');
            btn.disabled = false;
            btn.textContent = 'Add staff member';
            return;
          }

          await logAction('people', 'employee', result.user_id || null, 'created', null, { email, role });
          if (result.user_id) await publishEvent('people.employee.created', { employee_id: result.user_id, name: full_name || email });
          closeModal();

          if (result.new_account && result.temp_password) {
            const info = document.createElement('div');
            info.innerHTML = `
              <div style="display:grid;gap:var(--space-4)">
                <div style="text-align:center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2" width="48" height="48" style="margin:0 auto var(--space-3)"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-lg)">Account Created</div>
                </div>
                <div style="background:var(--color-bg-secondary);border-radius:var(--radius-md);padding:var(--space-4)">
                  <div style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-2)">Share these credentials with the new member:</div>
                  <div style="font-size:var(--text-sm);margin-bottom:var(--space-1)"><strong>Email:</strong> ${esc(email)}</div>
                  <div style="font-size:var(--text-sm)"><strong>Temporary Password:</strong> <code style="background:var(--color-bg-tertiary);padding:var(--space-1) var(--space-2);border-radius:var(--radius-sm);user-select:all">${esc(result.temp_password)}</code></div>
                </div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);text-align:center">They should change their password after first login.</div>
                <button class="btn btn-primary" id="invite-done-btn">Done</button>
              </div>`;
            openModal('Member Invited', info);
            info.querySelector('#invite-done-btn').addEventListener('click', closeModal);
          } else {
            toast('Staff member added: ' + email);
          }
          loadMembers();
        } catch (err) {
          toast('Failed to add staff: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Add staff member';
        }
      });
    });
  }
}
