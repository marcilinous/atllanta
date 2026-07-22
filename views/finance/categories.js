import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';

const DEFAULT_CATEGORIES = [
  { name: 'Travel', code: 'TRV', description: 'Travel and transportation expenses' },
  { name: 'Meals', code: 'MEL', description: 'Food and dining expenses' },
  { name: 'Office Supplies', code: 'OFS', description: 'Stationery, equipment, and office supplies' },
  { name: 'Software', code: 'SFT', description: 'Software licenses and subscriptions' },
  { name: 'Communication', code: 'COM', description: 'Phone, internet, and communication expenses' },
  { name: 'Training', code: 'TRN', description: 'Training, courses, and certifications' },
  { name: 'Miscellaneous', code: 'MSC', description: 'Other business expenses' },
];

export default async function expenseCategoriesView(container) {
  const org = getOrg();
  const membership = getMembership();
  if (!org || !['owner', 'admin'].includes(membership?.role)) {
    container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3></div>';
    return;
  }

  async function loadCategories() {
    const { data, error } = await sb.from('expense_categories')
      .select('*').eq('org_id', org.id).order('name');
    if (error) { toast(error.message); return []; }
    return data || [];
  }

  function showCategoryModal(existing) {
    const isEdit = !!existing;
    openModal(isEdit ? 'Edit Category' : 'Add Category', `
      <form id="cat-form" style="display:flex;flex-direction:column;gap:var(--space-3)">
        <div style="display:grid;grid-template-columns:1fr auto;gap:var(--space-3)">
          <div>
            <label class="form-label">Name</label>
            <input class="form-input" name="name" required placeholder="e.g. Travel" value="${esc(existing?.name || '')}">
          </div>
          <div>
            <label class="form-label">Code</label>
            <input class="form-input" name="code" required placeholder="TRV" maxlength="5" style="width:80px;text-transform:uppercase" value="${esc(existing?.code || '')}">
          </div>
        </div>
        <div>
          <label class="form-label">Description</label>
          <input class="form-input" name="description" placeholder="Optional description" value="${esc(existing?.description || '')}">
        </div>
        <div>
          <label class="form-label">Spending Limit (${org.currency || 'INR'})</label>
          <input class="form-input" name="spending_limit" type="number" step="0.01" min="0" placeholder="Leave empty for no limit" value="${existing?.spending_limit || ''}">
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <input type="checkbox" id="cat-active" name="is_active" ${existing?.is_active !== false ? 'checked' : ''}>
          <label for="cat-active" class="form-label" style="margin:0">Active</label>
        </div>
        <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-2)">
          <button type="button" class="btn btn-secondary" onclick="document.querySelector('.modal-overlay').remove()">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Add Category'}</button>
        </div>
      </form>
    `);

    document.getElementById('cat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        name: fd.get('name')?.trim(),
        code: fd.get('code')?.trim().toUpperCase(),
        description: fd.get('description')?.trim() || null,
        spending_limit: fd.get('spending_limit') ? parseFloat(fd.get('spending_limit')) : null,
        is_active: !!fd.get('is_active'),
      };
      if (!payload.name || !payload.code) { toast('Name and code are required'); return; }

      if (isEdit) {
        const { error } = await sb.from('expense_categories').update(payload).eq('id', existing.id);
        if (error) { toast(error.message); return; }
        toast('Category updated');
      } else {
        payload.org_id = org.id;
        const { error } = await sb.from('expense_categories').insert(payload);
        if (error) { toast(error.message); return; }
        toast('Category added');
      }
      closeModal();
      render();
    });
  }

  async function render() {
    const categories = await loadCategories();

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6);flex-wrap:wrap;gap:var(--space-3)">
        <div>
          <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-1)">Expense Categories</h1>
          <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0">Configure categories for expense claims</p>
        </div>
        <div style="display:flex;gap:var(--space-2)">
          ${!categories.length ? '<button class="btn btn-secondary btn-sm" id="load-defaults">Load Defaults</button>' : ''}
          <button class="btn btn-primary" id="add-cat-btn">Add Category</button>
        </div>
      </div>

      <div class="card">
        <div class="card-body" id="cat-list"></div>
      </div>
    `;

    const listEl = document.getElementById('cat-list');

    if (!categories.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏷️</div>
          <h3 class="empty-state-title">No categories configured</h3>
          <p class="empty-state-desc">Add expense categories or load defaults to get started.</p>
        </div>`;
    } else {
      listEl.innerHTML = `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Code</th><th>Description</th><th>Spending Limit</th><th>Status</th><th></th></tr></thead>
          <tbody>${categories.map(c => `
            <tr>
              <td style="font-weight:var(--font-weight-medium)">${esc(c.name)}</td>
              <td><span class="badge badge-neutral">${esc(c.code)}</span></td>
              <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(c.description || '—')}</td>
              <td style="font-size:var(--text-sm)">${c.spending_limit ? (org.currency || 'INR') + ' ' + parseFloat(c.spending_limit).toLocaleString() : '—'}</td>
              <td>${c.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
              <td>
                <div style="display:flex;gap:var(--space-1)">
                  <button class="btn btn-ghost btn-sm edit-cat" data-id="${c.id}" title="Edit">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="btn btn-ghost btn-sm delete-cat" data-id="${c.id}" data-name="${esc(c.name)}" title="Delete" style="color:var(--color-error)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </td>
            </tr>
          `).join('')}</tbody>
        </table></div>`;
    }

    document.getElementById('add-cat-btn').addEventListener('click', () => showCategoryModal());

    document.getElementById('load-defaults')?.addEventListener('click', async () => {
      const rows = DEFAULT_CATEGORIES.map(c => ({ ...c, org_id: org.id, is_active: true }));
      const { error } = await sb.from('expense_categories').insert(rows);
      if (error) { toast(error.message); return; }
      toast('Default categories loaded');
      render();
    });

    listEl.querySelectorAll('.edit-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = categories.find(c => c.id === btn.dataset.id);
        if (cat) showCategoryModal(cat);
      });
    });

    listEl.querySelectorAll('.delete-cat').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Delete category "${btn.dataset.name}"?`)) return;
        const { error } = await sb.from('expense_categories').delete().eq('id', btn.dataset.id);
        if (error) { toast(error.message); return; }
        toast('Category deleted');
        render();
      });
    });
  }

  await render();
}
