import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

export default async function leaveApprovals(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  if (!org || !user) { container.innerHTML = '<p>Please log in.</p>'; return; }

  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);
  if (!isManager) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Access Denied</div><p>Only managers can access leave approvals.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Leave Approvals</h1>
        <p class="page-subtitle">Review and approve pending leave requests</p>
      </div>
    </div>
    <div id="approvals-list">
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-text" style="width:80%"></div>
    </div>
  `;

  async function loadApprovals() {
    const { data: requests } = await sb
      .from('leave_requests')
      .select('*, requester:user_id(full_name, email), leave_type:leave_type_id(name, code)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    const el = document.getElementById('approvals-list');
    if (!el) return;

    if (!requests?.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-state-title">All caught up</div><p>No pending leave requests to review.</p></div>`;
      return;
    }

    el.innerHTML = requests.map(r => `
      <div class="card" style="margin-bottom:var(--space-3)" data-id="${r.id}">
        <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-4)">
          <div style="flex:1">
            <div style="font-weight:var(--font-weight-semibold)">${esc(r.requester?.full_name || r.requester?.email || '—')}</div>
            <div style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-top:var(--space-1)">
              ${esc(r.leave_type?.name || '—')} · ${r.days} day${r.days !== 1 ? 's' : ''} · ${r.start_date} to ${r.end_date}
            </div>
            ${r.reason ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-1)">${esc(r.reason)}</div>` : ''}
          </div>
          <div style="display:flex;gap:var(--space-2);flex-shrink:0">
            <button class="btn btn-primary btn-sm approve-btn" data-id="${r.id}" data-uid="${r.user_id}" data-ltid="${r.leave_type_id}" data-days="${r.days}">Approve</button>
            <button class="btn btn-ghost btn-sm reject-btn" data-id="${r.id}" data-uid="${r.user_id}">Reject</button>
          </div>
        </div>
      </div>
    `).join('');

    el.querySelectorAll('.approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const id = btn.dataset.id;
        const { error } = await sb
          .from('leave_requests')
          .update({ status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
          .eq('id', id);
        if (error) { toast(error.message, 'error'); btn.disabled = false; return; }
        await logAction('leave', 'leave_request', id, 'approved', { status: 'pending' }, { status: 'approved' });
        await publishEvent('leave.request.approved', { leave_request_id: id, user_id: btn.dataset.uid, org_id: org.id, days: btn.dataset.days, leave_type_id: btn.dataset.ltid, approved_by: user.id });
        toast('Leave approved', 'success');
        loadApprovals();
      });
    });

    el.querySelectorAll('.reject-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const comment = prompt('Rejection reason (optional):');
        btn.disabled = true;
        const id = btn.dataset.id;
        const { error } = await sb
          .from('leave_requests')
          .update({
            status: 'rejected',
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString(),
            review_comment: comment || null,
          })
          .eq('id', id);
        if (error) { toast(error.message, 'error'); btn.disabled = false; return; }
        await logAction('leave', 'leave_request', id, 'rejected', { status: 'pending' }, { status: 'rejected', review_comment: comment || null });
        await publishEvent('leave.request.rejected', { leave_request_id: id, user_id: btn.dataset.uid, org_id: org.id });
        toast('Leave rejected', 'success');
        loadApprovals();
      });
    });
  }

  loadApprovals();
}
