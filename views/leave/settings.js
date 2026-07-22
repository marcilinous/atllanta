import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';

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
    const { data: types, error: typesErr } = await sb.from('leave_types').select('*').eq('org_id', org.id).order('name');
    if (typesErr) toast('Failed to load leave types: ' + typesErr.message);
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
        const { error } = await sb.from('leave_types').update({ is_active: !isActive }).eq('id', btn.dataset.toggleType);
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('leave', 'leave_type', btn.dataset.toggleType, isActive ? 'deactivated' : 'activated', { is_active: isActive }, { is_active: !isActive });
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
        await logAction('leave', 'leave_type', type.id, 'updated', { name: type.name, code: type.code }, data);
      } else {
        data.org_id = org.id;
        const { error } = await sb.from('leave_types').insert(data);
        if (error) return toast(error.message);
        await logAction('leave', 'leave_type', null, 'created', null, data);
      }
      closeModal();
      toast(type ? 'Leave type updated' : 'Leave type created');
      renderTypes(document.getElementById('ls-content'));
    });
  }

  let holidayYear = new Date().getFullYear();

  async function renderHolidays(el) {
    const year = holidayYear;
    const { data: holidays, error: holErr } = await sb.from('holidays').select('*').eq('org_id', org.id).eq('year', year).order('date');
    if (holErr) toast('Failed to load holidays: ' + holErr.message);
    const allHolidays = holidays || [];
    const mandatory = allHolidays.filter(h => !h.is_optional).length;
    const optional = allHolidays.filter(h => h.is_optional).length;
    const todayStr = new Date().toISOString().split('T')[0];

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);flex-wrap:wrap;gap:var(--space-3)">
        <div style="display:flex;align-items:center;gap:var(--space-3)">
          <button class="btn btn-ghost btn-sm" id="hol-prev-yr" style="padding:var(--space-1) var(--space-2)">&larr;</button>
          <span style="font-weight:var(--font-weight-semibold);font-size:var(--text-md)">${year}</span>
          <button class="btn btn-ghost btn-sm" id="hol-next-yr" style="padding:var(--space-1) var(--space-2)">&rarr;</button>
          <span style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-left:var(--space-2)">${allHolidays.length} total · ${mandatory} mandatory · ${optional} optional</span>
        </div>
        <div style="display:flex;gap:var(--space-2)">
          <button class="btn btn-secondary btn-sm" id="hol-template-btn">Load Template</button>
          <button class="btn btn-primary btn-sm" id="add-holiday-btn">+ Add Holiday</button>
        </div>
      </div>
      ${allHolidays.length ? `<div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Day</th><th>Name</th><th>Type</th><th>Actions</th></tr></thead>
        <tbody>${allHolidays.map(h => {
          const d = new Date(h.date);
          const dayName = d.toLocaleDateString('en', { weekday: 'short' });
          const isPast = h.date < todayStr;
          return `<tr style="${isPast ? 'opacity:0.5' : ''}">
          <td style="font-weight:var(--font-weight-medium)">${formatDate(h.date)}</td>
          <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${dayName}</td>
          <td>${esc(h.name)}${h.date === todayStr ? ' <span class="badge badge-success" style="margin-left:var(--space-1)">Today</span>' : ''}</td>
          <td>${h.is_optional ? '<span class="badge badge-warning">Optional</span>' : '<span class="badge badge-success">Mandatory</span>'}</td>
          <td>
            <div style="display:flex;gap:var(--space-1)">
              <button class="btn btn-ghost btn-sm" data-edit-holiday="${h.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-delete-holiday="${h.id}" style="color:var(--color-error)">Delete</button>
            </div>
          </td>
        </tr>`;
        }).join('')}</tbody>
      </table></div></div>` : `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">No holidays for ${year}</div>
        <div class="empty-state-desc">Add holidays manually or load a template of common Indian holidays.</div>
      </div></div>`}
    `;

    document.getElementById('hol-prev-yr').addEventListener('click', () => { holidayYear--; renderHolidays(el); });
    document.getElementById('hol-next-yr').addEventListener('click', () => { holidayYear++; renderHolidays(el); });

    document.getElementById('add-holiday-btn').addEventListener('click', () => editHoliday(null, year, el));

    el.querySelectorAll('[data-edit-holiday]').forEach(btn => {
      btn.addEventListener('click', () => {
        const h = allHolidays.find(x => x.id === btn.dataset.editHoliday);
        if (h) editHoliday(h, year, el);
      });
    });

    document.getElementById('hol-template-btn').addEventListener('click', () => loadTemplate(year, allHolidays, el));

    el.querySelectorAll('[data-delete-holiday]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this holiday?')) return;
        const { error } = await sb.from('holidays').delete().eq('id', btn.dataset.deleteHoliday);
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('leave', 'holiday', btn.dataset.deleteHoliday, 'deleted', null, null);
        toast('Holiday deleted');
        renderHolidays(el);
      });
    });
  }

  function editHoliday(h, year, el) {
    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div class="form-group"><label class="form-label">Holiday Name</label><input type="text" class="form-input" id="hol-name" value="${esc(h?.name || '')}" placeholder="e.g. Diwali"></div>
        <div class="form-group"><label class="form-label">Date</label><input type="date" class="form-input" id="hol-date" value="${h?.date || ''}"></div>
        <label class="form-label"><input type="checkbox" id="hol-optional" ${h?.is_optional ? 'checked' : ''}> Optional Holiday</label>
        <button class="btn btn-primary" id="hol-save">${h ? 'Update' : 'Add'} Holiday</button>
      </div>`;
    openModal(h ? 'Edit Holiday' : 'Add Holiday', f);

    f.querySelector('#hol-save').addEventListener('click', async () => {
      const name = f.querySelector('#hol-name').value.trim();
      const date = f.querySelector('#hol-date').value;
      if (!name || !date) return toast('Name and date are required');

      const data = { name, date, is_optional: f.querySelector('#hol-optional').checked, year: new Date(date).getFullYear() };
      if (h) {
        const { error } = await sb.from('holidays').update(data).eq('id', h.id);
        if (error) return toast(error.message);
        await logAction('leave', 'holiday', h.id, 'updated', { name: h.name, date: h.date }, data);
      } else {
        data.org_id = org.id;
        const { error } = await sb.from('holidays').insert(data);
        if (error) return toast(error.message);
        await logAction('leave', 'holiday', null, 'created', null, data);
      }
      closeModal();
      toast(h ? 'Holiday updated' : 'Holiday added');
      renderHolidays(el);
    });
  }

  function loadTemplate(year, existing, el) {
    const templates = [
      { name: 'New Year', date: `${year}-01-01` },
      { name: 'Republic Day', date: `${year}-01-26` },
      { name: 'Holi', date: `${year}-03-14` },
      { name: 'Good Friday', date: `${year}-04-18` },
      { name: 'Labour Day', date: `${year}-05-01` },
      { name: 'Independence Day', date: `${year}-08-15` },
      { name: 'Janmashtami', date: `${year}-08-16`, optional: true },
      { name: 'Gandhi Jayanti', date: `${year}-10-02` },
      { name: 'Dussehra', date: `${year}-10-02`, optional: true },
      { name: 'Diwali', date: `${year}-10-20` },
      { name: 'Diwali (Day 2)', date: `${year}-10-21` },
      { name: 'Guru Nanak Jayanti', date: `${year}-11-05`, optional: true },
      { name: 'Christmas', date: `${year}-12-25` },
    ];

    const existingDates = new Set(existing.map(h => h.date));
    const available = templates.filter(t => !existingDates.has(t.date));

    const f = document.createElement('div');
    f.innerHTML = `
      <div style="margin-bottom:var(--space-3);font-size:var(--text-sm);color:var(--color-text-secondary)">Select holidays to add for ${year}. Already-added dates are excluded.</div>
      ${available.length ? `
        <div style="margin-bottom:var(--space-3)">
          <label class="form-label" style="cursor:pointer"><input type="checkbox" id="tpl-select-all" checked> Select All</label>
        </div>
        <div style="max-height:360px;overflow-y:auto;display:grid;gap:var(--space-2)">
          ${available.map((t, i) => {
            const d = new Date(t.date);
            const dayName = d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
            return `<label style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--color-border-light);cursor:pointer">
              <input type="checkbox" class="tpl-check" data-idx="${i}" checked>
              <div style="flex:1">
                <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(t.name)}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${dayName}${t.optional ? ' · Optional' : ''}</div>
              </div>
            </label>`;
          }).join('')}
        </div>
        <button class="btn btn-primary" id="tpl-add" style="margin-top:var(--space-4);width:100%">Add Selected Holidays</button>
      ` : `<div style="text-align:center;padding:var(--space-4);color:var(--color-text-tertiary)">All template holidays are already added for ${year}.</div>`}
    `;
    openModal(`Indian Holiday Template — ${year}`, f);

    if (!available.length) return;

    f.querySelector('#tpl-select-all').addEventListener('change', (e) => {
      f.querySelectorAll('.tpl-check').forEach(c => c.checked = e.target.checked);
    });

    f.querySelector('#tpl-add').addEventListener('click', async () => {
      const selected = [];
      f.querySelectorAll('.tpl-check:checked').forEach(c => {
        selected.push(available[parseInt(c.dataset.idx)]);
      });
      if (!selected.length) return toast('Select at least one holiday');

      const btn = f.querySelector('#tpl-add');
      btn.disabled = true;
      btn.textContent = `Adding ${selected.length} holidays...`;

      const rows = selected.map(t => ({
        org_id: org.id,
        name: t.name,
        date: t.date,
        is_optional: !!t.optional,
        year,
      }));

      const { error } = await sb.from('holidays').insert(rows);
      if (error) { toast('Failed: ' + error.message); btn.disabled = false; btn.textContent = 'Add Selected Holidays'; return; }
      await logAction('leave', 'holiday', null, 'bulk_created', null, { count: rows.length, year });
      closeModal();
      toast(`${selected.length} holidays added`);
      renderHolidays(el);
    });
  }

  renderTab();
}
