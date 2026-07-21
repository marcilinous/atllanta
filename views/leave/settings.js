import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate } from '../../js/ui.js';

export default async function leaveSettings(container) {
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  if (!isAdmin) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Access denied</div><div class="empty-state-desc">Only admins can manage leave settings.</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Leave Settings</h1>
      <p class="page-subtitle">Configure leave types, policies, and holidays</p>
    </div>
    <div class="tabs" id="ls-tabs">
      <button class="tab active" data-tab="types">Leave Types</button>
      <button class="tab" data-tab="holidays">Holidays</button>
    </div>
    <div id="ls-content" style="margin-top:var(--space-4)"></div>
  `;

  if (!org) return;

  let currentTab = 'types';

  document.getElementById('ls-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#ls-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderTab();
  });

  async function renderTab() {
    const el = document.getElementById('ls-content');
    if (currentTab === 'types') await renderTypes(el);
    else if (currentTab === 'holidays') await renderHolidays(el);
  }

  async function renderTypes(el) {
    const { data: types } = await sb.from('leave_types').select('*').eq('org_id', org.id).order('name');
    const allTypes = types || [];

    el.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:var(--space-3)">
        <button class="btn btn-primary" id="add-type-btn">+ Add Leave Type</button>
      </div>
      ${allTypes.length ? `<div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Code</th><th>Annual Quota</th><th>Carry Forward</th><th>Paid</th><th>Active</th><th>Actions</th></tr></thead>
        <tbody>${allTypes.map(t => `<tr>
          <td style="font-weight:var(--font-weight-medium)">${esc(t.name)}</td>
          <td><span class="badge badge-neutral">${esc(t.code)}</span></td>
          <td>${t.annual_quota} days</td>
          <td>${t.carry_forward ? `Yes (max ${t.max_carry_forward || 0})` : 'No'}</td>
          <td>${t.is_paid ? '<span style="color:var(--color-success)">Yes</span>' : '<span style="color:var(--color-error)">No</span>'}</td>
          <td>${t.is_active ? '<span class="badge badge-success"><span class="badge-dot"></span>Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
          <td>
            <div style="display:flex;gap:var(--space-1)">
              <button class="btn btn-ghost btn-sm" data-edit-type="${t.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-toggle-type="${t.id}" data-active="${t.is_active}" style="color:${t.is_active ? 'var(--color-error)' : 'var(--color-success)'}">${t.is_active ? 'Deactivate' : 'Activate'}</button>
            </div>
          </td>
        </tr>`).join('')}</tbody>
      </table></div></div>` : `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">No leave types configured</div>
        <div class="empty-state-desc">Add leave types like Casual Leave, Sick Leave, etc.</div>
      </div></div>`}
    `;

    document.getElementById('add-type-btn').addEventListener('click', () => editType(null));

    el.querySelectorAll('[data-edit-type]').forEach(btn => {
      btn.addEventListener('click', () => editType(allTypes.find(t => t.id === btn.dataset.editType)));
    });

    el.querySelectorAll('[data-toggle-type]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const isActive = btn.dataset.active === 'true';
        await sb.from('leave_types').update({ is_active: !isActive }).eq('id', btn.dataset.toggleType);
        toast(isActive ? 'Leave type deactivated' : 'Leave type activated');
        renderTypes(el);
      });
    });
  }

  function editType(type) {
    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div class="form-group"><label class="form-label">Name</label><input type="text" class="form-input" id="lt-name" value="${esc(type?.name || '')}" placeholder="e.g. Casual Leave"></div>
        <div class="form-group"><label class="form-label">Code</label><input type="text" class="form-input" id="lt-code" value="${esc(type?.code || '')}" placeholder="e.g. CL" maxlength="10"></div>
        <div class="form-group"><label class="form-label">Annual Quota (days)</label><input type="number" class="form-input" id="lt-quota" value="${type?.annual_quota ?? 12}" min="0"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <div class="form-group">
            <label class="form-label"><input type="checkbox" id="lt-carry" ${type?.carry_forward ? 'checked' : ''}> Carry Forward</label>
          </div>
          <div class="form-group"><label class="form-label">Max Carry Forward</label><input type="number" class="form-input" id="lt-max-carry" value="${type?.max_carry_forward ?? 0}" min="0"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <label class="form-label"><input type="checkbox" id="lt-paid" ${type?.is_paid !== false ? 'checked' : ''}> Paid Leave</label>
          <label class="form-label"><input type="checkbox" id="lt-doc" ${type?.requires_document ? 'checked' : ''}> Requires Document</label>
        </div>
        <div class="form-group"><label class="form-label">Max Consecutive Days</label><input type="number" class="form-input" id="lt-max-days" value="${type?.max_consecutive_days ?? ''}" min="1" placeholder="Leave blank for unlimited"></div>
        <button class="btn btn-primary" id="lt-save">${type ? 'Update' : 'Create'}</button>
      </div>`;
    openModal(type ? 'Edit Leave Type' : 'New Leave Type', f);

    f.querySelector('#lt-save').addEventListener('click', async () => {
      const name = f.querySelector('#lt-name').value.trim();
      const code = f.querySelector('#lt-code').value.trim().toUpperCase();
      if (!name || !code) return toast('Name and code are required');

      const data = {
        name, code,
        annual_quota: parseInt(f.querySelector('#lt-quota').value) || 12,
        carry_forward: f.querySelector('#lt-carry').checked,
        max_carry_forward: parseInt(f.querySelector('#lt-max-carry').value) || 0,
        is_paid: f.querySelector('#lt-paid').checked,
        requires_document: f.querySelector('#lt-doc').checked,
        max_consecutive_days: parseInt(f.querySelector('#lt-max-days').value) || null,
      };

      if (type) {
        const { error } = await sb.from('leave_types').update(data).eq('id', type.id);
        if (error) return toast(error.message);
      } else {
        data.org_id = org.id;
        const { error } = await sb.from('leave_types').insert(data);
        if (error) return toast(error.message);
      }
      closeModal();
      toast(type ? 'Leave type updated' : 'Leave type created');
      renderTypes(document.getElementById('ls-content'));
    });
  }

  async function renderHolidays(el) {
    const year = new Date().getFullYear();
    const { data: holidays } = await sb.from('holidays').select('*').eq('org_id', org.id).eq('year', year).order('date');
    const allHolidays = holidays || [];

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">${year} — ${allHolidays.length} holiday${allHolidays.length !== 1 ? 's' : ''}</span>
        <button class="btn btn-primary" id="add-holiday-btn">+ Add Holiday</button>
      </div>
      ${allHolidays.length ? `<div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Name</th><th>Type</th><th>Actions</th></tr></thead>
        <tbody>${allHolidays.map(h => `<tr>
          <td style="font-weight:var(--font-weight-medium)">${formatDate(h.date)}</td>
          <td>${esc(h.name)}</td>
          <td>${h.is_optional ? '<span class="badge badge-warning">Optional</span>' : '<span class="badge badge-success">Mandatory</span>'}</td>
          <td><button class="btn btn-ghost btn-sm" data-delete-holiday="${h.id}" style="color:var(--color-error)">Delete</button></td>
        </tr>`).join('')}</tbody>
      </table></div></div>` : `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">No holidays configured</div>
        <div class="empty-state-desc">Add holidays for ${year}.</div>
      </div></div>`}
    `;

    document.getElementById('add-holiday-btn').addEventListener('click', () => {
      const f = document.createElement('div');
      f.innerHTML = `
        <div style="display:grid;gap:var(--space-4)">
          <div class="form-group"><label class="form-label">Holiday Name</label><input type="text" class="form-input" id="hol-name" placeholder="e.g. Diwali"></div>
          <div class="form-group"><label class="form-label">Date</label><input type="date" class="form-input" id="hol-date"></div>
          <label class="form-label"><input type="checkbox" id="hol-optional"> Optional Holiday</label>
          <button class="btn btn-primary" id="hol-save">Add Holiday</button>
        </div>`;
      openModal('Add Holiday', f);

      f.querySelector('#hol-save').addEventListener('click', async () => {
        const name = f.querySelector('#hol-name').value.trim();
        const date = f.querySelector('#hol-date').value;
        if (!name || !date) return toast('Name and date are required');

        const { error } = await sb.from('holidays').insert({
          org_id: org.id, name, date,
          is_optional: f.querySelector('#hol-optional').checked,
          year: new Date(date).getFullYear(),
        });
        if (error) return toast(error.message);
        closeModal();
        toast('Holiday added');
        renderHolidays(el);
      });
    });

    el.querySelectorAll('[data-delete-holiday]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this holiday?')) return;
        await sb.from('holidays').delete().eq('id', btn.dataset.deleteHoliday);
        toast('Holiday deleted');
        renderHolidays(el);
      });
    });
  }

  renderTab();
}
