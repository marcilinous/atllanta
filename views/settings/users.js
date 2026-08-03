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
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card-header"><span class="card-title">Who sees what</span></div>
      <div class="card-body" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--space-3);font-size:var(--text-sm)">
        <div style="display:flex;gap:var(--space-2)"><span class="badge badge-error" style="height:fit-content">Owner / Admin (HR)</span><span style="color:var(--color-text-secondary)">Sees & edits <strong>everyone</strong> in the school — all attendance, leave, and CRM records.</span></div>
        <div style="display:flex;gap:var(--space-2)"><span class="badge badge-info" style="height:fit-content">Manager</span><span style="color:var(--color-text-secondary)">Sees their <strong>whole reporting line</strong> — direct reports and their reports, recursively.</span></div>
        <div style="display:flex;gap:var(--space-2)"><span class="badge badge-neutral" style="height:fit-content">Member</span><span style="color:var(--color-text-secondary)">Sees <strong>only their own</strong> records; CRM records they own or created.</span></div>
      </div>
    </div>
    <div id="self-profile-banner"></div>
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
  let profileById = {};

  // Membership roles can be broader (super_admin, etc.); map to the users
  // enum (owner/admin/manager/member) when materialising an employee profile.
  const roleMap = { super_admin: 'owner', agency_admin: 'admin', client_admin: 'admin', client_member: 'member' };
  const toUserRole = (r) => roleMap[r] || (['owner', 'admin', 'manager', 'member'].includes(r) ? r : 'member');

  async function loadMembers() {
    const [{ data: members, error }, { data: staff }] = await Promise.all([
      sb.from('memberships').select('*').eq('organization_id', org.id).order('created_at', { ascending: true }),
      sb.from('users').select('id, full_name, email, role, reporting_manager_id').eq('org_id', org.id),
    ]);

    if (error) {
      toast('Failed to load members: ' + error.message);
      return;
    }
    allMembers = members || [];
    profileById = Object.fromEntries((staff || []).map(p => [p.id, p]));
    renderTable();
    renderSelfBanner();
  }

  // The founding admin often has a login but no employee profile, so they
  // can't appear in the org chart or be assigned as a manager. Offer a
  // one-click fix.
  function renderSelfBanner() {
    const el = document.getElementById('self-profile-banner');
    if (!el) return;
    if (!isAdmin || !user || profileById[user.id]) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="card" style="margin-bottom:var(--space-4);border-color:var(--color-accent)">
      <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <div style="font-size:var(--text-sm)">You're not in the staff directory yet — add yourself so you appear in the org chart and can manage a reporting line.</div>
        <button class="btn btn-primary btn-sm" id="add-self">Add me to the directory</button>
      </div>
    </div>`;
    el.querySelector('#add-self').addEventListener('click', async () => {
      const created = await ensureProfile(user.id);
      if (created) { toast('Added to directory'); loadMembers(); }
    });
  }

  // Ensure a person has an employee profile so they can sit in the hierarchy
  // (as a reportee or a manager). Admin can insert/update org users via RLS.
  async function ensureProfile(userId) {
    if (profileById[userId]) return profileById[userId];
    const mem = allMembers.find(a => a.user_id === userId);
    if (!mem) return null;
    const row = { id: userId, org_id: org.id, full_name: mem.full_name || mem.email, email: mem.email, role: toUserRole(mem.role), status: 'active' };
    const { error } = await sb.from('users').upsert(row, { onConflict: 'id' });
    if (error) { toast('Could not create profile: ' + error.message); return null; }
    profileById[userId] = row;
    return row;
  }

  // Everyone below `userId` in the tree — excluded as manager options to
  // prevent cycles.
  function descendantsOf(userId) {
    const set = new Set();
    const walk = (id) => {
      Object.values(profileById).forEach(p => {
        if (p.reporting_manager_id === id && !set.has(p.id)) { set.add(p.id); walk(p.id); }
      });
    };
    walk(userId);
    return set;
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
      <thead><tr><th>Member</th><th>Role</th><th>Reports to</th><th>Joined</th>${isAdmin ? '<th>Actions</th>' : ''}</tr></thead>
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
          <td>${(() => {
            const profile = profileById[m.user_id];
            const managerId = profile?.reporting_manager_id || '';
            if (!isAdmin) {
              const mgr = allMembers.find(x => x.user_id === managerId);
              return `<span style="font-size:var(--text-sm);color:var(--color-text-secondary)">${mgr ? esc(mgr.full_name || mgr.email) : '—'}</span>`;
            }
            const desc = descendantsOf(m.user_id);
            const opts = allMembers.filter(x => x.user_id !== m.user_id && !desc.has(x.user_id));
            return `<select class="form-input" data-manager-change="${m.user_id}" style="height:30px;width:auto;max-width:170px;font-size:var(--text-xs);padding:0 var(--space-2)">
              <option value="">— None —</option>
              ${opts.map(x => `<option value="${x.user_id}" ${managerId === x.user_id ? 'selected' : ''}>${esc(x.full_name || x.email)}</option>`).join('')}
            </select>`;
          })()}</td>
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
      // Role change handlers — keep membership (access) and profile in sync
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
          if (member) {
            await ensureProfile(member.user_id);
            await sb.from('users').update({ role: newRole, updated_at: new Date().toISOString() }).eq('id', member.user_id);
          }
          await logAction('people', 'membership', memberId, 'role_changed', { role: member?.role }, { role: newRole });
          toast('Role updated');
          loadMembers();
        });
      });

      // Reporting-manager change — builds the hierarchy that drives access
      wrap.querySelectorAll('[data-manager-change]').forEach(select => {
        select.addEventListener('change', async () => {
          const userId = select.dataset.managerChange;
          const managerId = select.value || null;
          await ensureProfile(userId);
          if (managerId) await ensureProfile(managerId);
          const { error } = await sb.from('users').update({ reporting_manager_id: managerId, updated_at: new Date().toISOString() }).eq('id', userId);
          if (error) {
            toast('Could not update reporting line: ' + error.message);
            loadMembers();
            return;
          }
          await logAction('people', 'employee', userId, 'manager_changed', null, { reporting_manager_id: managerId });
          toast('Reporting line updated');
          loadMembers();
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
          <div class="crm-cols-2">
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
