import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, initials, avColor } from '../../js/ui.js';

const DEFAULT_CATEGORIES = [
  { name: 'IT Support', description: 'Hardware, software, network, and access issues', icon: '💻' },
  { name: 'HR', description: 'Policies, benefits, grievances, and documentation', icon: '👤' },
  { name: 'Admin / Facilities', description: 'Office supplies, seating, parking, and building access', icon: '🏢' },
  { name: 'Finance', description: 'Reimbursements, salary queries, and tax documents', icon: '💰' },
  { name: 'Security', description: 'Physical security, ID cards, and access control', icon: '🔒' },
];

export default async function helpdeskSettings(container) {
  const user = await getUser();
  const org = await getOrg();
  const membership = await getMembership();
  const role = membership?.role || 'member';

  if (!['owner', 'admin'].includes(role)) {
    container.innerHTML = `<div class="empty-state"><h3>Access Denied</h3><p>Only admins can manage helpdesk settings.</p></div>`;
    return;
  }

  async function loadData() {
    const [{ data: categories }, { data: handlers }, { data: employees }] = await Promise.all([
      sb.from('helpdesk_categories').select('*').eq('org_id', org.id).order('sort_order').order('name'),
      sb.from('helpdesk_category_handlers').select('*, user:user_id(id, full_name, email, designation, role)'),
      sb.from('users').select('id, full_name, email, designation, role').eq('org_id', org.id).eq('status', 'active').order('full_name'),
    ]);
    return { categories: categories || [], handlers: handlers || [], employees: employees || [] };
  }

  async function render() {
    const { categories, handlers, employees } = await loadData();
    const handlerMap = {};
    handlers.forEach(h => {
      if (!handlerMap[h.category_id]) handlerMap[h.category_id] = [];
      handlerMap[h.category_id].push(h);
    });

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6);flex-wrap:wrap;gap:var(--space-3)">
        <div>
          <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);color:var(--color-text-primary);margin:0 0 var(--space-1)">Helpdesk Settings</h1>
          <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0">Configure ticket categories and assign handlers</p>
        </div>
        <div style="display:flex;gap:var(--space-2)">
          ${!categories.length ? `<button class="btn btn-secondary" id="load-defaults">Load Defaults</button>` : ''}
          <button class="btn btn-primary" id="add-category">Add Category</button>
        </div>
      </div>

      ${!categories.length ? `
        <div class="empty-state">
          <div class="empty-state-icon">🎫</div>
          <h3 class="empty-state-title">No categories configured</h3>
          <p class="empty-state-desc">Add ticket categories so employees can route their requests to the right team. Click "Load Defaults" for a quick start.</p>
        </div>
      ` : `
        <div id="categories-list" style="display:grid;gap:var(--space-4)">
          ${categories.map((cat, idx) => {
            const catHandlers = handlerMap[cat.id] || [];
            return `
              <div class="card" data-cat-id="${cat.id}">
                <div class="card-body">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-3);margin-bottom:var(--space-3)">
                    <div style="display:flex;align-items:center;gap:var(--space-3)">
                      <span style="font-size:var(--text-xl)">${esc(cat.icon || '📋')}</span>
                      <div>
                        <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-md);color:var(--color-text-primary)">${esc(cat.name)}</div>
                        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(cat.description || 'No description')}</div>
                      </div>
                    </div>
                    <div style="display:flex;gap:var(--space-2);flex-shrink:0">
                      ${!cat.is_active ? '<span class="badge badge-neutral">Inactive</span>' : ''}
                      <button class="btn btn-secondary btn-sm" data-edit="${cat.id}">Edit</button>
                      <button class="btn btn-secondary btn-sm" data-delete="${cat.id}" style="color:var(--color-error)">Delete</button>
                    </div>
                  </div>

                  <div style="border-top:1px solid var(--color-border);padding-top:var(--space-3)">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2)">
                      <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);color:var(--color-text-secondary)">Assigned Handlers (${catHandlers.length})</span>
                      <button class="btn btn-secondary btn-sm" data-add-handler="${cat.id}">+ Add Handler</button>
                    </div>
                    ${catHandlers.length ? `
                      <div style="display:flex;flex-wrap:wrap;gap:var(--space-2)">
                        ${catHandlers.map(h => `
                          <div style="display:flex;align-items:center;gap:var(--space-2);background:var(--color-bg-secondary);border-radius:var(--radius-full);padding:var(--space-1) var(--space-3) var(--space-1) var(--space-1)">
                            <div style="width:24px;height:24px;border-radius:var(--radius-full);background:${avColor(h.user?.full_name || '')};display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:var(--font-weight-semibold)">${initials(h.user?.full_name || '?')}</div>
                            <span style="font-size:var(--text-sm);color:var(--color-text-primary)">${esc(h.user?.full_name || h.user?.email || '—')}</span>
                            <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(h.user?.designation || h.user?.role || '')}</span>
                            <button style="background:none;border:none;cursor:pointer;color:var(--color-text-tertiary);font-size:var(--text-sm);padding:0 2px" data-remove-handler="${h.id}" title="Remove handler">&times;</button>
                          </div>
                        `).join('')}
                      </div>
                    ` : `<div style="font-size:var(--text-sm);color:var(--color-text-tertiary);font-style:italic">No handlers assigned — tickets will go to all admins</div>`}
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      `}
    `;

    document.getElementById('add-category')?.addEventListener('click', () => showCategoryModal());
    document.getElementById('load-defaults')?.addEventListener('click', loadDefaults);

    container.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = categories.find(c => c.id === btn.dataset.edit);
        if (cat) showCategoryModal(cat);
      });
    });

    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this category? Existing tickets will keep their category reference.')) return;
        const { error } = await sb.from('helpdesk_categories').delete().eq('id', btn.dataset.delete);
        if (error) { toast(error.message, 'error'); return; }
        toast('Category deleted');
        render();
      });
    });

    container.querySelectorAll('[data-add-handler]').forEach(btn => {
      btn.addEventListener('click', () => {
        const catId = btn.dataset.addHandler;
        const cat = categories.find(c => c.id === catId);
        const existing = (handlerMap[catId] || []).map(h => h.user_id);
        const available = employees.filter(e => !existing.includes(e.id));
        showAddHandlerModal(catId, cat?.name || '', available);
      });
    });

    container.querySelectorAll('[data-remove-handler]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await sb.from('helpdesk_category_handlers').delete().eq('id', btn.dataset.removeHandler);
        if (error) { toast(error.message, 'error'); return; }
        toast('Handler removed');
        render();
      });
    });
  }

  function showCategoryModal(existing) {
    const isEdit = !!existing;
    const html = `
      <form id="cat-form">
        <div class="form-group">
          <label class="form-label">Icon (emoji)</label>
          <input class="form-input" name="icon" value="${esc(existing?.icon || '📋')}" maxlength="4" style="width:80px">
        </div>
        <div class="form-group">
          <label class="form-label">Category Name</label>
          <input class="form-input" name="name" value="${esc(existing?.name || '')}" required maxlength="100" placeholder="e.g. IT Support">
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <input class="form-input" name="description" value="${esc(existing?.description || '')}" maxlength="200" placeholder="What kind of tickets belong here">
        </div>
        <div class="form-group">
          <label class="form-label">Sort Order</label>
          <input class="form-input" name="sort_order" type="number" value="${existing?.sort_order ?? 0}" min="0">
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:var(--space-2)">
          <input type="checkbox" id="cat-active" name="is_active" ${existing?.is_active !== false ? 'checked' : ''}>
          <label for="cat-active" class="form-label" style="margin:0">Active</label>
        </div>
        <div style="display:flex;gap:var(--space-3);justify-content:flex-end;margin-top:var(--space-4)">
          <button type="button" class="btn btn-secondary" id="cancel-cat">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Update' : 'Create'}</button>
        </div>
      </form>`;
    openModal(isEdit ? 'Edit Category' : 'New Category', html);
    document.getElementById('cancel-cat').addEventListener('click', closeModal);
    document.getElementById('cat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        name: fd.get('name'),
        description: fd.get('description'),
        icon: fd.get('icon') || '📋',
        sort_order: parseInt(fd.get('sort_order')) || 0,
        is_active: fd.has('is_active'),
      };

      if (isEdit) {
        const { error } = await sb.from('helpdesk_categories').update(payload).eq('id', existing.id);
        if (error) { toast(error.message, 'error'); return; }
        toast('Category updated');
      } else {
        payload.org_id = org.id;
        const { error } = await sb.from('helpdesk_categories').insert(payload);
        if (error) { toast(error.message, 'error'); return; }
        toast('Category created');
      }
      closeModal();
      render();
    });
  }

  function showAddHandlerModal(categoryId, categoryName, available) {
    if (!available.length) {
      toast('All employees are already assigned to this category');
      return;
    }
    const html = `
      <div style="margin-bottom:var(--space-3)">
        <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0 0 var(--space-3)">Select employees to handle <strong>${esc(categoryName)}</strong> tickets:</p>
        <input class="form-input" id="handler-search" placeholder="Search employees..." style="margin-bottom:var(--space-3)">
        <div id="handler-list" style="max-height:300px;overflow-y:auto;display:grid;gap:var(--space-2)">
          ${available.map(e => `
            <label style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);cursor:pointer;transition:background var(--transition-fast)" class="handler-row" data-name="${esc(e.full_name?.toLowerCase() || '')}">
              <input type="checkbox" value="${e.id}" name="handler">
              <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${avColor(e.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(e.full_name)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(e.full_name)}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(e.designation || e.role || '')} · ${esc(e.email)}</div>
              </div>
            </label>
          `).join('')}
        </div>
      </div>
      <div style="display:flex;gap:var(--space-3);justify-content:flex-end">
        <button class="btn btn-secondary" id="cancel-handler">Cancel</button>
        <button class="btn btn-primary" id="save-handlers">Add Selected</button>
      </div>`;
    openModal('Add Handlers', html);

    document.getElementById('handler-search').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.handler-row').forEach(r => {
        r.style.display = r.dataset.name.includes(q) ? '' : 'none';
      });
    });

    document.getElementById('cancel-handler').addEventListener('click', closeModal);
    document.getElementById('save-handlers').addEventListener('click', async () => {
      const checked = [...document.querySelectorAll('[name="handler"]:checked')].map(c => c.value);
      if (!checked.length) { toast('Select at least one employee'); return; }
      const rows = checked.map(uid => ({ category_id: categoryId, user_id: uid }));
      const { error } = await sb.from('helpdesk_category_handlers').insert(rows);
      if (error) { toast(error.message, 'error'); return; }
      toast(`${checked.length} handler${checked.length > 1 ? 's' : ''} added`);
      closeModal();
      render();
    });
  }

  async function loadDefaults() {
    const rows = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, org_id: org.id, sort_order: i }));
    const { error } = await sb.from('helpdesk_categories').insert(rows);
    if (error) { toast(error.message, 'error'); return; }
    toast('Default categories loaded — now assign handlers to each');
    render();
  }

  await render();
}
