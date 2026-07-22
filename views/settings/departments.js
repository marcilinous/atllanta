import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, initials, avColor } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

export default async function departmentsView(container) {
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Departments & Teams</h1>
        <p class="page-subtitle">Organize your company structure</p>
      </div>
      ${isAdmin ? `<div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-primary" id="add-dept-btn">+ Department</button>
        <button class="btn btn-secondary" id="add-team-btn">+ Team</button>
      </div>` : ''}
    </div>
    <div id="dept-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:var(--space-3);margin-bottom:var(--space-4)"></div>
    <div id="dept-content"></div>
  `;

  if (!org) return;

  let departments = [];
  let teams = [];
  let users = [];

  async function load() {
    const [deptResult, teamResult, userResult] = await Promise.all([
      sb.from('departments').select('*, head:head_id(id, full_name, email)').order('name'),
      sb.from('teams').select('*, department:department_id(name), lead:lead_id(id, full_name, email)').order('name'),
      sb.from('users').select('id, full_name, email, department_id, team_id, status').eq('status', 'active').order('full_name'),
    ]);
    departments = deptResult.data || [];
    teams = teamResult.data || [];
    users = userResult.data || [];
    renderStats();
    render();
  }

  function renderStats() {
    const el = document.getElementById('dept-stats');
    const unassigned = users.filter(u => !u.department_id).length;
    el.innerHTML = `
      <div class="card" style="padding:var(--space-3);text-align:center">
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-accent)">${departments.length}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Departments</div>
      </div>
      <div class="card" style="padding:var(--space-3);text-align:center">
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-info)">${teams.length}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Teams</div>
      </div>
      <div class="card" style="padding:var(--space-3);text-align:center">
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-success)">${users.length}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Active Employees</div>
      </div>
      <div class="card" style="padding:var(--space-3);text-align:center">
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);${unassigned > 0 ? 'color:var(--color-warning)' : ''}">${unassigned}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Unassigned</div>
      </div>
    `;
  }

  function render() {
    const el = document.getElementById('dept-content');

    if (!departments.length && !teams.length) {
      el.innerHTML = `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg></div>
        <div class="empty-state-title">No departments yet</div>
        <div class="empty-state-desc">Create your first department to organize your team.</div>
      </div></div>`;
      return;
    }

    el.innerHTML = `<div style="display:grid;gap:var(--space-4)">
      ${departments.map(dept => {
        const deptTeams = teams.filter(t => t.department_id === dept.id);
        const deptUsers = users.filter(u => u.department_id === dept.id);
        const unassignedInDept = deptUsers.filter(u => !u.team_id || !deptTeams.some(t => t.id === u.team_id));

        return `<div class="card">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2)">
            <div style="display:flex;align-items:center;gap:var(--space-3)">
              <div style="width:36px;height:36px;border-radius:var(--radius-lg);background:var(--color-accent-light);display:flex;align-items:center;justify-content:center;font-size:var(--text-md);font-weight:var(--font-weight-bold);color:var(--color-accent);flex-shrink:0">${esc(dept.name.charAt(0).toUpperCase())}</div>
              <div>
                <div class="card-title" style="margin:0">${esc(dept.name)}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-secondary);display:flex;gap:var(--space-3);margin-top:2px">
                  ${dept.head?.full_name ? `<span>Head: <strong>${esc(dept.head.full_name)}</strong></span>` : '<span style="color:var(--color-warning)">No head assigned</span>'}
                  <span>${deptUsers.length} member${deptUsers.length !== 1 ? 's' : ''}</span>
                  <span>${deptTeams.length} team${deptTeams.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>
            ${isAdmin ? `<div style="display:flex;gap:var(--space-2)">
              <button class="btn btn-secondary btn-sm" data-add-team-to="${dept.id}">+ Team</button>
              <button class="btn btn-ghost btn-sm" data-edit-dept="${dept.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-delete-dept="${dept.id}" style="color:var(--color-error)">Delete</button>
            </div>` : ''}
          </div>
          <div class="card-body" style="padding:0">
            ${deptTeams.length ? `<div style="display:grid;gap:0">
              ${deptTeams.map(t => {
                const teamUsers = users.filter(u => u.team_id === t.id);
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border-light)">
                  <div style="display:flex;align-items:center;gap:var(--space-3);flex:1">
                    <div style="width:6px;height:6px;border-radius:var(--radius-full);background:var(--color-accent);flex-shrink:0"></div>
                    <div style="flex:1">
                      <div style="display:flex;align-items:center;gap:var(--space-2)">
                        <span style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(t.name)}</span>
                        <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${teamUsers.length} member${teamUsers.length !== 1 ? 's' : ''}</span>
                      </div>
                      ${t.lead?.full_name ? `<div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Lead: ${esc(t.lead.full_name)}</div>` : ''}
                    </div>
                    <div style="display:flex;gap:2px;margin-right:var(--space-2)">
                      ${teamUsers.slice(0, 5).map(u => `<div style="width:22px;height:22px;border-radius:var(--radius-full);background:${avColor(u.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-size:7px;font-weight:var(--font-weight-semibold);margin-left:-4px;border:2px solid var(--color-surface)" title="${esc(u.full_name)}">${initials(u.full_name)}</div>`).join('')}
                      ${teamUsers.length > 5 ? `<div style="width:22px;height:22px;border-radius:var(--radius-full);background:var(--color-bg-tertiary);display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:var(--font-weight-semibold);margin-left:-4px;border:2px solid var(--color-surface);color:var(--color-text-secondary)">+${teamUsers.length - 5}</div>` : ''}
                    </div>
                  </div>
                  ${isAdmin ? `<div style="display:flex;gap:var(--space-1)">
                    <button class="btn btn-ghost btn-sm" data-edit-team="${t.id}" style="font-size:var(--text-xs)">Edit</button>
                    <button class="btn btn-ghost btn-sm" data-delete-team="${t.id}" style="color:var(--color-error);font-size:var(--text-xs)">Delete</button>
                  </div>` : ''}
                </div>`;
              }).join('')}
            </div>` : ''}
            ${unassignedInDept.length > 0 ? `<div style="padding:var(--space-3) var(--space-4);background:var(--color-warning-light);font-size:var(--text-xs);color:var(--color-warning);display:flex;align-items:center;gap:var(--space-2)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              ${unassignedInDept.length} member${unassignedInDept.length !== 1 ? 's' : ''} in this department without a team
            </div>` : ''}
            ${!deptTeams.length && !unassignedInDept.length ? '<div style="padding:var(--space-4);text-align:center;font-size:var(--text-sm);color:var(--color-text-tertiary)">No teams yet</div>' : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;

    if (isAdmin) attachHandlers(el);
  }

  function attachHandlers(el) {
    el.querySelectorAll('[data-edit-dept]').forEach(btn => {
      btn.addEventListener('click', () => editDept(btn.dataset.editDept));
    });
    el.querySelectorAll('[data-delete-dept]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dept = departments.find(d => d.id === btn.dataset.deleteDept);
        const deptUsers = users.filter(u => u.department_id === dept?.id);
        const deptTeams = teams.filter(t => t.department_id === dept?.id);
        if (deptUsers.length > 0) {
          toast(`Cannot delete — ${deptUsers.length} employee${deptUsers.length !== 1 ? 's' : ''} assigned to this department. Reassign them first.`);
          return;
        }
        if (!confirm(`Delete "${dept?.name}" and its ${deptTeams.length} team${deptTeams.length !== 1 ? 's' : ''}?`)) return;
        if (deptTeams.length) {
          const { error: teamErr } = await sb.from('teams').delete().eq('department_id', dept.id);
          if (teamErr) { toast('Failed to delete teams: ' + teamErr.message); return; }
        }
        const { error } = await sb.from('departments').delete().eq('id', dept.id);
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('people', 'department', dept.id, 'deleted', { name: dept.name }, null);
        await publishEvent('people.department.deleted', { department_id: dept.id, name: dept.name });
        toast('Department deleted');
        load();
      });
    });
    el.querySelectorAll('[data-add-team-to]').forEach(btn => {
      btn.addEventListener('click', () => editTeam(null, btn.dataset.addTeamTo));
    });
    el.querySelectorAll('[data-edit-team]').forEach(btn => {
      btn.addEventListener('click', () => editTeam(btn.dataset.editTeam));
    });
    el.querySelectorAll('[data-delete-team]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const team = teams.find(t => t.id === btn.dataset.deleteTeam);
        const teamUsers = users.filter(u => u.team_id === team?.id);
        if (teamUsers.length > 0) {
          if (!confirm(`${teamUsers.length} employee${teamUsers.length !== 1 ? 's are' : ' is'} in this team. Their team assignment will be cleared. Continue?`)) return;
          await sb.from('users').update({ team_id: null }).eq('team_id', team.id);
        } else {
          if (!confirm(`Delete team "${team?.name}"?`)) return;
        }
        const { error } = await sb.from('teams').delete().eq('id', team.id);
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('people', 'team', team.id, 'deleted', { name: team.name }, null);
        await publishEvent('people.team.deleted', { team_id: team.id, name: team.name });
        toast('Team deleted');
        load();
      });
    });
  }

  function editDept(deptId) {
    const dept = deptId ? departments.find(d => d.id === deptId) : null;
    const deptUsers = dept ? users.filter(u => u.department_id === dept.id) : [];
    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div class="form-group">
          <label class="form-label">Department Name <span style="color:var(--color-error)">*</span></label>
          <input type="text" class="form-input" id="dept-name" value="${esc(dept?.name || '')}" placeholder="e.g. Engineering, Marketing, HR">
        </div>
        <div class="form-group">
          <label class="form-label">Department Head</label>
          <select class="form-input" id="dept-head">
            <option value="">— No head assigned —</option>
            ${(dept ? deptUsers : users).map(u => `<option value="${u.id}" ${dept?.head?.id === u.id ? 'selected' : ''}>${esc(u.full_name)} (${esc(u.email)})</option>`).join('')}
          </select>
          <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-1)">${dept ? `Showing ${deptUsers.length} members in this department` : 'Showing all active employees'}</div>
        </div>
        ${dept ? `<div style="padding:var(--space-3);background:var(--color-bg-secondary);border-radius:var(--radius-md);font-size:var(--text-sm)">
          <strong>${deptUsers.length}</strong> employee${deptUsers.length !== 1 ? 's' : ''} · <strong>${teams.filter(t => t.department_id === dept.id).length}</strong> team${teams.filter(t => t.department_id === dept.id).length !== 1 ? 's' : ''}
        </div>` : ''}
        <button class="btn btn-primary" id="dept-save">${dept ? 'Update Department' : 'Create Department'}</button>
      </div>`;
    openModal(dept ? 'Edit Department' : 'New Department', f);
    f.querySelector('#dept-save').addEventListener('click', async () => {
      const name = f.querySelector('#dept-name').value.trim();
      if (!name) return toast('Name is required');
      const headId = f.querySelector('#dept-head').value || null;
      if (dept) {
        const { error } = await sb.from('departments').update({ name, head_id: headId }).eq('id', dept.id);
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('people', 'department', dept.id, 'updated', { name: dept.name, head_id: dept.head?.id }, { name, head_id: headId });
      } else {
        const { data, error } = await sb.from('departments').insert({ org_id: org.id, name, head_id: headId }).select().single();
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('people', 'department', data?.id, 'created', null, { name, head_id: headId });
        await publishEvent('people.department.created', { department_id: data?.id, name });
      }
      closeModal();
      toast(dept ? 'Department updated' : 'Department created');
      load();
    });
  }

  function editTeam(teamId, preDeptId) {
    const team = teamId ? teams.find(t => t.id === teamId) : null;
    const teamUsers = team ? users.filter(u => u.team_id === team.id) : [];
    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div class="form-group">
          <label class="form-label">Team Name <span style="color:var(--color-error)">*</span></label>
          <input type="text" class="form-input" id="team-name" value="${esc(team?.name || '')}" placeholder="e.g. Backend, Design, Sales Ops">
        </div>
        <div class="form-group">
          <label class="form-label">Department <span style="color:var(--color-error)">*</span></label>
          <select class="form-input" id="team-dept">
            ${departments.map(d => `<option value="${d.id}" ${d.id === (team?.department_id || preDeptId) ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Team Lead</label>
          <select class="form-input" id="team-lead">
            <option value="">— No lead assigned —</option>
            ${users.map(u => `<option value="${u.id}" ${team?.lead?.id === u.id ? 'selected' : ''}>${esc(u.full_name)} (${esc(u.email)})</option>`).join('')}
          </select>
        </div>
        ${team && teamUsers.length ? `<div style="padding:var(--space-3);background:var(--color-bg-secondary);border-radius:var(--radius-md)">
          <div style="font-size:var(--text-xs);font-weight:var(--font-weight-semibold);margin-bottom:var(--space-2);color:var(--color-text-secondary)">Members (${teamUsers.length})</div>
          <div style="display:flex;flex-wrap:wrap;gap:var(--space-2)">
            ${teamUsers.map(u => `<div style="display:flex;align-items:center;gap:var(--space-1);font-size:var(--text-xs);padding:var(--space-1) var(--space-2);background:var(--color-surface);border-radius:var(--radius-full);border:1px solid var(--color-border)">
              <div style="width:16px;height:16px;border-radius:var(--radius-full);background:${avColor(u.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-size:6px;font-weight:var(--font-weight-semibold)">${initials(u.full_name)}</div>
              ${esc(u.full_name)}
            </div>`).join('')}
          </div>
        </div>` : ''}
        <button class="btn btn-primary" id="team-save">${team ? 'Update Team' : 'Create Team'}</button>
      </div>`;
    openModal(team ? 'Edit Team' : 'New Team', f);
    f.querySelector('#team-save').addEventListener('click', async () => {
      const name = f.querySelector('#team-name').value.trim();
      const deptId = f.querySelector('#team-dept').value;
      const leadId = f.querySelector('#team-lead').value || null;
      if (!name || !deptId) return toast('Name and department are required');
      if (team) {
        const { error } = await sb.from('teams').update({ name, department_id: deptId, lead_id: leadId }).eq('id', team.id);
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('people', 'team', team.id, 'updated', { name: team.name, lead_id: team.lead?.id }, { name, lead_id: leadId });
      } else {
        const { data, error } = await sb.from('teams').insert({ org_id: org.id, name, department_id: deptId, lead_id: leadId }).select().single();
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('people', 'team', data?.id, 'created', null, { name, department_id: deptId, lead_id: leadId });
        await publishEvent('people.team.created', { team_id: data?.id, name });
      }
      closeModal();
      toast(team ? 'Team updated' : 'Team created');
      load();
    });
  }

  await load();

  if (isAdmin) {
    document.getElementById('add-dept-btn')?.addEventListener('click', () => editDept(null));
    document.getElementById('add-team-btn')?.addEventListener('click', () => {
      if (!departments.length) { toast('Create a department first'); return; }
      editTeam(null);
    });
  }
}
