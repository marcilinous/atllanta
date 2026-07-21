import sb from '../js/supabase.js';
import { getUser, getOrg, getMembership } from '../js/auth.js';
import { esc, toast, formatDate, initials, avColor, openModal, closeModal } from '../js/ui.js';
import { logAction } from '../js/audit.js';
import { publishEvent } from '../js/events.js';

export default async function approvalsInbox(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();

  if (!org) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No organization found</div></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Approvals</h1>
      <p class="page-subtitle">All pending approvals in one place</p>
    </div>
    <div class="tabs" id="approval-tabs">
      <button class="tab active" data-tab="leave">Leave Requests</button>
      <button class="tab" data-tab="regularization">Attendance Regularization</button>
    </div>
    <div id="approvals-content" style="margin-top:var(--space-4)">
      <div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>
    </div>
  `;

  let currentTab = 'leave';

  document.getElementById('approval-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#approval-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderTab();
  });

  const content = document.getElementById('approvals-content');

  async function renderTab() {
    content.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>`;
    if (currentTab === 'leave') await renderLeaveApprovals();
    else await renderRegularizations();
  }

  async function renderLeaveApprovals() {
    const { data: requests, error } = await sb
      .from('leave_requests')
      .select('*, requester:user_id(full_name, email), leave_type:leave_type_id(name, code)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      content.innerHTML = `<div class="card"><div class="card-body" style="color:var(--color-error)">Failed to load: ${esc(error.message)}</div></div>`;
      return;
    }

    if (!requests?.length) {
      content.innerHTML = `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
        <div class="empty-state-title">All caught up</div>
        <div class="empty-state-desc">No pending leave requests to review.</div>
      </div></div>`;
      return;
    }

    content.innerHTML = `<div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Employee</th><th>Leave Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Actions</th></tr></thead>
      <tbody>${requests.map(r => `<tr>
        <td>
          <div style="display:flex;align-items:center;gap:var(--space-2)">
            <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${avColor(r.requester?.full_name || '')};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(r.requester?.full_name || r.requester?.email || '?')}</div>
            <div>
              <div style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(r.requester?.full_name || r.requester?.email || '—')}</div>
            </div>
          </div>
        </td>
        <td><span class="badge badge-neutral">${esc(r.leave_type?.code || '—')}</span> ${esc(r.leave_type?.name || '')}</td>
        <td>${formatDate(r.start_date)}</td>
        <td>${formatDate(r.end_date)}</td>
        <td>${r.days}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.reason || '—')}</td>
        <td>
          <div style="display:flex;gap:var(--space-1)">
            <button class="btn btn-primary btn-sm" data-action="approve-leave" data-id="${r.id}">Approve</button>
            <button class="btn btn-secondary btn-sm" data-action="reject-leave" data-id="${r.id}">Reject</button>
          </div>
        </td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;

    content.querySelectorAll('[data-action="approve-leave"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await sb.from('leave_requests').update({
          status: 'approved',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString()
        }).eq('id', btn.dataset.id);
        if (error) return toast(error.message);
        await logAction('leave', 'leave_request', btn.dataset.id, 'approved', { status: 'pending' }, { status: 'approved' });
        await publishEvent('leave.request.approved', { leave_request_id: btn.dataset.id, approved_by: user.id });
        toast('Leave approved');
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
            status: 'rejected',
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString(),
            review_comment: reason || null
          }).eq('id', btn.dataset.id);
          closeModal();
          if (error) return toast(error.message);
          await logAction('leave', 'leave_request', btn.dataset.id, 'rejected', { status: 'pending' }, { status: 'rejected', review_comment: reason || null });
          toast('Leave rejected');
          renderLeaveApprovals();
        });
      });
    });
  }

  async function renderRegularizations() {
    const { data: regs, error } = await sb
      .from('attendance_regularizations')
      .select('*, requester:user_id(full_name, email), attendance:attendance_id(date, check_in, check_out, status)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      content.innerHTML = `<div class="card"><div class="card-body" style="color:var(--color-error)">Failed to load: ${esc(error.message)}</div></div>`;
      return;
    }

    if (!regs?.length) {
      content.innerHTML = `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
        <div class="empty-state-title">All caught up</div>
        <div class="empty-state-desc">No pending regularization requests.</div>
      </div></div>`;
      return;
    }

    content.innerHTML = `<div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Employee</th><th>Date</th><th>Original</th><th>Requested</th><th>Reason</th><th>Actions</th></tr></thead>
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
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-sm)">${esc(r.reason || '—')}</td>
          <td>
            <div style="display:flex;gap:var(--space-1)">
              <button class="btn btn-primary btn-sm" data-action="approve-reg" data-id="${r.id}" data-att-id="${r.attendance_id}" data-req-in="${r.requested_check_in || ''}" data-req-out="${r.requested_check_out || ''}">Approve</button>
              <button class="btn btn-secondary btn-sm" data-action="reject-reg" data-id="${r.id}">Reject</button>
            </div>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div></div>`;

    content.querySelectorAll('[data-action="approve-reg"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const updates = { status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() };
        const { error } = await sb.from('attendance_regularizations').update(updates).eq('id', btn.dataset.id);
        if (error) { toast('Failed: ' + error.message); return; }
        const attUpdate = {};
        if (btn.dataset.reqIn) attUpdate.check_in = btn.dataset.reqIn;
        if (btn.dataset.reqOut) attUpdate.check_out = btn.dataset.reqOut;
        if (Object.keys(attUpdate).length) {
          attUpdate.status = 'present';
          await sb.from('attendance').update(attUpdate).eq('id', btn.dataset.attId);
        }
        await logAction('attendance', 'regularization', btn.dataset.id, 'approved', { status: 'pending' }, { status: 'approved' });
        await publishEvent('attendance.regularization.approved', { regularization_id: btn.dataset.id });
        toast('Regularization approved');
        renderRegularizations();
      });
    });

    content.querySelectorAll('[data-action="reject-reg"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await sb.from('attendance_regularizations').update({
          status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString()
        }).eq('id', btn.dataset.id);
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('attendance', 'regularization', btn.dataset.id, 'rejected', { status: 'pending' }, { status: 'rejected' });
        toast('Regularization rejected');
        renderRegularizations();
      });
    });
  }

  renderTab();
}
