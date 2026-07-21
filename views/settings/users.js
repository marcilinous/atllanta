import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, initials, avColor, formatDate, timeAgo } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

export default async function settingsUsers(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">User Management</h1>
        <p class="page-subtitle">Manage team members and roles</p>
      </div>
      ${isAdmin ? '<button class="btn btn-primary" id="invite-btn">+ Invite Member</button>' : ''}
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
      <div id="members-table-wrap"></div>
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
          const { error } = await sb.from('memberships').update({ role: newRole }).eq('id', memberId);
          if (error) {
            toast('Failed to update role: ' + error.message);
            loadMembers();
            return;
          }
          toast('Role updated');
        });
      });

      // Remove member handlers
      wrap.querySelectorAll('[data-remove-member]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Remove this member from the organization?')) return;
          const memberId = btn.dataset.removeMember;
          const { error } = await sb.from('memberships').delete().eq('id', memberId);
          if (error) {
            toast('Failed to remove member: ' + error.message);
            return;
          }
          toast('Member removed');
          loadMembers();
        });
      });
    }
  }

  await loadMembers();

  document.getElementById('member-search')?.addEventListener('input', renderTable);
  document.getElementById('member-role-filter')?.addEventListener('change', renderTable);

  // Invite member modal
  if (isAdmin) {
    document.getElementById('invite-btn')?.addEventListener('click', () => {
      const f = document.createElement('div');
      f.innerHTML = `
        <div style="display:grid;gap:var(--space-4)">
          <div class="form-group">
            <label class="form-label">Email Address</label>
            <input type="email" class="form-input" id="invite-email" placeholder="colleague@company.com" required>
          </div>
          <div class="form-group">
            <label class="form-label">Role</label>
            <select class="form-input" id="invite-role">
              <option value="member">Member</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <button class="btn btn-primary" id="invite-save">Send Invite</button>
        </div>`;
      openModal('Invite Member', f);

      f.querySelector('#invite-save').addEventListener('click', async () => {
        const email = f.querySelector('#invite-email').value.trim();
        const role = f.querySelector('#invite-role').value;
        if (!email) return toast('Email is required');

        const btn = f.querySelector('#invite-save');
        btn.disabled = true;
        btn.textContent = 'Inviting...';

        // Check if member already exists
        const { data: existing } = await sb
          .from('memberships')
          .select('id')
          .eq('organization_id', org.id)
          .eq('email', email)
          .maybeSingle();

        if (existing) {
          toast('This email is already a member');
          btn.disabled = false;
          btn.textContent = 'Send Invite';
          return;
        }

        const { error } = await sb.from('memberships').insert({
          organization_id: org.id,
          email,
          role,
          invited_at: new Date().toISOString(),
        });

        if (error) {
          toast('Invite failed: ' + error.message);
          btn.disabled = false;
          btn.textContent = 'Send Invite';
          return;
        }

        await publishEvent('people.member.invited', { email, role });
        closeModal();
        toast('Invite sent to ' + email);
        loadMembers();
      });
    });
  }
}
