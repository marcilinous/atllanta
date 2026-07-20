import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc } from '../../js/ui.js';

export default async function auditLog(container) {
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin', 'super_admin'].includes(membership.role);

  if (!isAdmin) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Access Denied</div><div class="empty-state-desc">Only admins can view the audit log.</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Audit Log</h1>
      <p class="page-subtitle">Track all actions across the platform</p>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        <select class="form-input" id="audit-module" style="max-width:160px;height:34px">
          <option value="">All modules</option>
          <option value="people">People</option>
          <option value="attendance">Attendance</option>
          <option value="leave">Leave</option>
          <option value="recruitment">Recruitment</option>
          <option value="settings">Settings</option>
        </select>
        <select class="form-input" id="audit-action" style="max-width:140px;height:34px">
          <option value="">All actions</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
          <option value="deleted">Deleted</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <input type="date" class="form-input" id="audit-from" style="max-width:160px;height:34px">
        <input type="date" class="form-input" id="audit-to" style="max-width:160px;height:34px">
        <button class="btn btn-secondary btn-sm" id="audit-filter">Filter</button>
      </div>
      <div id="audit-list"></div>
    </div>
    <div style="display:flex;justify-content:center;gap:var(--space-3);margin-top:var(--space-4)" id="audit-pagination"></div>
  `;

  if (!org) return;

  let page = 0;
  const pageSize = 25;

  async function loadLogs() {
    const moduleFilter = document.getElementById('audit-module').value;
    const actionFilter = document.getElementById('audit-action').value;
    const fromDate = document.getElementById('audit-from').value;
    const toDate = document.getElementById('audit-to').value;

    let query = sb.from('audit_logs')
      .select('*, actor:user_id(full_name, email)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (moduleFilter) query = query.eq('module', moduleFilter);
    if (actionFilter) query = query.eq('action', actionFilter);
    if (fromDate) query = query.gte('created_at', fromDate + 'T00:00:00');
    if (toDate) query = query.lte('created_at', toDate + 'T23:59:59');

    const { data: logs, count } = await query;

    const listEl = document.getElementById('audit-list');
    if (!logs?.length) {
      listEl.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No audit logs found</div>`;
      document.getElementById('audit-pagination').innerHTML = '';
      return;
    }

    const actionColors = { created: 'success', updated: 'info', deleted: 'error', approved: 'success', rejected: 'error' };

    listEl.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Time</th><th>User</th><th>Module</th><th>Entity</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>${logs.map(l => `<tr>
        <td style="white-space:nowrap;font-size:var(--text-xs);color:var(--color-text-secondary)">${new Date(l.created_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td>${esc(l.actor?.full_name || l.actor?.email || '—')}</td>
        <td><span class="badge badge-neutral">${esc(l.module)}</span></td>
        <td style="font-size:var(--text-sm)">${esc(l.entity_type)}</td>
        <td><span class="badge badge-${actionColors[l.action] || 'neutral'}"><span class="badge-dot"></span>${esc(l.action)}</span></td>
        <td style="max-width:200px;font-size:var(--text-xs);color:var(--color-text-secondary);overflow:hidden;text-overflow:ellipsis">${l.new_values ? esc(JSON.stringify(l.new_values).slice(0, 80)) : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;

    const totalPages = Math.ceil((count || 0) / pageSize);
    const pagEl = document.getElementById('audit-pagination');
    if (totalPages > 1) {
      pagEl.innerHTML = `
        <button class="btn btn-ghost btn-sm" ${page === 0 ? 'disabled' : ''} id="audit-prev">Previous</button>
        <span style="font-size:var(--text-sm);color:var(--color-text-secondary);line-height:30px">Page ${page + 1} of ${totalPages}</span>
        <button class="btn btn-ghost btn-sm" ${page >= totalPages - 1 ? 'disabled' : ''} id="audit-next">Next</button>
      `;
      document.getElementById('audit-prev')?.addEventListener('click', () => { page--; loadLogs(); });
      document.getElementById('audit-next')?.addEventListener('click', () => { page++; loadLogs(); });
    } else {
      pagEl.innerHTML = '';
    }
  }

  document.getElementById('audit-filter').addEventListener('click', () => { page = 0; loadLogs(); });
  loadLogs();
}
