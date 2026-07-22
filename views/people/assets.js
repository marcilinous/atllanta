import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

const ASSET_TYPES = ['Laptop', 'Phone', 'Access Card', 'Monitor', 'Other'];
const ASSET_STATUSES = ['available', 'assigned', 'maintenance', 'retired'];

function statusBadge(s) {
  const map = { available: 'success', assigned: 'info', maintenance: 'warning', retired: 'neutral' };
  return `<span class="badge badge-${map[s] || 'neutral'}">${esc(s)}</span>`;
}

function buildAssets(events) {
  const map = {};
  for (const ev of events) {
    const aid = ev.payload?.asset_id;
    if (!aid) continue;
    if (!map[aid]) {
      map[aid] = {
        asset_id: aid,
        name: ev.payload.name || '',
        type: ev.payload.type || 'Other',
        serial_number: ev.payload.serial_number || '',
        purchase_date: ev.payload.purchase_date || null,
        notes: ev.payload.notes || '',
        status: ev.payload.status || 'available',
        assigned_to: ev.payload.assigned_to || null,
        assigned_name: ev.payload.assigned_name || '',
        created_at: ev.created_at
      };
    }
    if (ev.event_type === 'people.asset.assigned') {
      map[aid].status = 'assigned';
      map[aid].assigned_to = ev.payload.assigned_to || null;
      map[aid].assigned_name = ev.payload.assigned_name || '';
    } else if (ev.event_type === 'people.asset.returned') {
      map[aid].status = 'available';
      map[aid].assigned_to = null;
      map[aid].assigned_name = '';
    }
    if (ev.payload.status && ev.event_type !== 'people.asset.assigned' && ev.event_type !== 'people.asset.returned') {
      map[aid].status = ev.payload.status;
    }
    if (ev.payload.name) map[aid].name = ev.payload.name;
    if (ev.payload.type) map[aid].type = ev.payload.type;
    if (ev.payload.serial_number) map[aid].serial_number = ev.payload.serial_number;
  }
  return Object.values(map).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export default async function assetsView(container) {
  const user = await getUser();
  const org = await getOrg();
  const membership = await getMembership();
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

  async function loadEvents() {
    const { data, error } = await sb
      .from('events')
      .select('*')
      .like('event_type', 'people.asset.%')
      .order('created_at', { ascending: true });
    if (error) { toast(error.message, 'error'); return []; }
    return data || [];
  }

  async function loadUsers() {
    const { data, error } = await sb
      .from('users')
      .select('id, full_name, email')
      .eq('status', 'active')
      .order('full_name');
    if (error) { toast(error.message, 'error'); return []; }
    return data || [];
  }

  function showAddModal() {
    const html = `
      <form id="add-asset-form">
        <div class="form-group">
          <label class="form-label">Asset Name</label>
          <input class="form-input" name="name" required placeholder="e.g. MacBook Pro 14&quot;">
        </div>
        <div class="form-group">
          <label class="form-label">Type</label>
          <select class="form-input" name="type" required>
            ${ASSET_TYPES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Serial Number</label>
          <input class="form-input" name="serial_number" placeholder="Optional">
        </div>
        <div class="form-group">
          <label class="form-label">Purchase Date</label>
          <input class="form-input" name="purchase_date" type="date">
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-input" name="notes" rows="3" placeholder="Optional notes"></textarea>
        </div>
        <div style="display:flex;gap:var(--space-3);justify-content:flex-end;margin-top:var(--space-4);">
          <button type="button" class="btn btn-secondary" id="cancel-asset">Cancel</button>
          <button type="submit" class="btn btn-primary">Add Asset</button>
        </div>
      </form>`;
    openModal('Add Asset', html);

    document.getElementById('cancel-asset').addEventListener('click', closeModal);
    document.getElementById('add-asset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await publishEvent('people.asset.created', {
        asset_id: crypto.randomUUID(),
        name: fd.get('name'),
        type: fd.get('type'),
        serial_number: fd.get('serial_number') || '',
        purchase_date: fd.get('purchase_date') || null,
        notes: fd.get('notes') || '',
        status: 'available'
      });
      toast('Asset added');
      closeModal();
      await render();
    });
  }

  async function showDetailModal(asset) {
    const users = await loadUsers();
    const html = `
      <div style="display:flex;flex-direction:column;gap:var(--space-4);">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:var(--space-2) var(--space-4);font-size:var(--text-sm);">
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium);">Type</span>
          <span style="color:var(--color-text-primary);">${esc(asset.type)}</span>
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium);">Serial</span>
          <span style="color:var(--color-text-primary);">${esc(asset.serial_number || '--')}</span>
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium);">Status</span>
          <span>${statusBadge(asset.status)}</span>
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium);">Assigned To</span>
          <span style="color:var(--color-text-primary);">${esc(asset.assigned_name || 'Unassigned')}</span>
          ${asset.purchase_date ? `
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium);">Purchased</span>
          <span style="color:var(--color-text-primary);">${formatDate(asset.purchase_date)}</span>` : ''}
          ${asset.notes ? `
          <span style="color:var(--color-text-secondary);font-weight:var(--font-weight-medium);">Notes</span>
          <span style="color:var(--color-text-primary);">${esc(asset.notes)}</span>` : ''}
        </div>
        <div style="border-top:1px solid var(--color-border);padding-top:var(--space-4);">
          ${asset.status !== 'assigned' ? `
          <div class="form-group">
            <label class="form-label">Assign to Employee</label>
            <select class="form-input" id="assign-user">
              <option value="">-- Select --</option>
              ${users.map(u => `<option value="${u.id}" data-name="${esc(u.full_name)}">${esc(u.full_name)} (${esc(u.email)})</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary btn-sm" id="assign-btn">Assign</button>` : `
          <button class="btn btn-secondary btn-sm" id="return-btn">Mark Returned</button>`}
        </div>
      </div>`;
    openModal(asset.name, html);

    const assignBtn = document.getElementById('assign-btn');
    const returnBtn = document.getElementById('return-btn');

    if (assignBtn) {
      assignBtn.addEventListener('click', async () => {
        const sel = document.getElementById('assign-user');
        if (!sel.value) { toast('Select an employee', 'error'); return; }
        const assignedName = sel.options[sel.selectedIndex].dataset.name;
        await publishEvent('people.asset.assigned', {
          asset_id: asset.asset_id,
          name: asset.name,
          type: asset.type,
          assigned_to: sel.value,
          assigned_name: assignedName
        });
        toast('Asset assigned to ' + assignedName);
        closeModal();
        await render();
      });
    }
    if (returnBtn) {
      returnBtn.addEventListener('click', async () => {
        await publishEvent('people.asset.returned', {
          asset_id: asset.asset_id,
          name: asset.name,
          type: asset.type
        });
        toast('Asset marked as returned');
        closeModal();
        await render();
      });
    }
  }

  async function render() {
    const events = await loadEvents();
    const assets = buildAssets(events);

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6);flex-wrap:wrap;gap:var(--space-3);">
        <div>
          <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);color:var(--color-text-primary);margin:0 0 var(--space-1);">Asset Management</h1>
          <p style="font-size:var(--text-base);color:var(--color-text-secondary);margin:0;">Track company assets and assignments</p>
        </div>
        <button class="btn btn-primary" id="add-asset-btn">Add Asset</button>
      </div>
      <div id="asset-table"></div>`;

    const tableEl = container.querySelector('#asset-table');

    if (!assets.length) {
      tableEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">💻</div>
          <h3 class="empty-state-title">No assets tracked</h3>
          <p class="empty-state-desc">Add an asset to start tracking company equipment.</p>
        </div>`;
    } else {
      tableEl.innerHTML = `
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Name</th><th>Type</th><th>Serial Number</th><th>Assigned To</th><th>Status</th>
          </tr></thead>
          <tbody>${assets.map(a => `
            <tr class="asset-row" data-aid="${esc(a.asset_id)}" style="cursor:pointer;">
              <td style="font-weight:var(--font-weight-medium);color:var(--color-text-primary);">${esc(a.name)}</td>
              <td>${esc(a.type)}</td>
              <td>${esc(a.serial_number || '--')}</td>
              <td>${esc(a.assigned_name || '--')}</td>
              <td>${statusBadge(a.status)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`;
    }

    container.querySelector('#add-asset-btn').addEventListener('click', showAddModal);

    container.querySelectorAll('.asset-row').forEach(row => {
      row.addEventListener('click', () => {
        const a = assets.find(x => x.asset_id === row.dataset.aid);
        if (a) showDetailModal(a);
      });
    });
  }

  await render();
}
