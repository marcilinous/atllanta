import sb from '../js/supabase.js';
import { getUser, getOrg, getMembership } from '../js/auth.js';
import { esc, toast, formatDate, initials, avColor, openModal, closeModal, timeAgo } from '../js/ui.js';
import { logAction } from '../js/audit.js';
import { publishEvent } from '../js/events.js';

export default async function inboxView(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const role = membership?.role || 'member';
  const isManager = ['owner', 'admin', 'manager'].includes(role);
  const isAdmin = ['owner', 'admin'].includes(role);

  if (!org) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No organization found</div></div>';
    return;
  }

  let currentTab = 'leave';
  let showHistory = false;

  const [{ count: lc }, { count: rc }] = await Promise.all([
    sb.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('attendance_regularizations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);

  let leaveCount = lc ?? 0;
  let regCount = rc ?? 0;
  let ticketCount = 0;

  const { data: ticketEvents } = await sb
    .from('events')
    .select('payload')
    .like('event_type', 'helpdesk.ticket.%')
    .order('created_at', { ascending: false });

  if (ticketEvents) {
    const tmap = {};
    for (const ev of ticketEvents) {
      const tid = ev.payload?.ticket_id;
      if (!tid) continue;
      if (!tmap[tid]) tmap[tid] = ev.payload.status || 'open';
      if (ev.payload.status) tmap[tid] = ev.payload.status;
    }
    ticketCount = Object.values(tmap).filter(s => s === 'open').length;
  }

  const totalPending = leaveCount + regCount + ticketCount;

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Inbox${totalPending > 0 ? ` <span class="badge badge-error" style="font-size:var(--text-xs);vertical-align:middle;padding:2px 8px">${totalPending}</span>` : ''}</h1>
        <p class="page-subtitle">Approvals, tickets, and requests — all in one place</p>
      </div>
      <div style="display:flex;gap:var(--space-2);align-items:center">
        <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);color:var(--color-text-secondary);cursor:pointer">
          <input type="checkbox" id="show-history"> Show history
        </label>
      </div>
    </div>
    <div class="tabs" id="inbox-tabs">
      <button class="tab active" data-tab="leave">Leave Requests${leaveCount ? ` <span class="badge badge-error" style="margin-left:var(--space-1);font-size:10px;padding:1px 6px">${leaveCount}</span>` : ''}</button>
      <button class="tab" data-tab="regularization">Regularization${regCount ? ` <span class="badge badge-error" style="margin-left:var(--space-1);font-size:10px;padding:1px 6px">${regCount}</span>` : ''}</button>
      <button class="tab" data-tab="helpdesk">Helpdesk${ticketCount ? ` <span class="badge badge-error" style="margin-left:var(--space-1);font-size:10px;padding:1px 6px">${ticketCount}</span>` : ''}</button>
    </div>
    <div id="inbox-content" style="margin-top:var(--space-4)">
      <div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>
    </div>
  `;

  document.getElementById('inbox-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#inbox-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderTab();
  });

  document.getElementById('show-history').addEventListener('change', (e) => {
    showHistory = e.target.checked;
    renderTab();
  });

  const content = document.getElementById('inbox-content');

  async function renderTab() {
    content.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>';
    if (currentTab === 'leave') await renderLeaveApprovals();
    else if (currentTab === 'regularization') await renderRegularizations();
    else if (currentTab === 'helpdesk') await renderHelpdesk();
  }

  function pendingDuration(createdAt) {
    if (!createdAt) return '';
    const hours = (Date.now() - new Date(createdAt).getTime()) / 3600000;
    const color = hours > 48 ? 'var(--color-error)' : hours > 24 ? 'var(--color-warning)' : 'var(--color-text-tertiary)';
    return `<span style="font-size:10px;color:${color}" title="Pending since ${new Date(createdAt).toLocaleString()}">${timeAgo(createdAt)}</span>`;
  }

  async function renderLeaveApprovals() {
    let query = sb
      .from('leave_requests')
      .select('*, requester:user_id(full_name, email), leave_type:leave_type_id(name, code)')
      .order('created_at', { ascending: false });

    if (showHistory) {
      query = query.in('status', ['pending', 'approved', 'rejected']);
    } else {
      query = query.eq('status', 'pending');
    }

    const { data: requests, error } = await query.limit(50);

    if (error) {
      content.innerHTML = `<div class="card"><div class="card-body" style="color:var(--color-error)">Failed to load: ${esc(error.message)}</div></div>`;
      return;
    }

    const pending = (requests || []).filter(r => r.status === 'pending');

    if (!requests?.length) {
      content.innerHTML = `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
        <div class="empty-state-title">All caught up</div>
        <div class="empty-state-desc">No ${showHistory ? '' : 'pending '}leave requests to review.</div>
      </div></div>`;
      return;
    }

    const statusColors = { pending: 'warning', approved: 'success', rejected: 'error', cancelled: 'neutral' };

    content.innerHTML = `<div class="card">
      ${pending.length > 1 ? `<div style="padding:var(--space-2) var(--space-4);background:var(--color-accent-light);border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">${pending.length} pending</span>
        <button class="btn btn-primary btn-sm" id="bulk-approve-leave">Approve All (${pending.length})</button>
      </div>` : ''}
      <div class="table-wrap"><table class="table">
      <thead><tr><th>Employee</th><th>Leave Type</th><th>Period</th><th>Days</th><th>Reason</th>${showHistory ? '<th>Status</th>' : '<th>Pending</th>'}<th>Actions</th></tr></thead>
      <tbody>${requests.map(r => `<tr>
        <td>
          <div style="display:flex;align-items:center;gap:var(--space-2)">
            <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${avColor(r.requester?.full_name || '')};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(r.requester?.full_name || r.requester?.email || '?')}</div>
            <div>
              <div style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(r.requester?.full_name || r.requester?.email || '—')}</div>
            </div>
          </div>
        </td>
        <td><span class="badge badge-neutral">${esc(r.leave_type?.code || '—')}</span></td>
        <td style="font-size:var(--text-sm)">${formatDate(r.start_date)} – ${formatDate(r.end_date)}</td>
        <td>${r.days}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-sm)">${esc(r.reason || '—')}</td>
        ${showHistory
          ? `<td><span class="badge badge-${statusColors[r.status] || 'neutral'}"><span class="badge-dot"></span>${esc(r.status)}</span>${r.reviewed_at ? `<div style="font-size:10px;color:var(--color-text-tertiary)">${timeAgo(r.reviewed_at)}</div>` : ''}</td>`
          : `<td>${pendingDuration(r.created_at)}</td>`
        }
        <td>
          ${r.status === 'pending' ? `<div style="display:flex;gap:var(--space-1)">
            <button class="btn btn-primary btn-sm" data-action="approve-leave" data-id="${r.id}" data-uid="${r.user_id}" data-ltid="${r.leave_type_id}" data-days="${r.days}">Approve</button>
            <button class="btn btn-secondary btn-sm" data-action="reject-leave" data-id="${r.id}" data-uid="${r.user_id}">Reject</button>
          </div>` : `${r.review_comment ? `<span style="font-size:var(--text-xs);color:var(--color-text-tertiary)" title="${esc(r.review_comment)}">Note</span>` : '—'}`}
        </td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;

    document.getElementById('bulk-approve-leave')?.addEventListener('click', async () => {
      const btn = document.getElementById('bulk-approve-leave');
      btn.disabled = true;
      btn.textContent = 'Approving...';
      for (const r of pending) {
        await sb.from('leave_requests').update({
          status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString()
        }).eq('id', r.id);
        await logAction('leave', 'leave_request', r.id, 'approved', { status: 'pending' }, { status: 'approved' });
        await publishEvent('leave.request.approved', {
          leave_request_id: r.id, user_id: r.user_id, org_id: org.id,
          days: r.days, leave_type_id: r.leave_type_id, approved_by: user.id
        });
      }
      toast(`${pending.length} leave request${pending.length > 1 ? 's' : ''} approved`);
      updateTabCounts();
      renderLeaveApprovals();
    });

    content.querySelectorAll('[data-action="approve-leave"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const { error } = await sb.from('leave_requests').update({
          status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString()
        }).eq('id', btn.dataset.id);
        if (error) { toast(error.message); btn.disabled = false; return; }
        await logAction('leave', 'leave_request', btn.dataset.id, 'approved', { status: 'pending' }, { status: 'approved' });
        await publishEvent('leave.request.approved', { leave_request_id: btn.dataset.id, user_id: btn.dataset.uid, org_id: org.id, days: btn.dataset.days, leave_type_id: btn.dataset.ltid, approved_by: user.id });
        toast('Leave approved');
        updateTabCounts();
        renderLeaveApprovals();
      });
    });

    content.querySelectorAll('[data-action="reject-leave"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = document.createElement('div');
        f.innerHTML = `
          <div style="display:grid;gap:var(--space-3)">
            <div class="form-group"><label class="form-label">Rejection Reason</label><textarea class="form-input" id="reject-reason" rows="3" placeholder="Optional reason..."></textarea></div>
            <button class="btn btn-primary" id="confirm-reject">Reject Leave</button>
          </div>`;
        openModal('Reject Leave Request', f);
        f.querySelector('#confirm-reject').addEventListener('click', async () => {
          const reason = f.querySelector('#reject-reason').value;
          const { error } = await sb.from('leave_requests').update({
            status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
            review_comment: reason || null
          }).eq('id', btn.dataset.id);
          closeModal();
          if (error) return toast(error.message);
          await logAction('leave', 'leave_request', btn.dataset.id, 'rejected', { status: 'pending' }, { status: 'rejected', review_comment: reason || null });
          await publishEvent('leave.request.rejected', { leave_request_id: btn.dataset.id, user_id: btn.dataset.uid || null, org_id: org.id });
          toast('Leave rejected');
          updateTabCounts();
          renderLeaveApprovals();
        });
      });
    });
  }

  async function renderRegularizations() {
    let query = sb
      .from('attendance_regularizations')
      .select('*, requester:user_id(full_name, email), attendance:attendance_id(date, check_in, check_out, status)')
      .order('created_at', { ascending: false });

    if (showHistory) {
      query = query.in('status', ['pending', 'approved', 'rejected']);
    } else {
      query = query.eq('status', 'pending');
    }

    const { data: regs, error } = await query.limit(50);

    if (error) {
      content.innerHTML = `<div class="card"><div class="card-body" style="color:var(--color-error)">Failed to load: ${esc(error.message)}</div></div>`;
      return;
    }

    const pending = (regs || []).filter(r => r.status === 'pending');

    if (!regs?.length) {
      content.innerHTML = `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
        <div class="empty-state-title">All caught up</div>
        <div class="empty-state-desc">No ${showHistory ? '' : 'pending '}regularization requests.</div>
      </div></div>`;
      return;
    }

    const statusColors = { pending: 'warning', approved: 'success', rejected: 'error' };

    content.innerHTML = `<div class="card">
      ${pending.length > 1 ? `<div style="padding:var(--space-2) var(--space-4);background:var(--color-accent-light);border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:var(--space-3)">
        <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">${pending.length} pending</span>
        <button class="btn btn-primary btn-sm" id="bulk-approve-reg">Approve All (${pending.length})</button>
      </div>` : ''}
      <div class="table-wrap"><table class="table">
      <thead><tr><th>Employee</th><th>Date</th><th>Original</th><th>Requested</th><th>Reason</th>${showHistory ? '<th>Status</th>' : '<th>Pending</th>'}<th>Actions</th></tr></thead>
      <tbody>${regs.map(r => {
        const origIn = r.attendance?.check_in ? new Date(r.attendance.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
        const origOut = r.attendance?.check_out ? new Date(r.attendance.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
        const reqIn = r.requested_check_in ? new Date(r.requested_check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
        const reqOut = r.requested_check_out ? new Date(r.requested_check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
        return `<tr>
          <td>
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${avColor(r.requester?.full_name || '')};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(r.requester?.full_name || '?')}</div>
              <span style="font-size:var(--text-sm)">${esc(r.requester?.full_name || r.requester?.email || '—')}</span>
            </div>
          </td>
          <td>${formatDate(r.attendance?.date)}</td>
          <td style="font-size:var(--text-sm)">${origIn} – ${origOut}</td>
          <td style="font-size:var(--text-sm);color:var(--color-accent)">${reqIn} – ${reqOut}</td>
          <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-sm)">${esc(r.reason || '—')}</td>
          ${showHistory
            ? `<td><span class="badge badge-${statusColors[r.status] || 'neutral'}"><span class="badge-dot"></span>${esc(r.status)}</span></td>`
            : `<td>${pendingDuration(r.created_at)}</td>`
          }
          <td>
            ${r.status === 'pending' ? `<div style="display:flex;gap:var(--space-1)">
              <button class="btn btn-primary btn-sm" data-action="approve-reg" data-id="${r.id}" data-uid="${r.user_id}" data-att-id="${r.attendance_id}" data-req-in="${r.requested_check_in || ''}" data-req-out="${r.requested_check_out || ''}">Approve</button>
              <button class="btn btn-secondary btn-sm" data-action="reject-reg" data-id="${r.id}" data-uid="${r.user_id}">Reject</button>
            </div>` : '—'}
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div></div>`;

    document.getElementById('bulk-approve-reg')?.addEventListener('click', async () => {
      const btn = document.getElementById('bulk-approve-reg');
      btn.disabled = true;
      btn.textContent = 'Approving...';
      for (const r of pending) {
        await sb.from('attendance_regularizations').update({
          status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString()
        }).eq('id', r.id);
        const attUpdate = {};
        if (r.requested_check_in) attUpdate.check_in = r.requested_check_in;
        if (r.requested_check_out) attUpdate.check_out = r.requested_check_out;
        if (Object.keys(attUpdate).length) {
          attUpdate.status = 'present';
          await sb.from('attendance').update(attUpdate).eq('id', r.attendance_id);
        }
        await logAction('attendance', 'regularization', r.id, 'approved', { status: 'pending' }, { status: 'approved' });
        await publishEvent('attendance.regularization.approved', { regularization_id: r.id, user_id: r.user_id, org_id: org.id });
      }
      toast(`${pending.length} regularization${pending.length > 1 ? 's' : ''} approved`);
      updateTabCounts();
      renderRegularizations();
    });

    content.querySelectorAll('[data-action="approve-reg"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const updates = { status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() };
        const { error } = await sb.from('attendance_regularizations').update(updates).eq('id', btn.dataset.id);
        if (error) { toast('Failed: ' + error.message); btn.disabled = false; return; }
        const attUpdate = {};
        if (btn.dataset.reqIn) attUpdate.check_in = btn.dataset.reqIn;
        if (btn.dataset.reqOut) attUpdate.check_out = btn.dataset.reqOut;
        if (Object.keys(attUpdate).length) {
          attUpdate.status = 'present';
          await sb.from('attendance').update(attUpdate).eq('id', btn.dataset.attId);
        }
        await logAction('attendance', 'regularization', btn.dataset.id, 'approved', { status: 'pending' }, { status: 'approved' });
        await publishEvent('attendance.regularization.approved', { regularization_id: btn.dataset.id, user_id: btn.dataset.uid, org_id: org.id });
        toast('Regularization approved');
        updateTabCounts();
        renderRegularizations();
      });
    });

    content.querySelectorAll('[data-action="reject-reg"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = document.createElement('div');
        f.innerHTML = `
          <div style="display:grid;gap:var(--space-3)">
            <div class="form-group"><label class="form-label">Rejection Reason</label><textarea class="form-input" id="reg-reject-reason" rows="3" placeholder="Optional reason..."></textarea></div>
            <button class="btn btn-primary" id="confirm-reg-reject">Reject Regularization</button>
          </div>`;
        openModal('Reject Regularization', f);
        f.querySelector('#confirm-reg-reject').addEventListener('click', async () => {
          const reason = f.querySelector('#reg-reject-reason').value;
          const { error } = await sb.from('attendance_regularizations').update({
            status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString()
          }).eq('id', btn.dataset.id);
          closeModal();
          if (error) { toast('Failed: ' + error.message); return; }
          await logAction('attendance', 'regularization', btn.dataset.id, 'rejected', { status: 'pending' }, { status: 'rejected' });
          toast('Regularization rejected');
          updateTabCounts();
          renderRegularizations();
        });
      });
    });
  }

  async function renderHelpdesk() {
    let q = sb.from('helpdesk_tickets')
      .select('*, category:category_id(name, icon), creator:created_by(full_name, email)')
      .order('created_at', { ascending: false });

    if (!showHistory) q = q.in('status', ['open', 'in_progress']);

    const { data: tickets, error } = await q;

    if (error) {
      content.innerHTML = `<div class="card"><div class="card-body" style="color:var(--color-error)">Failed to load: ${esc(error.message)}</div></div>`;
      return;
    }

    if (!tickets?.length) {
      content.innerHTML = `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
        <div class="empty-state-title">All caught up</div>
        <div class="empty-state-desc">No ${showHistory ? '' : 'open '}helpdesk tickets.</div>
      </div></div>`;
      return;
    }

    const priorityColors = { Low: 'neutral', Medium: 'info', High: 'warning', Urgent: 'error' };
    const statusColors = { open: 'warning', in_progress: 'info', resolved: 'success', closed: 'neutral' };
    const statusLabels = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };

    content.innerHTML = `<div class="card">
      <div class="table-wrap"><table class="table">
      <thead><tr><th>Raised By</th><th>Subject</th><th>Category</th><th>Priority</th>${showHistory ? '<th>Status</th>' : '<th>Pending</th>'}<th>Actions</th></tr></thead>
      <tbody>${tickets.map(t => `<tr>
        <td>
          <div style="display:flex;align-items:center;gap:var(--space-2)">
            <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${avColor(t.creator?.full_name || '')};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(t.creator?.full_name || '?')}</div>
            <span style="font-size:var(--text-sm)">${esc(t.creator?.full_name || '—')}</span>
          </div>
        </td>
        <td style="font-weight:var(--font-weight-medium);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.subject)}</td>
        <td>${t.category ? `<span class="badge badge-info">${esc(t.category.icon || '📋')} ${esc(t.category.name)}</span>` : '<span class="badge badge-neutral">—</span>'}</td>
        <td><span class="badge badge-${priorityColors[t.priority] || 'neutral'}">${esc(t.priority)}</span></td>
        ${showHistory
          ? `<td><span class="badge badge-${statusColors[t.status] || 'neutral'}"><span class="badge-dot"></span>${statusLabels[t.status] || esc(t.status)}</span></td>`
          : `<td>${pendingDuration(t.created_at)}</td>`
        }
        <td>
          ${['open', 'in_progress'].includes(t.status) && isManager ? `<div style="display:flex;gap:var(--space-1)">
            <button class="btn btn-primary btn-sm" data-action="resolve-ticket" data-tid="${t.id}">Resolve</button>
            <button class="btn btn-secondary btn-sm" data-action="close-ticket" data-tid="${t.id}">Close</button>
          </div>` : t.status === 'resolved' && isManager ? `<button class="btn btn-secondary btn-sm" data-action="close-ticket" data-tid="${t.id}">Close</button>` : '—'}
        </td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;

    content.querySelectorAll('[data-action="resolve-ticket"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const t = tickets.find(x => x.id === btn.dataset.tid);
        await sb.from('helpdesk_tickets').update({ status: 'resolved', resolved_by: user.id, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', btn.dataset.tid);
        await publishEvent('helpdesk.ticket.updated', { ticket_id: btn.dataset.tid, status: 'resolved', user_id: t?.created_by });
        toast('Ticket resolved');
        updateTabCounts();
        renderHelpdesk();
      });
    });

    content.querySelectorAll('[data-action="close-ticket"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const t = tickets.find(x => x.id === btn.dataset.tid);
        await sb.from('helpdesk_tickets').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', btn.dataset.tid);
        await publishEvent('helpdesk.ticket.updated', { ticket_id: btn.dataset.tid, status: 'closed', user_id: t?.created_by });
        toast('Ticket closed');
        updateTabCounts();
        renderHelpdesk();
      });
    });
  }

  async function updateTabCounts() {
    const [{ count: lc }, { count: rc }] = await Promise.all([
      sb.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('attendance_regularizations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);
    leaveCount = lc ?? 0;
    regCount = rc ?? 0;

    const { count: tc } = await sb.from('helpdesk_tickets').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']);
    ticketCount = tc ?? 0;

    const tabs = document.querySelectorAll('#inbox-tabs .tab');
    if (tabs[0]) tabs[0].innerHTML = `Leave Requests${leaveCount ? ` <span class="badge badge-error" style="margin-left:var(--space-1);font-size:10px;padding:1px 6px">${leaveCount}</span>` : ''}`;
    if (tabs[1]) tabs[1].innerHTML = `Regularization${regCount ? ` <span class="badge badge-error" style="margin-left:var(--space-1);font-size:10px;padding:1px 6px">${regCount}</span>` : ''}`;
    if (tabs[2]) tabs[2].innerHTML = `Helpdesk${ticketCount ? ` <span class="badge badge-error" style="margin-left:var(--space-1);font-size:10px;padding:1px 6px">${ticketCount}</span>` : ''}`;
  }

  renderTab();
}
