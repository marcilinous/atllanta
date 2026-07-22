import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate, initials, avColor } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

const ASSET_TYPES = ['Laptop', 'Phone', 'Access Card', 'Monitor', 'Keyboard', 'Mouse', 'Headset', 'Other'];

const typeIcons = {
  Laptop: '💻', Phone: '📱', 'Access Card': '🪪', Monitor: '🖥️',
  Keyboard: '⌨️', Mouse: '🖱️', Headset: '🎧', Other: '📦'
};

function statusBadge(s) {
  const map = { available: 'success', assigned: 'info', maintenance: 'warning', retired: 'neutral' };
  return `<span class="badge badge-${map[s] || 'neutral'}">${esc(s)}</span>`;
}

export default async function assetsView(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const role = membership?.role || 'member';

  if (!['owner', 'admin'].includes(role)) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <h3 class="empty-state-title">Access Denied</h3>
        <p class="empty-state-desc">Asset management is available to admins only.</p>
      </div>`;
    return;
  }

  let filterType = '';
  let filterStatus = '';
  let searchTerm = '';

  async function loadAssets() {
    let q = sb.from('assets')
      .select('*, assignee:assigned_to(id, full_name, email, designation)')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false });
    if (filterType) q = q.eq('type', filterType);
    if (filterStatus) q = q.eq('status', filterStatus);
    const { data, error } = await q;
    if (error) { toast(error.message, 'error'); return []; }
    let results = data || [];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      results = results.filter(a =>
        a.name.toLowerCase().includes(term) ||
        (a.serial_number || '').toLowerCase().includes(term) ||
        (a.assignee?.full_name || '').toLowerCase().includes(term)
      );
    }
    return results;
  }

  async function loadUsers() {
    const { data } = await sb.from('users').select('id, full_name, email, designation')
      .eq('org_id', org.id).eq('status', 'active').order('full_name');
    return data || [];
  }

  function showAddModal(existing) {
    const isEdit = !!existing;
    const title = isEdit ? 'Edit Asset' : 'Add Asset';
    openModal(title, `
      <form id="asset-form" style="display:flex;flex-direction:column;gap:var(--space-3)">
        <div>
          <label class="form-label">Asset Name</label>
          <input class="form-input" name="name" required placeholder="e.g. MacBook Pro 14&quot;" value="${esc(existing?.name || '')}">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <div>
            <label class="form-label">Type</label>
            <select class="form-input" name="type" required>
              ${ASSET_TYPES.map(t => `<option value="${esc(t)}" ${existing?.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Serial Number</label>
            <input class="form-input" name="serial_number" placeholder="Optional" value="${esc(existing?.serial_number || '')}">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <div>
            <label class="form-label">Purchase Date</label>
            <input class="form-input" name="purchase_date" type="date" value="${existing?.purchase_date || ''}">
          </div>
          <div>
            <label class="form-label">Purchase Cost</label>
            <input class="form-input" name="purchase_cost" type="number" step="0.01" min="0" placeholder="0.00" value="${existing?.purchase_cost || ''}">
          </div>
        </div>
        <div>
          <label class="form-label">Warranty End</label>
          <input class="form-input" name="warranty_end" type="date" value="${existing?.warranty_end || ''}">
        </div>
        ${isEdit ? `
        <div>
          <label class="form-label">Status</label>
          <select class="form-input" name="status">
            <option value="available" ${existing.status === 'available' ? 'selected' : ''}>Available</option>
            <option value="maintenance" ${existing.status === 'maintenance' ? 'selected' : ''}>Maintenance</option>
            <option value="retired" ${existing.status === 'retired' ? 'selected' : ''}>Retired</option>
          </select>
        </div>` : ''}
        <div>
          <label class="form-label">Notes</label>
          <textarea class="form-input" name="notes" rows="2" placeholder="Optional">${esc(existing?.notes || '')}</textarea>
        </div>
        <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-2)">
          <button type="button" class="btn btn-secondary" onclick="document.querySelector('.modal-overlay').remove()">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Add Asset'}</button>
        </div>
      </form>
    `);

    document.getElementById('asset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        name: fd.get('name')?.trim(),
        type: fd.get('type'),
        serial_number: fd.get('serial_number')?.trim() || null,
        purchase_date: fd.get('purchase_date') || null,
        purchase_cost: fd.get('purchase_cost') ? parseFloat(fd.get('purchase_cost')) : null,
        warranty_end: fd.get('warranty_end') || null,
        notes: fd.get('notes')?.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (!payload.name) { toast('Name is required'); return; }

      if (isEdit) {
        const statusVal = fd.get('status');
        if (statusVal && existing.status !== 'assigned') payload.status = statusVal;
        const { error } = await sb.from('assets').update(payload).eq('id', existing.id);
        if (error) { toast(error.message); return; }
        toast('Asset updated');
      } else {
        payload.org_id = org.id;
        payload.created_by = user.id;
        payload.status = 'available';
        const { error } = await sb.from('assets').insert(payload);
        if (error) { toast(error.message); return; }
        publishEvent('people.asset.created', { name: payload.name, type: payload.type });
        toast('Asset added');
      }
      closeModal();
      render();
    });
  }

  async function showDetailModal(asset) {
    const [users, { data: history }] = await Promise.all([
      loadUsers(),
      sb.from('asset_assignments')
        .select('*, employee:user_id(full_name), assigner:assigned_by(full_name)')
        .eq('asset_id', asset.id)
        .order('assigned_at', { ascending: false })
    ]);

    const assignmentHistory = history || [];
    const warrantyStatus = asset.warranty_end
      ? (new Date(asset.warranty_end) > new Date() ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-error">Expired</span>')
      : '—';

    openModal(asset.name, `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:var(--space-2) var(--space-4);font-size:var(--text-sm)">
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium)">Type</span>
          <span>${typeIcons[asset.type] || '📦'} ${esc(asset.type)}</span>
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium)">Serial</span>
          <span>${esc(asset.serial_number || '—')}</span>
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium)">Status</span>
          <span>${statusBadge(asset.status)}</span>
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium)">Assigned To</span>
          <span>${asset.assignee ? esc(asset.assignee.full_name) : '—'}</span>
          ${asset.purchase_date ? `
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium)">Purchased</span>
          <span>${formatDate(asset.purchase_date)}${asset.purchase_cost ? ' · ' + (org?.currency || 'INR') + ' ' + parseFloat(asset.purchase_cost).toLocaleString() : ''}</span>` : ''}
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium)">Warranty</span>
          <span>${warrantyStatus}</span>
          ${asset.notes ? `
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium)">Notes</span>
          <span>${esc(asset.notes)}</span>` : ''}
        </div>

        <div style="border-top:1px solid var(--color-border);padding-top:var(--space-3)">
          ${asset.status !== 'assigned' && asset.status !== 'retired' ? `
          <div style="margin-bottom:var(--space-3)">
            <label class="form-label">Assign to Employee</label>
            <select class="form-input" id="assign-user">
              <option value="">— Select —</option>
              ${users.map(u => `<option value="${u.id}">${esc(u.full_name)} (${esc(u.email)})</option>`).join('')}
            </select>
          </div>
          <div style="display:flex;gap:var(--space-2)">
            <button class="btn btn-primary btn-sm" id="assign-btn">Assign</button>
            <button class="btn btn-secondary btn-sm" id="edit-btn">Edit</button>
            <button class="btn btn-ghost btn-sm" id="delete-btn" style="color:var(--color-error)">Delete</button>
          </div>` : asset.status === 'assigned' ? `
          <div style="display:flex;gap:var(--space-2)">
            <button class="btn btn-secondary btn-sm" id="return-btn">Mark Returned</button>
            <button class="btn btn-secondary btn-sm" id="edit-btn">Edit</button>
          </div>` : `
          <div style="display:flex;gap:var(--space-2)">
            <button class="btn btn-secondary btn-sm" id="edit-btn">Edit</button>
            <button class="btn btn-ghost btn-sm" id="delete-btn" style="color:var(--color-error)">Delete</button>
          </div>`}
        </div>

        ${assignmentHistory.length ? `
        <div style="border-top:1px solid var(--color-border);padding-top:var(--space-3)">
          <h4 style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-2)">Assignment History</h4>
          <div style="display:flex;flex-direction:column;gap:var(--space-2);font-size:var(--text-xs)">
            ${assignmentHistory.map(h => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2);background:var(--color-bg-secondary);border-radius:var(--radius-md)">
                <div>
                  <span style="font-weight:var(--font-weight-medium)">${esc(h.employee?.full_name || '—')}</span>
                  ${h.notes ? `<span style="color:var(--color-text-tertiary)"> · ${esc(h.notes)}</span>` : ''}
                </div>
                <div style="color:var(--color-text-tertiary);text-align:right;white-space:nowrap">
                  ${formatDate(h.assigned_at)}${h.returned_at ? ' → ' + formatDate(h.returned_at) : ' → present'}
                </div>
              </div>
            `).join('')}
          </div>
        </div>` : ''}
      </div>
    `);

    document.getElementById('assign-btn')?.addEventListener('click', async () => {
      const uid = document.getElementById('assign-user').value;
      if (!uid) { toast('Select an employee'); return; }
      const { error: e1 } = await sb.from('assets').update({
        status: 'assigned', assigned_to: uid, assigned_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq('id', asset.id);
      if (e1) { toast(e1.message); return; }
      const { error: e2 } = await sb.from('asset_assignments').insert({
        org_id: org.id, asset_id: asset.id, user_id: uid, assigned_by: user.id
      });
      if (e2) console.error(e2);
      const selEl = document.getElementById('assign-user');
      const name = selEl.options[selEl.selectedIndex].textContent.split(' (')[0];
      publishEvent('people.asset.assigned', { asset_id: asset.id, name: asset.name, assigned_to: uid, assigned_name: name });
      toast('Asset assigned to ' + name);
      closeModal();
      render();
    });

    document.getElementById('return-btn')?.addEventListener('click', async () => {
      const { error: e1 } = await sb.from('assets').update({
        status: 'available', assigned_to: null, assigned_at: null, updated_at: new Date().toISOString()
      }).eq('id', asset.id);
      if (e1) { toast(e1.message); return; }
      const { data: openAssignment } = await sb.from('asset_assignments')
        .select('id').eq('asset_id', asset.id).is('returned_at', null)
        .order('assigned_at', { ascending: false }).limit(1).single();
      if (openAssignment) {
        await sb.from('asset_assignments').update({ returned_at: new Date().toISOString() }).eq('id', openAssignment.id);
      }
      publishEvent('people.asset.returned', { asset_id: asset.id, name: asset.name });
      toast('Asset marked as returned');
      closeModal();
      render();
    });

    document.getElementById('edit-btn')?.addEventListener('click', () => {
      closeModal();
      showAddModal(asset);
    });

    document.getElementById('delete-btn')?.addEventListener('click', async () => {
      if (!confirm('Delete this asset? This cannot be undone.')) return;
      const { error } = await sb.from('assets').delete().eq('id', asset.id);
      if (error) { toast(error.message); return; }
      toast('Asset deleted');
      closeModal();
      render();
    });
  }

  async function render() {
    const assets = await loadAssets();
    const total = assets.length;
    const assigned = assets.filter(a => a.status === 'assigned').length;
    const available = assets.filter(a => a.status === 'available').length;
    const maintenance = assets.filter(a => a.status === 'maintenance').length;

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6);flex-wrap:wrap;gap:var(--space-3)">
        <div>
          <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-1)">Asset Management</h1>
          <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0">Track company assets and assignments</p>
        </div>
        <button class="btn btn-primary" id="add-asset-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Asset
        </button>
      </div>

      <div class="stat-grid" style="margin-bottom:var(--space-4)">
        <div class="stat-card"><div class="stat-label">Total Assets</div><div class="stat-value">${total}</div></div>
        <div class="stat-card"><div class="stat-label">Assigned</div><div class="stat-value" style="color:var(--color-info)">${assigned}</div></div>
        <div class="stat-card"><div class="stat-label">Available</div><div class="stat-value" style="color:var(--color-success)">${available}</div></div>
        <div class="stat-card"><div class="stat-label">Maintenance</div><div class="stat-value" style="color:var(--color-warning)">${maintenance}</div></div>
      </div>

      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4);flex-wrap:wrap">
        <input class="form-input form-input-sm" id="asset-search" placeholder="Search assets..." style="max-width:220px" value="${esc(searchTerm)}">
        <select class="form-input form-input-sm" id="asset-type-filter" style="min-width:130px">
          <option value="">All Types</option>
          ${ASSET_TYPES.map(t => `<option value="${esc(t)}" ${filterType === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
        <select class="form-input form-input-sm" id="asset-status-filter" style="min-width:130px">
          <option value="">All Statuses</option>
          <option value="available" ${filterStatus === 'available' ? 'selected' : ''}>Available</option>
          <option value="assigned" ${filterStatus === 'assigned' ? 'selected' : ''}>Assigned</option>
          <option value="maintenance" ${filterStatus === 'maintenance' ? 'selected' : ''}>Maintenance</option>
          <option value="retired" ${filterStatus === 'retired' ? 'selected' : ''}>Retired</option>
        </select>
      </div>

      <div class="card">
        <div class="card-body" id="asset-table"></div>
      </div>
    `;

    const tableEl = document.getElementById('asset-table');

    if (!assets.length) {
      tableEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">💻</div>
          <h3 class="empty-state-title">No assets found</h3>
          <p class="empty-state-desc">${filterType || filterStatus || searchTerm ? 'Try adjusting your filters.' : 'Add an asset to start tracking company equipment.'}</p>
        </div>`;
    } else {
      tableEl.innerHTML = `
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th></th><th>Name</th><th>Type</th><th>Serial Number</th><th>Assigned To</th><th>Status</th><th>Warranty</th>
          </tr></thead>
          <tbody>${assets.map(a => {
            const warrantyOk = a.warranty_end && new Date(a.warranty_end) > new Date();
            const warrantyExpired = a.warranty_end && new Date(a.warranty_end) <= new Date();
            return `
            <tr class="asset-row" data-id="${a.id}" style="cursor:pointer">
              <td style="font-size:var(--text-lg);width:32px">${typeIcons[a.type] || '📦'}</td>
              <td style="font-weight:var(--font-weight-medium)">${esc(a.name)}</td>
              <td style="font-size:var(--text-sm)">${esc(a.type)}</td>
              <td style="font-size:var(--text-sm);color:var(--color-text-tertiary)">${esc(a.serial_number || '—')}</td>
              <td>${a.assignee ? `
                <div style="display:flex;align-items:center;gap:var(--space-2)">
                  <div style="width:24px;height:24px;border-radius:var(--radius-full);background:${avColor(a.assignee.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-size:8px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(a.assignee.full_name)}</div>
                  <span style="font-size:var(--text-sm)">${esc(a.assignee.full_name)}</span>
                </div>` : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>
              <td>${statusBadge(a.status)}</td>
              <td style="font-size:var(--text-xs)">${warrantyOk ? '<span class="badge badge-success">Active</span>' : warrantyExpired ? '<span class="badge badge-error">Expired</span>' : '—'}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table></div>`;
    }

    document.getElementById('add-asset-btn').addEventListener('click', () => showAddModal());

    let searchTimeout;
    document.getElementById('asset-search').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchTerm = e.target.value.trim();
        render();
      }, 300);
    });

    document.getElementById('asset-type-filter').addEventListener('change', (e) => {
      filterType = e.target.value;
      render();
    });

    document.getElementById('asset-status-filter').addEventListener('change', (e) => {
      filterStatus = e.target.value;
      render();
    });

    container.querySelectorAll('.asset-row').forEach(row => {
      row.addEventListener('click', () => {
        const a = assets.find(x => x.id === row.dataset.id);
        if (a) showDetailModal(a);
      });
    });
  }

  await render();
}
