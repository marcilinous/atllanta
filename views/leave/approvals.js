import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate, initials, avColor, timeAgo } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';
import { logAction } from '../../js/audit.js';

export default async function leaveApprovals(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);

  if (!org || !user) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Please log in</div></div>';
    return;
  }

  if (!isManager) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-title">Access Restricted</div>
      <div class="empty-state-desc">Only managers, admins, and owners can view approvals.</div>
    </div>`;
    return;
  }

  let currentView = 'pending';

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Leave Approvals</h1>
        <p class="page-subtitle">Review and manage leave requests from your team</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <a href="#/leave" class="btn btn-secondary btn-sm">Leave Dashboard</a>
        <a href="#/leave/calendar" class="btn btn-secondary btn-sm">Team Calendar</a>
      </div>
    </div>

    <div id="approval-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:var(--space-3);margin-bottom:var(--space-4)">
      <div class="stat-card"><div class="skeleton skeleton-text"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text"></div></div>
    </div>

    <div class="tabs" id="approval-tabs">
      <button class="tab active" data-tab="pending">Pending</button>
      <button class="tab" data-tab="approved">Approved</button>
      <button class="tab" data-tab="rejected">Rejected</button>
      <button class="tab" data-tab="all">All</button>
    </div>
    <div id="approval-content" style="margin-top:var(--space-3)"></div>
  `;

  document.getElementById('approval-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#approval-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentView = tab.dataset.tab;
    renderContent();
  });

  const year = new Date().getFullYear();
  const { data: allRequests, error } = await sb.from('leave_requests')
    .select('*, leave_type:leave_type_id(name, code), requester:user_id(full_name, email, department:department_id(name))')
    .gte('start_date', `${year}-01-01`)
    .order('created_at', { ascending: false });

  if (error) {
    toast('Failed to load requests: ' + error.message);
    return;
  }

  const requests = allRequests || [];
  const pending = requests.filter(r => r.status === 'pending');
  const approved = requests.filter(r => r.status === 'approved');
  const rejected = requests.filter(r => r.status === 'rejected');

  document.getElementById('approval-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-value" style="color:var(--color-warning)">${pending.length}</div>
      <div class="stat-label">Pending</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:var(--color-success)">${approved.length}</div>
      <div class="stat-label">Approved</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:var(--color-error)">${rejected.length}</div>
      <div class="stat-label">Rejected</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${requests.length}</div>
      <div class="stat-label">Total (${year})</div>
    </div>
  `;

  async function renderContent() {
    const el = document.getElementById('approval-content');
    let filtered;
    if (currentView === 'pending') filtered = pending;
    else if (currentView === 'approved') filtered = approved;
    else if (currentView === 'rejected') filtered = rejected;
    else filtered = requests;

    if (!filtered.length) {
      const msgs = {
        pending: { title: 'All caught up', desc: 'No pending leave requests to review.' },
        approved: { title: 'No approved requests', desc: 'No approved leave requests found this year.' },
        rejected: { title: 'No rejected requests', desc: 'No rejected leave requests found this year.' },
        all: { title: 'No requests', desc: 'No leave requests found this year.' },
      };
      el.innerHTML = `<div class="card"><div style="padding:var(--space-6);text-align:center">
        ${currentView === 'pending' ? `<div style="color:var(--color-success);margin-bottom:var(--space-2)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>` : ''}
        <div style="font-weight:var(--font-weight-semibold)">${msgs[currentView].title}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-tertiary);margin-top:var(--space-1)">${msgs[currentView].desc}</div>
      </div></div>`;
      return;
    }

    const isPending = currentView === 'pending';
    const statusColors = { pending: 'warning', approved: 'success', rejected: 'error', cancelled: 'neutral' };

    el.innerHTML = `
      ${isPending && filtered.length > 1 ? `<div id="bulk-approval-bar" style="display:none;padding:var(--space-3) var(--space-4);background:var(--color-accent-light);border-radius:var(--radius-md);margin-bottom:var(--space-3);display:none;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)" id="bulk-sel-count">0 selected</span>
        <button class="btn btn-primary btn-sm" id="bulk-approve-btn">Approve Selected</button>
        <button class="btn btn-secondary btn-sm" id="bulk-reject-btn">Reject Selected</button>
        <button class="btn btn-ghost btn-sm" id="bulk-clear-btn">Clear</button>
      </div>` : ''}
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr>
          ${isPending && filtered.length > 1 ? '<th style="width:36px"><input type="checkbox" id="sel-all-approvals"></th>' : ''}
          <th>Employee</th>
          <th>Department</th>
          <th>Type</th>
          <th>From</th>
          <th>To</th>
          <th>Days</th>
          <th>Reason</th>
          ${isPending ? '<th>Waiting</th>' : ''}
          ${isPending ? '<th>Actions</th>' : '<th>Status</th>'}
          ${!isPending ? '<th>Reviewed</th>' : ''}
        </tr></thead>
        <tbody>${filtered.map(r => {
          const waitDays = isPending ? Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000) : 0;
          const waitColor = waitDays >= 5 ? 'var(--color-error)' : waitDays >= 2 ? 'var(--color-warning)' : 'var(--color-text-tertiary)';
          return `<tr>
            ${isPending && filtered.length > 1 ? `<td><input type="checkbox" class="leave-check" data-id="${r.id}" data-uid="${r.user_id}" data-ltid="${r.leave_type_id}" data-days="${r.days}"></td>` : ''}
            <td>
              <div style="display:flex;align-items:center;gap:var(--space-2)">
                <div style="width:28px;height:28px;border-radius:var(--radius-full);background:${avColor(r.requester?.full_name || '')};display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(r.requester?.full_name || r.requester?.email || '?')}</div>
                <span style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(r.requester?.full_name || r.requester?.email || '—')}</span>
              </div>
            </td>
            <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(r.requester?.department?.name || '—')}</td>
            <td><span class="badge badge-neutral">${esc(r.leave_type?.code || '—')}</span></td>
            <td style="font-size:var(--text-sm)">${formatDate(r.start_date)}</td>
            <td style="font-size:var(--text-sm)">${formatDate(r.end_date)}</td>
            <td style="font-weight:var(--font-weight-semibold)">${r.days}</td>
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-sm)" title="${esc(r.reason || '')}">${esc(r.reason || '—')}</td>
            ${isPending ? `<td style="font-size:var(--text-xs);color:${waitColor};font-weight:var(--font-weight-medium);white-space:nowrap">${waitDays === 0 ? 'Today' : waitDays + 'd ago'}</td>` : ''}
            ${isPending ? `<td>
              <div style="display:flex;gap:var(--space-1)">
                <button class="btn btn-primary btn-sm" data-approve="${r.id}" data-uid="${r.user_id}" data-ltid="${r.leave_type_id}" data-days="${r.days}">Approve</button>
                <button class="btn btn-secondary btn-sm" data-reject="${r.id}" data-uid="${r.user_id}">Reject</button>
              </div>
            </td>` : `<td><span class="badge badge-${statusColors[r.status] || 'neutral'}"><span class="badge-dot"></span>${r.status}</span></td>`}
            ${!isPending ? `<td style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${r.reviewed_at ? formatDate(r.reviewed_at) : '—'}${r.review_comment ? `<div title="${esc(r.review_comment)}" style="cursor:help">Note</div>` : ''}</td>` : ''}
          </tr>`;
        }).join('')}</tbody>
      </table></div></div>`;

    if (isPending) {
      el.querySelectorAll('[data-approve]').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = '...';
          const id = btn.dataset.approve;
          const { error } = await sb.from('leave_requests').update({
            status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
          }).eq('id', id);
          if (error) { toast(error.message); btn.disabled = false; btn.textContent = 'Approve'; return; }
          await logAction('leave', 'leave_request', id, 'approved', { status: 'pending' }, { status: 'approved' });
          await publishEvent('leave.request.approved', { leave_request_id: id, user_id: btn.dataset.uid, org_id: org.id, days: btn.dataset.days, leave_type_id: btn.dataset.ltid, approved_by: user.id });
          toast('Leave approved');
          reloadAndRender();
        });
      });

      el.querySelectorAll('[data-reject]').forEach(btn => {
        btn.addEventListener('click', () => {
          const f = document.createElement('div');
          f.innerHTML = `<div style="display:grid;gap:var(--space-3)">
            <div class="form-group"><label class="form-label">Rejection Reason</label><textarea class="form-input" id="rej-reason" rows="3" placeholder="Optional reason for the employee..."></textarea></div>
            <button class="btn" id="rej-confirm" style="background:var(--color-error);color:white;border:none">Reject Leave</button>
          </div>`;
          openModal('Reject Leave Request', f);
          f.querySelector('#rej-confirm').addEventListener('click', async () => {
            const comment = f.querySelector('#rej-reason').value || null;
            const { error } = await sb.from('leave_requests').update({
              status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
              review_comment: comment,
            }).eq('id', btn.dataset.reject);
            closeModal();
            if (error) return toast(error.message);
            await logAction('leave', 'leave_request', btn.dataset.reject, 'rejected', { status: 'pending' }, { status: 'rejected', review_comment: comment });
            await publishEvent('leave.request.rejected', { leave_request_id: btn.dataset.reject, user_id: btn.dataset.uid, org_id: org.id });
            toast('Leave rejected');
            reloadAndRender();
          });
        });
      });

      if (filtered.length > 1) {
        const bulkBar = document.getElementById('bulk-approval-bar');
        const selAll = document.getElementById('sel-all-approvals');
        const checks = el.querySelectorAll('.leave-check');

        function getChecked() { return [...el.querySelectorAll('.leave-check:checked')]; }
        function updateBar() {
          const sel = getChecked();
          if (bulkBar) bulkBar.style.display = sel.length ? 'flex' : 'none';
          const cnt = document.getElementById('bulk-sel-count');
          if (cnt) cnt.textContent = `${sel.length} selected`;
        }

        checks.forEach(c => c.addEventListener('change', updateBar));
        if (selAll) selAll.addEventListener('change', () => {
          checks.forEach(c => { c.checked = selAll.checked; });
          updateBar();
        });

        document.getElementById('bulk-approve-btn')?.addEventListener('click', async () => {
          const sel = getChecked();
          if (!sel.length) return;
          if (!confirm(`Approve ${sel.length} leave request${sel.length > 1 ? 's' : ''}?`)) return;
          for (const c of sel) {
            await sb.from('leave_requests').update({
              status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
            }).eq('id', c.dataset.id);
            await logAction('leave', 'leave_request', c.dataset.id, 'approved', { status: 'pending' }, { status: 'approved' });
            await publishEvent('leave.request.approved', { leave_request_id: c.dataset.id, user_id: c.dataset.uid, org_id: org.id, days: c.dataset.days, leave_type_id: c.dataset.ltid, approved_by: user.id });
          }
          toast(`${sel.length} request${sel.length > 1 ? 's' : ''} approved`);
          reloadAndRender();
        });

        document.getElementById('bulk-reject-btn')?.addEventListener('click', () => {
          const sel = getChecked();
          if (!sel.length) return;
          const f = document.createElement('div');
          f.innerHTML = `<div style="display:grid;gap:var(--space-3)">
            <p style="font-size:var(--text-sm);color:var(--color-text-secondary)">Rejecting ${sel.length} leave request${sel.length > 1 ? 's' : ''}.</p>
            <div class="form-group"><label class="form-label">Rejection Reason</label><textarea class="form-input" id="bulk-rej-reason" rows="3" placeholder="Optional reason..."></textarea></div>
            <button class="btn" id="bulk-rej-confirm" style="background:var(--color-error);color:white;border:none">Reject ${sel.length} Request${sel.length > 1 ? 's' : ''}</button>
          </div>`;
          openModal('Bulk Reject', f);
          f.querySelector('#bulk-rej-confirm').addEventListener('click', async () => {
            const comment = f.querySelector('#bulk-rej-reason').value || null;
            for (const c of sel) {
              await sb.from('leave_requests').update({
                status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
                review_comment: comment,
              }).eq('id', c.dataset.id);
              await logAction('leave', 'leave_request', c.dataset.id, 'rejected', { status: 'pending' }, { status: 'rejected' });
              await publishEvent('leave.request.rejected', { leave_request_id: c.dataset.id, user_id: c.dataset.uid, org_id: org.id });
            }
            closeModal();
            toast(`${sel.length} request${sel.length > 1 ? 's' : ''} rejected`);
            reloadAndRender();
          });
        });

        document.getElementById('bulk-clear-btn')?.addEventListener('click', () => {
          checks.forEach(c => { c.checked = false; });
          if (selAll) selAll.checked = false;
          updateBar();
        });
      }
    }
  }

  async function reloadAndRender() {
    const { data, error: reloadErr } = await sb.from('leave_requests')
      .select('*, leave_type:leave_type_id(name, code), requester:user_id(full_name, email, department:department_id(name))')
      .gte('start_date', `${year}-01-01`)
      .order('created_at', { ascending: false });
    if (reloadErr) { console.error(reloadErr); }
    requests.length = 0;
    (data || []).forEach(r => requests.push(r));
    pending.length = 0;
    approved.length = 0;
    rejected.length = 0;
    requests.forEach(r => {
      if (r.status === 'pending') pending.push(r);
      else if (r.status === 'approved') approved.push(r);
      else if (r.status === 'rejected') rejected.push(r);
    });

    document.getElementById('approval-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-value" style="color:var(--color-warning)">${pending.length}</div>
        <div class="stat-label">Pending</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--color-success)">${approved.length}</div>
        <div class="stat-label">Approved</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--color-error)">${rejected.length}</div>
        <div class="stat-label">Rejected</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${requests.length}</div>
        <div class="stat-label">Total (${year})</div>
      </div>
    `;
    renderContent();
  }

  renderContent();
}
