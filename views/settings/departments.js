import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';

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
      ${isAdmin ? '<div style="display:flex;gap:var(--space-2)"><button class="btn btn-primary" id="add-dept-btn">+ Department</button><button class="btn btn-secondary" id="add-team-btn">+ Team</button></div>' : ''}
    </div>
    <div id="dept-content"></div>
  `;

  if (!org) return;

  let departments = [];
  let teams = [];

  async function load() {
    const [{ data: d }, { data: t }] = await Promise.all([
      sb.from('departments').select('*, head:head_id(full_name)').eq('org_id', org.id).order('name'),
      sb.from('teams').select('*, department:department_id(name), lead:lead_id(full_name)').eq('org_id', org.id).order('name'),
    ]);
    departments = d || [];
    teams = t || [];
    render();
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
        return `<div class="card">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <span class="card-title">${esc(dept.name)}</span>
              ${dept.head?.full_name ? `<span style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-left:var(--space-2)">Head: ${esc(dept.head.full_name)}</span>` : ''}
            </div>
            ${isAdmin ? `<div style="display:flex;gap:var(--space-2)">
              <button class="btn btn-ghost btn-sm" data-edit-dept="${dept.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-delete-dept="${dept.id}" style="color:var(--color-error)">Delete</button>
            </div>` : ''}
          </div>
          <div class="card-body">
            ${deptTeams.length ? `<div style="display:grid;gap:var(--space-2)">
              ${deptTeams.map(t => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) var(--space-3);background:var(--color-bg-secondary);border-radius:var(--radius-md)">
                  <div>
                    <span style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(t.name)}</span>
                    ${t.lead?.full_name ? `<span style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-left:var(--space-2)">Lead: ${esc(t.lead.full_name)}</span>` : ''}
                  </div>
                  ${isAdmin ? `<div style="display:flex;gap:var(--space-1)">
                    <button class="btn btn-ghost btn-sm" data-edit-team="${t.id}" style="font-size:var(--text-xs)">Edit</button>
                    <button class="btn btn-ghost btn-sm" data-delete-team="${t.id}" style="color:var(--color-error);font-size:var(--text-xs)">Delete</button>
                  </div>` : ''}
                </div>
              `).join('')}
            </div>` : '<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">No teams in this department</div>'}
          </div>
        </div>`;
      }).join('')}
    </div>`;

    if (isAdmin) {
      el.querySelectorAll('[data-edit-dept]').forEach(btn => {
        btn.addEventListener('click', () => editDept(btn.dataset.editDept));
      });
      el.querySelectorAll('[data-delete-dept]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this department and its teams?')) return;
          await sb.from('teams').delete().eq('department_id', btn.dataset.deleteDept);
          await sb.from('departments').delete().eq('id', btn.dataset.deleteDept);
          await logAction('people', 'department', btn.dataset.deleteDept, 'deleted', null, null);
          toast('Department deleted');
          load();
        });
      });
      el.querySelectorAll('[data-edit-team]').forEach(btn => {
        btn.addEventListener('click', () => editTeam(btn.dataset.editTeam));
      });
      el.querySelectorAll('[data-delete-team]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this team?')) return;
          await sb.from('teams').delete().eq('id', btn.dataset.deleteTeam);
          await logAction('people', 'team', btn.dataset.deleteTeam, 'deleted', null, null);
          toast('Team deleted');
          load();
        });
      });
    }
  }

  function editDept(deptId) {
    const dept = departments.find(d => d.id === deptId);
    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div class="form-group"><label class="form-label">Name</label><input type="text" class="form-input" id="dept-name" value="${esc(dept?.name || '')}"></div>
        <button class="btn btn-primary" id="dept-save">${dept ? 'Update' : 'Create'}</button>
      </div>`;
    openModal(dept ? 'Edit Department' : 'New Department', f);
    f.querySelector('#dept-save').addEventListener('click', async () => {
      const name = f.querySelector('#dept-name').value.trim();
      if (!name) return toast('Name is required');
      if (dept) {
        await sb.from('departments').update({ name }).eq('id', dept.id);
        await logAction('people', 'department', dept.id, 'updated', { name: dept.name }, { name });
      } else {
        await sb.from('departments').insert({ org_id: org.id, name });
        await logAction('people', 'department', null, 'created', null, { name });
      }
      closeModal();
      toast(dept ? 'Department updated' : 'Department created');
      load();
    });
  }

  function editTeam(teamId) {
    const team = teams.find(t => t.id === teamId);
    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div class="form-group"><label class="form-label">Name</label><input type="text" class="form-input" id="team-name" value="${esc(team?.name || '')}"></div>
        <div class="form-group"><label class="form-label">Department</label>
          <select class="form-input" id="team-dept">
            ${departments.map(d => `<option value="${d.id}" ${d.id === team?.department_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" id="team-save">${team ? 'Update' : 'Create'}</button>
      </div>`;
    openModal(team ? 'Edit Team' : 'New Team', f);
    f.querySelector('#team-save').addEventListener('click', async () => {
      const name = f.querySelector('#team-name').value.trim();
      const deptId = f.querySelector('#team-dept').value;
      if (!name || !deptId) return toast('Name and department are required');
      if (team) {
        await sb.from('teams').update({ name, department_id: deptId }).eq('id', team.id);
        await logAction('people', 'team', team.id, 'updated', { name: team.name }, { name });
      } else {
        await sb.from('teams').insert({ org_id: org.id, name, department_id: deptId });
        await logAction('people', 'team', null, 'created', null, { name });
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
