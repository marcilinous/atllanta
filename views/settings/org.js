import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { logAction } from '../../js/audit.js';

const TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
  'Asia/Jakarta', 'Asia/Karachi', 'Asia/Dhaka', 'Asia/Bangkok',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'America/Toronto', 'Africa/Johannesburg', 'Africa/Lagos',
  'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland', 'UTC',
];

const CURRENCIES = [
  { code: 'INR', name: 'Indian Rupee (₹)' },
  { code: 'USD', name: 'US Dollar ($)' },
  { code: 'EUR', name: 'Euro (€)' },
  { code: 'GBP', name: 'British Pound (£)' },
  { code: 'AED', name: 'UAE Dirham (د.إ)' },
  { code: 'SGD', name: 'Singapore Dollar (S$)' },
  { code: 'AUD', name: 'Australian Dollar (A$)' },
  { code: 'CAD', name: 'Canadian Dollar (C$)' },
  { code: 'JPY', name: 'Japanese Yen (¥)' },
  { code: 'BRL', name: 'Brazilian Real (R$)' },
  { code: 'ZAR', name: 'South African Rand (R)' },
  { code: 'MYR', name: 'Malaysian Ringgit (RM)' },
];

const DATE_FORMATS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2026)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2026)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2026-12-31)' },
  { value: 'DD-MMM-YYYY', label: 'DD-MMM-YYYY (31-Dec-2026)' },
  { value: 'MMM DD, YYYY', label: 'MMM DD, YYYY (Dec 31, 2026)' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function settingsOrg(container) {
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Configure your organization, policies, and team structure</p>
    </div>
    <div class="tabs" id="settings-tabs">
      <button class="tab active" data-tab="org">Organization</button>
      <button class="tab" data-tab="users">Users</button>
      <button class="tab" data-tab="departments">Departments</button>
      <button class="tab" data-tab="leave-types">Leave Types</button>
      <button class="tab" data-tab="holidays">Holidays</button>
      <button class="tab" data-tab="schedules">Work Schedules</button>
      <button class="tab" data-tab="expenses">Expense Categories</button>
      <button class="tab" data-tab="integrations">Integrations</button>
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
    else if (currentTab === 'users') { navigate('settings/users'); return; }
    else if (currentTab === 'departments') await renderDepartments();
    else if (currentTab === 'leave-types') await renderLeaveTypes();
    else if (currentTab === 'holidays') await renderHolidays();
    else if (currentTab === 'schedules') await renderSchedules();
    else if (currentTab === 'expenses') await renderExpenseCategories();
    else if (currentTab === 'integrations') { navigate('settings/integrations'); return; }
  }

  function renderOrgSettings() {
    contentEl.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">Organization Details</span>
          ${isAdmin ? '<span class="badge badge-success"><span class="badge-dot"></span>Admin Access</span>' : '<span class="badge badge-neutral">View Only</span>'}
        </div>
        <div class="card-body">
          <div style="display:grid;gap:var(--space-5);max-width:560px">
            <div style="display:flex;align-items:center;gap:var(--space-4);padding-bottom:var(--space-4);border-bottom:1px solid var(--color-border-light)">
              <div id="org-logo-preview" style="width:64px;height:64px;border-radius:var(--radius-lg);background:var(--color-bg-tertiary);display:flex;align-items:center;justify-content:center;font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-accent);border:2px dashed var(--color-border);cursor:${isAdmin ? 'pointer' : 'default'};overflow:hidden;flex-shrink:0">
                ${org.logo_url ? `<img src="${esc(org.logo_url)}" style="width:100%;height:100%;object-fit:cover">` : esc(org.name?.charAt(0)?.toUpperCase() || 'O')}
              </div>
              <div>
                <div style="font-weight:var(--font-weight-semibold);margin-bottom:var(--space-1)">${esc(org.name)}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Slug: ${esc(org.slug || '—')}</div>
                ${isAdmin ? '<div style="font-size:var(--text-xs);color:var(--color-accent);margin-top:var(--space-1);cursor:pointer" id="change-logo-link">Change logo</div>' : ''}
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Organization Name</label>
              <input type="text" class="form-input" value="${esc(org.name)}" ${isAdmin ? '' : 'disabled'} id="org-name-edit">
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-1)">This appears across the platform and in notifications</div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4)">
              <div class="form-group">
                <label class="form-label">Timezone</label>
                <select class="form-input" id="org-tz" ${isAdmin ? '' : 'disabled'}>
                  ${TIMEZONES.map(tz => `<option value="${tz}" ${(org.timezone || 'Asia/Kolkata') === tz ? 'selected' : ''}>${tz}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Currency</label>
                <select class="form-input" id="org-currency" ${isAdmin ? '' : 'disabled'}>
                  ${CURRENCIES.map(c => `<option value="${c.code}" ${(org.currency || 'INR') === c.code ? 'selected' : ''}>${c.name}</option>`).join('')}
                </select>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4)">
              <div class="form-group">
                <label class="form-label">Date Format</label>
                <select class="form-input" id="org-datefmt" ${isAdmin ? '' : 'disabled'}>
                  ${DATE_FORMATS.map(f => `<option value="${f.value}" ${(org.date_format || 'DD/MM/YYYY') === f.value ? 'selected' : ''}>${f.label}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Fiscal Year Starts</label>
                <select class="form-input" id="org-fiscal" ${isAdmin ? '' : 'disabled'}>
                  ${MONTHS.map((m, i) => `<option value="${i + 1}" ${(org.fiscal_year_start || 4) === (i + 1) ? 'selected' : ''}>${m}</option>`).join('')}
                </select>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-1)">Affects leave balance accrual and financial reports</div>
              </div>
            </div>

            ${isAdmin ? `<div style="display:flex;gap:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--color-border-light)">
              <button class="btn btn-primary" id="save-org">Save Changes</button>
              <button class="btn btn-secondary" id="reset-org">Reset</button>
            </div>` : ''}
          </div>
        </div>
      </div>

      ${isAdmin ? `<div class="card" style="margin-top:var(--space-4)">
        <div class="card-header"><span class="card-title" style="color:var(--color-error)">Danger Zone</span></div>
        <div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:var(--font-weight-medium)">Delete Organization</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Permanently delete this organization and all its data. This cannot be undone.</div>
            </div>
            <button class="btn btn-sm" style="background:var(--color-error);color:white;border:none" disabled>Contact Support</button>
          </div>
        </div>
      </div>` : ''}`;

    if (isAdmin) {
      document.getElementById('save-org')?.addEventListener('click', async () => {
        const newName = document.getElementById('org-name-edit').value.trim();
        if (!newName) return toast('Organization name is required');
        const updates = {
          name: newName,
          timezone: document.getElementById('org-tz').value,
          currency: document.getElementById('org-currency').value,
          date_format: document.getElementById('org-datefmt').value,
          fiscal_year_start: parseInt(document.getElementById('org-fiscal').value),
          updated_at: new Date().toISOString(),
        };
        const { error } = await sb.from('organizations').update(updates).eq('id', org.id);
        if (error) { toast('Error: ' + error.message); return; }
        const oldValues = { name: org.name, timezone: org.timezone, currency: org.currency, date_format: org.date_format, fiscal_year_start: org.fiscal_year_start };
        await logAction('people', 'organization', org.id, 'updated', oldValues, updates);
        Object.assign(org, updates);
        toast('Organization settings saved');
      });

      document.getElementById('reset-org')?.addEventListener('click', () => {
        renderOrgSettings();
      });

      document.getElementById('change-logo-link')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', async () => {
          const file = input.files[0];
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) return toast('Logo must be under 2MB');
          const ext = file.name.split('.').pop();
          const path = `org-logos/${org.id}.${ext}`;
          const { error: uploadErr } = await sb.storage.from('public').upload(path, file, { upsert: true });
          if (uploadErr) return toast('Upload failed: ' + uploadErr.message);
          const { data: urlData } = sb.storage.from('public').getPublicUrl(path);
          const logoUrl = urlData?.publicUrl;
          if (logoUrl) {
            await sb.from('organizations').update({ logo_url: logoUrl }).eq('id', org.id);
            org.logo_url = logoUrl;
            toast('Logo updated');
            renderOrgSettings();
          }
        });
        input.click();
      });

      document.getElementById('org-logo-preview')?.addEventListener('click', () => {
        document.getElementById('change-logo-link')?.click();
      });
    }
  }

  async function renderDepartments() {
    const [{ data: depts, error: deptsErr }, { data: teams, error: teamsErr }, { data: users }] = await Promise.all([
      sb.from('departments').select('*').order('name'),
      sb.from('teams').select('*').order('name'),
      sb.from('users').select('id, full_name').eq('status', 'active').order('full_name'),
    ]);
    if (deptsErr) toast('Failed to load departments: ' + deptsErr.message);
    if (teamsErr) toast('Failed to load teams: ' + teamsErr.message);

    contentEl.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span class="card-title">Departments & Teams</span>
            <span style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-left:var(--space-2)">${(depts || []).length} department${(depts || []).length !== 1 ? 's' : ''}</span>
          </div>
          ${isAdmin ? '<button class="btn btn-primary btn-sm" id="add-dept-btn">+ Add Department</button>' : ''}
        </div>
        <div class="card-body">
          ${(depts || []).length ? (depts || []).map(d => {
            const deptTeams = (teams || []).filter(t => t.department_id === d.id);
            const headUser = (users || []).find(u => u.id === d.head_id);
            return `<div style="border:1px solid var(--color-border);border-radius:var(--radius-md);margin-bottom:var(--space-3);overflow:hidden">
              <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3) var(--space-4);background:var(--color-bg-secondary)">
                <div>
                  <span style="font-weight:var(--font-weight-semibold)">${esc(d.name)}</span>
                  ${headUser ? `<span style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-left:var(--space-2)">Head: ${esc(headUser.full_name)}</span>` : ''}
                </div>
                <div style="display:flex;gap:var(--space-2)">
                  ${isAdmin ? `<button class="btn btn-ghost btn-sm" data-edit-dept="${d.id}" data-dept-name="${esc(d.name)}" data-dept-head="${d.head_id || ''}">Edit</button>
                  <button class="btn btn-ghost btn-sm" data-add-team="${d.id}">+ Team</button>
                  <button class="btn btn-ghost btn-sm" data-del-dept="${d.id}" style="color:var(--color-error)">&times;</button>` : ''}
                </div>
              </div>
              ${deptTeams.length ? `<div style="padding:var(--space-2) var(--space-4)">
                ${deptTeams.map(t => {
                  const leadUser = (users || []).find(u => u.id === t.lead_id);
                  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
                  <div>
                    <span style="font-size:var(--text-sm)">${esc(t.name)}</span>
                    ${leadUser ? `<span style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-left:var(--space-2)">Lead: ${esc(leadUser.full_name)}</span>` : ''}
                  </div>
                  ${isAdmin ? `<div style="display:flex;gap:var(--space-2)">
                    <button class="btn btn-ghost btn-sm" data-edit-team="${t.id}" data-team-name="${esc(t.name)}" data-team-lead="${t.lead_id || ''}" data-team-dept="${t.department_id}" style="font-size:var(--text-xs)">Edit</button>
                    <button class="btn btn-ghost btn-sm" data-del-team="${t.id}" style="color:var(--color-error);font-size:var(--text-xs)">&times;</button>
                  </div>` : ''}
                </div>`;
                }).join('')}
              </div>` : `<div style="padding:var(--space-3) var(--space-4);font-size:var(--text-xs);color:var(--color-text-tertiary)">No teams in this department</div>`}
            </div>`;
          }).join('') : '<div style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-6)">No departments yet. Create one to organize your team.</div>'}
        </div>
      </div>`;

    if (isAdmin) {
      const userOpts = (users || []).map(u => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('');

      document.getElementById('add-dept-btn')?.addEventListener('click', () => {
        const f = document.createElement('div');
        f.innerHTML = `<div style="display:grid;gap:var(--space-3)">
          <div class="form-group"><label class="form-label">Department Name</label><input type="text" class="form-input" id="dept-name"></div>
          <div class="form-group"><label class="form-label">Department Head (optional)</label><select class="form-input" id="dept-head"><option value="">— None —</option>${userOpts}</select></div>
          <button class="btn btn-primary" id="dept-save">Create</button>
        </div>`;
        openModal('Add Department', f);
        f.querySelector('#dept-save').addEventListener('click', async () => {
          const name = f.querySelector('#dept-name').value.trim();
          if (!name) return toast('Name required');
          const head_id = f.querySelector('#dept-head').value || null;
          const { error } = await sb.from('departments').insert({ org_id: org.id, name, head_id });
          if (error) return toast(error.message);
          await logAction('people', 'department', null, 'created', null, { name });
          closeModal(); toast('Department added'); renderDepartments();
        });
      });

      contentEl.querySelectorAll('[data-edit-dept]').forEach(btn => {
        btn.addEventListener('click', () => {
          const f = document.createElement('div');
          f.innerHTML = `<div style="display:grid;gap:var(--space-3)">
            <div class="form-group"><label class="form-label">Department Name</label><input type="text" class="form-input" id="dept-name" value="${btn.dataset.deptName}"></div>
            <div class="form-group"><label class="form-label">Department Head</label><select class="form-input" id="dept-head"><option value="">— None —</option>${userOpts}</select></div>
            <button class="btn btn-primary" id="dept-save">Save Changes</button>
          </div>`;
          openModal('Edit Department', f);
          if (btn.dataset.deptHead) f.querySelector('#dept-head').value = btn.dataset.deptHead;
          f.querySelector('#dept-save').addEventListener('click', async () => {
            const name = f.querySelector('#dept-name').value.trim();
            if (!name) return toast('Name required');
            const head_id = f.querySelector('#dept-head').value || null;
            const { error } = await sb.from('departments').update({ name, head_id }).eq('id', btn.dataset.editDept);
            if (error) return toast(error.message);
            await logAction('people', 'department', btn.dataset.editDept, 'updated', null, { name });
            closeModal(); toast('Department updated'); renderDepartments();
          });
        });
      });

      contentEl.querySelectorAll('[data-add-team]').forEach(btn => {
        btn.addEventListener('click', () => {
          const f = document.createElement('div');
          f.innerHTML = `<div style="display:grid;gap:var(--space-3)">
            <div class="form-group"><label class="form-label">Team Name</label><input type="text" class="form-input" id="team-name"></div>
            <div class="form-group"><label class="form-label">Team Lead (optional)</label><select class="form-input" id="team-lead"><option value="">— None —</option>${userOpts}</select></div>
            <button class="btn btn-primary" id="team-save">Create</button>
          </div>`;
          openModal('Add Team', f);
          f.querySelector('#team-save').addEventListener('click', async () => {
            const name = f.querySelector('#team-name').value.trim();
            if (!name) return toast('Name required');
            const lead_id = f.querySelector('#team-lead').value || null;
            const { error } = await sb.from('teams').insert({ org_id: org.id, department_id: btn.dataset.addTeam, name, lead_id });
            if (error) return toast(error.message);
            await logAction('people', 'team', null, 'created', null, { name });
            closeModal(); toast('Team added'); renderDepartments();
          });
        });
      });

      contentEl.querySelectorAll('[data-edit-team]').forEach(btn => {
        btn.addEventListener('click', () => {
          const f = document.createElement('div');
          f.innerHTML = `<div style="display:grid;gap:var(--space-3)">
            <div class="form-group"><label class="form-label">Team Name</label><input type="text" class="form-input" id="team-name" value="${btn.dataset.teamName}"></div>
            <div class="form-group"><label class="form-label">Team Lead</label><select class="form-input" id="team-lead"><option value="">— None —</option>${userOpts}</select></div>
            <button class="btn btn-primary" id="team-save">Save Changes</button>
          </div>`;
          openModal('Edit Team', f);
          if (btn.dataset.teamLead) f.querySelector('#team-lead').value = btn.dataset.teamLead;
          f.querySelector('#team-save').addEventListener('click', async () => {
            const name = f.querySelector('#team-name').value.trim();
            if (!name) return toast('Name required');
            const lead_id = f.querySelector('#team-lead').value || null;
            const { error } = await sb.from('teams').update({ name, lead_id }).eq('id', btn.dataset.editTeam);
            if (error) return toast(error.message);
            await logAction('people', 'team', btn.dataset.editTeam, 'updated', null, { name });
            closeModal(); toast('Team updated'); renderDepartments();
          });
        });
      });

      contentEl.querySelectorAll('[data-del-dept]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this department? All teams within it will also be removed.')) return;
          const { error } = await sb.from('departments').delete().eq('id', btn.dataset.delDept);
          if (error) return toast(error.message);
          await logAction('people', 'department', btn.dataset.delDept, 'deleted', null, null);
          toast('Department deleted'); renderDepartments();
        });
      });

      contentEl.querySelectorAll('[data-del-team]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this team?')) return;
          const { error } = await sb.from('teams').delete().eq('id', btn.dataset.delTeam);
          if (error) return toast(error.message);
          await logAction('people', 'team', btn.dataset.delTeam, 'deleted', null, null);
          toast('Team deleted'); renderDepartments();
        });
      });
    }
  }

  async function renderLeaveTypes() {
    const { data: types, error: ltErr } = await sb.from('leave_types').select('*').order('name');
    if (ltErr) toast('Failed to load leave types: ' + ltErr.message);

    contentEl.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span class="card-title">Leave Types</span>
            <span style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-left:var(--space-2)">${(types || []).length} type${(types || []).length !== 1 ? 's' : ''}</span>
          </div>
          ${isAdmin ? '<button class="btn btn-primary btn-sm" id="add-lt-btn">+ Add Leave Type</button>' : ''}
        </div>
        <div class="card-body">
          ${(types || []).length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Name</th><th>Code</th><th>Quota</th><th>Carry Forward</th><th>Max Consecutive</th><th>Document Req.</th><th>Paid</th><th>Status</th><th></th></tr></thead>
            <tbody>${(types || []).map(t => `<tr>
              <td style="font-weight:var(--font-weight-medium)">${esc(t.name)}</td>
              <td><span class="badge badge-neutral">${esc(t.code)}</span></td>
              <td>${t.annual_quota} days</td>
              <td>${t.carry_forward ? `Yes (max ${t.max_carry_forward || 0})` : 'No'}</td>
              <td>${t.max_consecutive_days || '—'}</td>
              <td>${t.requires_document ? 'Yes' : 'No'}</td>
              <td>${t.is_paid ? 'Yes' : 'No'}</td>
              <td>
                ${isAdmin
                  ? `<button class="btn btn-ghost btn-sm" data-toggle-lt="${t.id}" data-lt-active="${t.is_active}" style="padding:var(--space-1) var(--space-2)">
                      <span class="badge badge-${t.is_active ? 'success' : 'error'}"><span class="badge-dot"></span>${t.is_active ? 'Active' : 'Inactive'}</span>
                    </button>`
                  : `<span class="badge badge-${t.is_active ? 'success' : 'error'}"><span class="badge-dot"></span>${t.is_active ? 'Active' : 'Inactive'}</span>`}
              </td>
              <td>
                ${isAdmin ? `<div style="display:flex;gap:var(--space-1)">
                  <button class="btn btn-ghost btn-sm" data-edit-lt="${t.id}" title="Edit">Edit</button>
                  <button class="btn btn-ghost btn-sm" data-del-lt="${t.id}" style="color:var(--color-error)" title="Delete">&times;</button>
                </div>` : ''}
              </td>
            </tr>`).join('')}</tbody>
          </table></div>` : `<div style="text-align:center;padding:var(--space-6)">
            <div style="color:var(--color-text-tertiary);margin-bottom:var(--space-3)">No leave types configured yet</div>
            ${isAdmin ? '<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Leave types define how employees can request time off — casual leave, sick leave, earned leave, etc.</div>' : ''}
          </div>`}
        </div>
      </div>`;

    if (isAdmin) {
      function openLeaveTypeModal(existing) {
        const isEdit = !!existing;
        const f = document.createElement('div');
        f.innerHTML = `<div style="display:grid;gap:var(--space-4)">
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:var(--space-3)">
            <div class="form-group"><label class="form-label">Name</label><input type="text" class="form-input" id="lt-name" placeholder="e.g. Casual Leave" value="${isEdit ? esc(existing.name) : ''}"></div>
            <div class="form-group"><label class="form-label">Code</label><input type="text" class="form-input" id="lt-code" placeholder="e.g. CL" style="text-transform:uppercase" value="${isEdit ? esc(existing.code) : ''}"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            <div class="form-group"><label class="form-label">Annual Quota (days)</label><input type="number" class="form-input" id="lt-quota" value="${isEdit ? existing.annual_quota : 12}" min="0"></div>
            <div class="form-group"><label class="form-label">Max Consecutive Days</label><input type="number" class="form-input" id="lt-maxcons" value="${isEdit && existing.max_consecutive_days ? existing.max_consecutive_days : ''}" min="0" placeholder="No limit"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            <div class="form-group">
              <label style="display:flex;align-items:center;gap:var(--space-2)"><input type="checkbox" id="lt-carry" ${isEdit && existing.carry_forward ? 'checked' : ''}> Carry forward unused days</label>
            </div>
            <div class="form-group" id="lt-carry-max-group" style="display:${isEdit && existing.carry_forward ? 'block' : 'none'}">
              <label class="form-label">Max Carry Forward</label>
              <input type="number" class="form-input" id="lt-maxcarry" value="${isEdit ? (existing.max_carry_forward || 0) : 0}" min="0">
            </div>
          </div>
          <div style="display:flex;gap:var(--space-4);flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:var(--space-2)"><input type="checkbox" id="lt-paid" ${isEdit ? (existing.is_paid ? 'checked' : '') : 'checked'}> Paid leave</label>
            <label style="display:flex;align-items:center;gap:var(--space-2)"><input type="checkbox" id="lt-doc" ${isEdit && existing.requires_document ? 'checked' : ''}> Requires supporting document</label>
            <label style="display:flex;align-items:center;gap:var(--space-2)"><input type="checkbox" id="lt-active" ${isEdit ? (existing.is_active ? 'checked' : '') : 'checked'}> Active</label>
          </div>
          <button class="btn btn-primary" id="lt-save">${isEdit ? 'Save Changes' : 'Create Leave Type'}</button>
        </div>`;
        openModal(isEdit ? 'Edit Leave Type' : 'Add Leave Type', f);

        f.querySelector('#lt-carry').addEventListener('change', (e) => {
          f.querySelector('#lt-carry-max-group').style.display = e.target.checked ? 'block' : 'none';
        });

        f.querySelector('#lt-save').addEventListener('click', async () => {
          const name = f.querySelector('#lt-name').value.trim();
          const code = f.querySelector('#lt-code').value.trim().toUpperCase();
          if (!name || !code) return toast('Name and code are required');
          const payload = {
            name, code,
            annual_quota: parseInt(f.querySelector('#lt-quota').value) || 12,
            carry_forward: f.querySelector('#lt-carry').checked,
            max_carry_forward: parseInt(f.querySelector('#lt-maxcarry').value) || 0,
            max_consecutive_days: parseInt(f.querySelector('#lt-maxcons').value) || null,
            is_paid: f.querySelector('#lt-paid').checked,
            requires_document: f.querySelector('#lt-doc').checked,
            is_active: f.querySelector('#lt-active').checked,
          };
          if (isEdit) {
            const { error } = await sb.from('leave_types').update(payload).eq('id', existing.id);
            if (error) return toast(error.message);
            await logAction('leave', 'leave_type', existing.id, 'updated', existing, payload);
          } else {
            payload.org_id = org.id;
            const { error } = await sb.from('leave_types').insert(payload);
            if (error) return toast(error.message);
            await logAction('leave', 'leave_type', null, 'created', null, payload);
          }
          closeModal(); toast(isEdit ? 'Leave type updated' : 'Leave type added'); renderLeaveTypes();
        });
      }

      document.getElementById('add-lt-btn')?.addEventListener('click', () => openLeaveTypeModal(null));

      contentEl.querySelectorAll('[data-edit-lt]').forEach(btn => {
        btn.addEventListener('click', () => {
          const lt = (types || []).find(t => t.id === btn.dataset.editLt);
          if (lt) openLeaveTypeModal(lt);
        });
      });

      contentEl.querySelectorAll('[data-toggle-lt]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const newActive = btn.dataset.ltActive !== 'true';
          const { error } = await sb.from('leave_types').update({ is_active: newActive }).eq('id', btn.dataset.toggleLt);
          if (error) return toast(error.message);
          toast(newActive ? 'Leave type activated' : 'Leave type deactivated');
          renderLeaveTypes();
        });
      });

      contentEl.querySelectorAll('[data-del-lt]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this leave type? This may affect existing leave balances.')) return;
          const { error } = await sb.from('leave_types').delete().eq('id', btn.dataset.delLt);
          if (error) return toast(error.message);
          await logAction('leave', 'leave_type', btn.dataset.delLt, 'deleted', null, null);
          toast('Leave type deleted'); renderLeaveTypes();
        });
      });
    }
  }

  async function renderHolidays() {
    let holidayYear = new Date().getFullYear();
    async function loadHolidays(year) {
      holidayYear = year;
      const { data: holidays, error: holErr } = await sb.from('holidays').select('*').eq('year', year).order('date');
      if (holErr) toast('Failed to load holidays: ' + holErr.message);
      renderHolidayContent(holidays || [], year);
    }

    function renderHolidayContent(holidays, year) {
      const today = new Date().toISOString().split('T')[0];
      contentEl.innerHTML = `
        <div class="card">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2)">
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <button class="btn btn-secondary btn-sm" id="hol-prev">&larr;</button>
              <span style="font-weight:var(--font-weight-semibold);min-width:60px;text-align:center" id="hol-year">${year}</span>
              <button class="btn btn-secondary btn-sm" id="hol-next">&rarr;</button>
              <span style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-left:var(--space-2)">${holidays.length} holiday${holidays.length !== 1 ? 's' : ''}</span>
            </div>
            ${isAdmin ? `<div style="display:flex;gap:var(--space-2)">
              <button class="btn btn-secondary btn-sm" id="copy-hol-btn">Copy from ${year - 1}</button>
              <button class="btn btn-primary btn-sm" id="add-hol-btn">+ Add Holiday</button>
            </div>` : ''}
          </div>
          <div class="card-body">
            ${holidays.length ? `<div class="table-wrap"><table class="table">
              <thead><tr><th>Date</th><th>Day</th><th>Name</th><th>Type</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
              <tbody>${holidays.map(h => {
                const dt = new Date(h.date + 'T00:00:00');
                const isPast = h.date < today;
                return `<tr style="${isPast ? 'opacity:0.5' : ''}">
                  <td>${dt.toLocaleDateString('en', { day: 'numeric', month: 'short' })}</td>
                  <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${dt.toLocaleDateString('en', { weekday: 'long' })}</td>
                  <td style="font-weight:var(--font-weight-medium)">${esc(h.name)}</td>
                  <td><span class="badge badge-${h.is_optional ? 'warning' : 'success'}">${h.is_optional ? 'Optional' : 'Mandatory'}</span></td>
                  ${isAdmin ? `<td>
                    <div style="display:flex;gap:var(--space-1)">
                      <button class="btn btn-ghost btn-sm" data-edit-hol="${h.id}" style="font-size:var(--text-xs)">Edit</button>
                      <button class="btn btn-ghost btn-sm" data-del-hol="${h.id}" style="color:var(--color-error)">&times;</button>
                    </div>
                  </td>` : ''}
                </tr>`;
              }).join('')}</tbody>
            </table></div>` : `<div style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-6)">
              No holidays configured for ${year}
              ${isAdmin ? `<div style="margin-top:var(--space-2);font-size:var(--text-xs)">Add holidays manually or copy from a previous year</div>` : ''}
            </div>`}
          </div>
        </div>`;

      document.getElementById('hol-prev')?.addEventListener('click', () => loadHolidays(year - 1));
      document.getElementById('hol-next')?.addEventListener('click', () => loadHolidays(year + 1));

      if (isAdmin) {
        document.getElementById('add-hol-btn')?.addEventListener('click', () => openHolidayModal(null, year));

        document.getElementById('copy-hol-btn')?.addEventListener('click', async () => {
          const { data: prevHols, error: holError } = await sb.from('holidays').select('name, date, is_optional').eq('year', year - 1).eq('org_id', org.id);
          if (holError) { toast('Failed to fetch holidays: ' + holError.message); return; }
          if (!prevHols?.length) return toast(`No holidays found in ${year - 1}`);
          if (!confirm(`Copy ${prevHols.length} holidays from ${year - 1} to ${year}? Dates will shift to the same month/day in ${year}.`)) return;
          const newHols = prevHols.map(h => {
            const oldDate = new Date(h.date + 'T00:00:00');
            const newDate = `${year}-${String(oldDate.getMonth() + 1).padStart(2, '0')}-${String(oldDate.getDate()).padStart(2, '0')}`;
            return { org_id: org.id, name: h.name, date: newDate, is_optional: h.is_optional, year };
          });
          const { error } = await sb.from('holidays').insert(newHols);
          if (error) return toast(error.message);
          toast(`${newHols.length} holidays copied to ${year}`);
          loadHolidays(year);
        });

        contentEl.querySelectorAll('[data-edit-hol]').forEach(btn => {
          btn.addEventListener('click', () => {
            const h = holidays.find(x => x.id === btn.dataset.editHol);
            if (h) openHolidayModal(h, year);
          });
        });

        contentEl.querySelectorAll('[data-del-hol]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Delete this holiday?')) return;
            const { error } = await sb.from('holidays').delete().eq('id', btn.dataset.delHol);
            if (error) return toast(error.message);
            await logAction('leave', 'holiday', btn.dataset.delHol, 'deleted', null, null);
            toast('Holiday deleted'); loadHolidays(year);
          });
        });
      }
    }

    function openHolidayModal(existing, year) {
      const isEdit = !!existing;
      const f = document.createElement('div');
      f.innerHTML = `<div style="display:grid;gap:var(--space-4)">
        <div class="form-group"><label class="form-label">Holiday Name</label><input type="text" class="form-input" id="hol-name" placeholder="e.g. Independence Day" value="${isEdit ? esc(existing.name) : ''}"></div>
        <div class="form-group"><label class="form-label">Date</label><input type="date" class="form-input" id="hol-date" value="${isEdit ? existing.date : ''}"></div>
        <div class="form-group"><label style="display:flex;align-items:center;gap:var(--space-2)"><input type="checkbox" id="hol-optional" ${isEdit && existing.is_optional ? 'checked' : ''}> Optional holiday</label></div>
        <button class="btn btn-primary" id="hol-save">${isEdit ? 'Save Changes' : 'Add Holiday'}</button>
      </div>`;
      openModal(isEdit ? 'Edit Holiday' : 'Add Holiday', f);
      f.querySelector('#hol-save').addEventListener('click', async () => {
        const name = f.querySelector('#hol-name').value.trim();
        const date = f.querySelector('#hol-date').value;
        if (!name || !date) return toast('Name and date required');
        const payload = { name, date, is_optional: f.querySelector('#hol-optional').checked, year: new Date(date).getFullYear() };
        if (isEdit) {
          const { error } = await sb.from('holidays').update(payload).eq('id', existing.id);
          if (error) return toast(error.message);
          await logAction('leave', 'holiday', existing.id, 'updated', existing, payload);
        } else {
          payload.org_id = org.id;
          const { error } = await sb.from('holidays').insert(payload);
          if (error) return toast(error.message);
          await logAction('leave', 'holiday', null, 'created', null, payload);
        }
        closeModal(); toast(isEdit ? 'Holiday updated' : 'Holiday added'); loadHolidays(year);
      });
    }

    await loadHolidays(holidayYear);
  }

  async function renderSchedules() {
    const { data: schedules, error: wsErr } = await sb.from('work_schedules').select('*').order('name');
    if (wsErr) toast('Failed to load schedules: ' + wsErr.message);

    contentEl.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span class="card-title">Work Schedules</span>
            <span style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-left:var(--space-2)">${(schedules || []).length} schedule${(schedules || []).length !== 1 ? 's' : ''}</span>
          </div>
          ${isAdmin ? '<button class="btn btn-primary btn-sm" id="add-ws-btn">+ Add Schedule</button>' : ''}
        </div>
        <div class="card-body">
          ${(schedules || []).length ? `<div style="display:grid;gap:var(--space-3)">
            ${(schedules || []).map(s => {
              const offs = (s.weekly_offs || []).map(d => DAY_NAMES[d % 7] || d);
              return `<div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-4);position:relative">
                ${s.is_default ? '<span class="badge badge-success" style="position:absolute;top:var(--space-3);right:var(--space-3)"><span class="badge-dot"></span>Default</span>' : ''}
                <div style="font-weight:var(--font-weight-semibold);margin-bottom:var(--space-2)">${esc(s.name)}</div>
                <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;font-size:var(--text-sm);color:var(--color-text-secondary)">
                  <div>Shift: <strong>${s.shift_start} – ${s.shift_end}</strong></div>
                  <div>Weekly Off: <strong>${offs.length ? offs.join(', ') : 'None'}</strong></div>
                </div>
                <div style="display:flex;gap:var(--space-2);margin-top:var(--space-3)">
                  <div style="display:flex;gap:var(--space-1)">
                    ${DAY_NAMES.map((day, i) => {
                      const isOff = (s.weekly_offs || []).includes(i);
                      return `<div style="width:28px;height:28px;border-radius:var(--radius-full);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:var(--font-weight-semibold);${isOff ? 'background:var(--color-error-light);color:var(--color-error)' : 'background:var(--color-bg-secondary);color:var(--color-text-tertiary)'}">${day.charAt(0)}</div>`;
                    }).join('')}
                  </div>
                </div>
                ${isAdmin ? `<div style="display:flex;gap:var(--space-2);margin-top:var(--space-3);border-top:1px solid var(--color-border-light);padding-top:var(--space-3)">
                  <button class="btn btn-ghost btn-sm" data-edit-ws="${s.id}">Edit</button>
                  ${!s.is_default ? `<button class="btn btn-ghost btn-sm" data-default-ws="${s.id}">Set as Default</button>` : ''}
                  <button class="btn btn-ghost btn-sm" data-del-ws="${s.id}" style="color:var(--color-error)">Delete</button>
                </div>` : ''}
              </div>`;
            }).join('')}
          </div>` : '<div style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-6)">No work schedules configured. Create one to define shift timings and weekly offs.</div>'}
        </div>
      </div>`;

    if (isAdmin) {
      function openScheduleModal(existing) {
        const isEdit = !!existing;
        const f = document.createElement('div');
        f.innerHTML = `<div style="display:grid;gap:var(--space-4)">
          <div class="form-group"><label class="form-label">Schedule Name</label><input type="text" class="form-input" id="ws-name" placeholder="e.g. Default, Night Shift" value="${isEdit ? esc(existing.name) : ''}"></div>
          <div style="display:flex;gap:var(--space-3)">
            <div class="form-group" style="flex:1"><label class="form-label">Shift Start</label><input type="time" class="form-input" id="ws-start" value="${isEdit ? existing.shift_start : '09:00'}"></div>
            <div class="form-group" style="flex:1"><label class="form-label">Shift End</label><input type="time" class="form-input" id="ws-end" value="${isEdit ? existing.shift_end : '18:00'}"></div>
          </div>
          <div class="form-group">
            <label class="form-label">Weekly Offs</label>
            <div style="display:flex;gap:var(--space-2);flex-wrap:wrap" id="ws-offs">
              ${DAY_NAMES.map((day, i) => {
                const checked = isEdit ? (existing.weekly_offs || []).includes(i) : (i === 0 || i === 6);
                return `<label style="display:flex;align-items:center;gap:var(--space-1);font-size:var(--text-sm);cursor:pointer;padding:var(--space-1) var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-md)">
                  <input type="checkbox" value="${i}" ${checked ? 'checked' : ''}> ${day}
                </label>`;
              }).join('')}
            </div>
          </div>
          <div class="form-group"><label style="display:flex;align-items:center;gap:var(--space-2)"><input type="checkbox" id="ws-default" ${isEdit && existing.is_default ? 'checked' : ''}> Set as default schedule</label></div>
          <button class="btn btn-primary" id="ws-save">${isEdit ? 'Save Changes' : 'Create Schedule'}</button>
        </div>`;
        openModal(isEdit ? 'Edit Work Schedule' : 'Add Work Schedule', f);
        f.querySelector('#ws-save').addEventListener('click', async () => {
          const name = f.querySelector('#ws-name').value.trim();
          if (!name) return toast('Name required');
          const weekly_offs = Array.from(f.querySelectorAll('#ws-offs input:checked')).map(cb => parseInt(cb.value));
          const payload = {
            name,
            shift_start: f.querySelector('#ws-start').value,
            shift_end: f.querySelector('#ws-end').value,
            weekly_offs,
            is_default: f.querySelector('#ws-default').checked,
          };
          if (isEdit) {
            const { error } = await sb.from('work_schedules').update(payload).eq('id', existing.id);
            if (error) return toast(error.message);
            await logAction('attendance', 'work_schedule', existing.id, 'updated', existing, payload);
          } else {
            payload.org_id = org.id;
            const { error } = await sb.from('work_schedules').insert(payload);
            if (error) return toast(error.message);
            await logAction('attendance', 'work_schedule', null, 'created', null, payload);
          }
          closeModal(); toast(isEdit ? 'Schedule updated' : 'Schedule added'); renderSchedules();
        });
      }

      document.getElementById('add-ws-btn')?.addEventListener('click', () => openScheduleModal(null));

      contentEl.querySelectorAll('[data-edit-ws]').forEach(btn => {
        btn.addEventListener('click', () => {
          const ws = (schedules || []).find(s => s.id === btn.dataset.editWs);
          if (ws) openScheduleModal(ws);
        });
      });

      contentEl.querySelectorAll('[data-default-ws]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await sb.from('work_schedules').update({ is_default: false }).eq('org_id', org.id);
          const { error } = await sb.from('work_schedules').update({ is_default: true }).eq('id', btn.dataset.defaultWs);
          if (error) return toast(error.message);
          toast('Default schedule updated'); renderSchedules();
        });
      });

      contentEl.querySelectorAll('[data-del-ws]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this work schedule?')) return;
          const { error } = await sb.from('work_schedules').delete().eq('id', btn.dataset.delWs);
          if (error) return toast(error.message);
          await logAction('attendance', 'work_schedule', btn.dataset.delWs, 'deleted', null, null);
          toast('Schedule deleted'); renderSchedules();
        });
      });
    }
  }

  async function renderExpenseCategories() {
    const { data: categories, error } = await sb.from('expense_categories')
      .select('*').eq('org_id', org.id).order('name');
    if (error) console.error(error);

    contentEl.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2)">
          <span class="card-title">Expense Categories</span>
          ${isAdmin ? '<button class="btn btn-primary btn-sm" id="btn-add-cat">Add Category</button>' : ''}
        </div>
        <div class="card-body">
          ${!categories?.length ? '<div class="empty-state"><p>No expense categories configured</p></div>' : `
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Name</th><th>Code</th><th>Spending Limit</th><th>Status</th><th></th></tr></thead>
              <tbody>${categories.map(c => `<tr>
                <td style="font-weight:var(--font-weight-medium)">${esc(c.name)}</td>
                <td><span class="badge">${esc(c.code)}</span></td>
                <td>${c.spending_limit ? `${org?.currency || 'INR'} ${parseFloat(c.spending_limit).toLocaleString()}` : '—'}</td>
                <td><span class="badge ${c.is_active ? 'badge-success' : 'badge-error'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>${isAdmin ? `<button class="btn btn-ghost btn-sm" data-del-cat="${c.id}" style="color:var(--color-error)">Delete</button>` : ''}</td>
              </tr>`).join('')}</tbody>
            </table></div>
          `}
        </div>
      </div>
    `;

    if (isAdmin) {
      contentEl.querySelector('#btn-add-cat')?.addEventListener('click', () => {
        openModal('Add Expense Category', `
          <form id="cat-form" style="display:flex;flex-direction:column;gap:var(--space-3)">
            <div><label class="form-label">Name</label><input class="form-input" name="name" required placeholder="e.g. Travel"></div>
            <div><label class="form-label">Code</label><input class="form-input" name="code" required placeholder="e.g. TRV" style="text-transform:uppercase"></div>
            <div><label class="form-label">Spending Limit (optional)</label><input class="form-input" name="spending_limit" type="number" step="0.01" placeholder="0.00"></div>
            <div style="display:flex;gap:var(--space-2);justify-content:flex-end"><button type="button" class="btn btn-secondary" onclick="document.querySelector('.modal-overlay').remove()">Cancel</button><button type="submit" class="btn btn-primary">Add</button></div>
          </form>
        `);
        document.getElementById('cat-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const { error } = await sb.from('expense_categories').insert({
            org_id: org.id,
            name: fd.get('name').trim(),
            code: fd.get('code').trim().toUpperCase(),
            spending_limit: fd.get('spending_limit') ? parseFloat(fd.get('spending_limit')) : null,
          });
          if (error) { toast(error.message); return; }
          closeModal(); toast('Category added'); renderExpenseCategories();
        });
      });

      contentEl.querySelectorAll('[data-del-cat]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this category?')) return;
          const { error } = await sb.from('expense_categories').delete().eq('id', btn.dataset.delCat);
          if (error) return toast(error.message);
          toast('Category deleted'); renderExpenseCategories();
        });
      });
    }
  }

  renderTab();
}
