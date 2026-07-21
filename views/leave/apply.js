import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, stagePill } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';
import { logAction } from '../../js/audit.js';

export default async function leaveModule(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Leave</h1>
      <p class="page-subtitle">Apply for leave, view balances, and manage approvals</p>
    </div>
    <div class="tabs" id="leave-tabs">
      <button class="tab active" data-tab="apply">Apply</button>
      <button class="tab" data-tab="requests">My Requests</button>
      ${isManager ? '<button class="tab" data-tab="approvals">Pending Approvals</button>' : ''}
      <a href="#/leave/balances" class="tab" style="text-decoration:none">Balances</a>
      <a href="#/leave/calendar" class="tab" style="text-decoration:none">Team Calendar</a>
      ${isManager ? '<a href="#/leave/approvals" class="tab" style="text-decoration:none">Approvals</a>' : ''}
      ${isManager ? '<a href="#/leave/report" class="tab" style="text-decoration:none">Report</a>' : ''}
      ${isManager ? '<a href="#/leave/settings" class="tab" style="text-decoration:none">Settings</a>' : ''}
    </div>
    <div id="leave-content" style="margin-top:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text" style="width:60%"></div></div>
  `;

  if (!org || !user) return;

  let currentTab = 'apply';

  document.getElementById('leave-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#leave-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderTab();
  });

  const [{ data: types, error: typesErr }, { data: balances, error: balErr }] = await Promise.all([
    sb.from('leave_types').select('*').eq('is_active', true),
    sb.from('leave_balances')
      .select('*, leave_type:leave_type_id(name, code)')
      .eq('user_id', user.id)
      .eq('year', new Date().getFullYear()),
  ]);
  if (typesErr) toast('Failed to load leave types: ' + typesErr.message);
  if (balErr) toast('Failed to load leave balances: ' + balErr.message);
  const leaveTypes = types || [];
  const myBalances = balances || [];

  async function renderTab() {
    const content = document.getElementById('leave-content');
    if (currentTab === 'apply') renderApply(content);
    else if (currentTab === 'requests') await renderRequests(content);
    else if (currentTab === 'approvals') await renderApprovals(content);
    else if (currentTab === 'calendar') await renderCalendar(content);
  }

  function renderApply(el) {
    el.innerHTML = `
      <div class="dash-grid" style="margin-top:0">
        <div class="card">
          <div class="card-header"><span class="card-title">Apply for Leave</span></div>
          <div class="card-body">
            <form id="leave-form">
              <div class="form-group">
                <label class="form-label">Leave Type</label>
                <select class="form-input" id="leave-type" required>
                  <option value="">Select type...</option>
                  ${leaveTypes.map(t => `<option value="${t.id}">${esc(t.name)} (${esc(t.code)})</option>`).join('')}
                </select>
              </div>
              <div class="form-group"><label class="form-label">Start Date</label><input type="date" class="form-input" id="leave-start" required></div>
              <div class="form-group"><label class="form-label">End Date</label><input type="date" class="form-input" id="leave-end" required></div>
              <div class="form-group"><label class="form-label">Reason</label><textarea class="form-input" id="leave-reason" rows="3" placeholder="Optional reason..."></textarea></div>
              <button type="submit" class="btn btn-primary">Submit Request</button>
              <div id="leave-msg" class="hidden" style="margin-top:var(--space-3);font-size:var(--text-sm)"></div>
            </form>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">My Balances</span></div>
          <div class="card-body">
            ${myBalances.length ? myBalances.map(b => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3) 0;border-bottom:1px solid var(--color-border-light)">
                <div>
                  <div style="font-weight:var(--font-weight-medium)">${esc(b.leave_type?.name || '—')}</div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(b.leave_type?.code || '')}</div>
                </div>
                <div style="text-align:right">
                  <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-lg)">${b.balance ?? '—'}</div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">of ${(b.opening_balance || 0) + (b.accrued || 0)} days</div>
                </div>
              </div>
            `).join('') : '<div style="padding:var(--space-4);text-align:center;color:var(--color-text-tertiary)">No leave balances configured</div>'}
          </div>
        </div>
      </div>`;

    el.querySelector('#leave-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = el.querySelector('#leave-msg');
      msg.classList.add('hidden');
      const startDate = el.querySelector('#leave-start').value;
      const endDate = el.querySelector('#leave-end').value;
      const leaveTypeId = el.querySelector('#leave-type').value;
      if (!leaveTypeId) return;
      const days = (new Date(endDate) - new Date(startDate)) / 86400000 + 1;
      if (days <= 0) { msg.textContent = 'End date must be after start date'; msg.style.color = 'var(--color-error)'; msg.classList.remove('hidden'); return; }

      const { data, error } = await sb.from('leave_requests').insert({
        org_id: org.id, user_id: user.id, leave_type_id: leaveTypeId,
        start_date: startDate, end_date: endDate, days,
        reason: el.querySelector('#leave-reason').value || null,
      }).select().single();

      if (error) { msg.textContent = error.message; msg.style.color = 'var(--color-error)'; msg.classList.remove('hidden'); return; }
      await logAction('leave', 'leave_request', data.id, 'created', null, { start_date: startDate, end_date: endDate, days });
      await publishEvent('leave.request.created', { leave_request_id: data.id, user_id: user.id, org_id: org.id });
      msg.textContent = 'Leave request submitted!'; msg.style.color = 'var(--color-success)'; msg.classList.remove('hidden');
      e.target.reset();
    });
  }

  async function renderRequests(el) {
    const { data: requests, error: reqErr } = await sb.from('leave_requests')
      .select('*, leave_type:leave_type_id(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (reqErr) { toast('Failed to load requests: ' + reqErr.message); return; }

    if (!requests?.length) {
      el.innerHTML = '<div class="card" style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No leave requests yet</div>';
      return;
    }

    el.innerHTML = `<div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th><th></th></tr></thead>
      <tbody>${requests.map(r => {
        const statusColors = { pending: 'warning', approved: 'success', rejected: 'error', cancelled: 'neutral' };
        return `<tr>
          <td>${esc(r.leave_type?.name || '—')}</td>
          <td>${r.start_date}</td><td>${r.end_date}</td><td>${r.days}</td>
          <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${esc(r.reason || '—')}</td>
          <td><span class="badge badge-${statusColors[r.status] || 'neutral'}"><span class="badge-dot"></span>${r.status}</span></td>
          <td>${r.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-cancel="${r.id}">Cancel</button>` : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div></div>`;

    el.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await sb.from('leave_requests').update({ status: 'cancelled' }).eq('id', btn.dataset.cancel);
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('leave', 'leave_request', btn.dataset.cancel, 'cancelled', { status: 'pending' }, { status: 'cancelled' });
        toast('Leave request cancelled');
        renderRequests(el);
      });
    });
  }

  async function renderApprovals(el) {
    const { data: pending, error: pendErr } = await sb.from('leave_requests')
      .select('*, leave_type:leave_type_id(name), requester:user_id(full_name, email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (pendErr) { toast('Failed to load approvals: ' + pendErr.message); return; }

    if (!pending?.length) {
      el.innerHTML = '<div class="card" style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No pending approvals</div>';
      return;
    }

    el.innerHTML = `<div style="display:grid;gap:var(--space-3)">
      ${pending.map(r => `
        <div class="card" style="padding:var(--space-4)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-4)">
            <div>
              <div style="font-weight:var(--font-weight-semibold)">${esc(r.requester?.full_name || r.requester?.email || '—')}</div>
              <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(r.leave_type?.name || '—')} · ${r.days} day${r.days !== 1 ? 's' : ''}</div>
              <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${r.start_date} to ${r.end_date}</div>
              ${r.reason ? `<div style="font-size:var(--text-sm);color:var(--color-text-tertiary);margin-top:var(--space-1)">${esc(r.reason)}</div>` : ''}
            </div>
            <div style="display:flex;gap:var(--space-2)">
              <button class="btn btn-primary btn-sm" data-approve="${r.id}" data-uid="${r.user_id}" data-ltid="${r.leave_type_id}" data-days="${r.days}">Approve</button>
              <button class="btn btn-danger btn-sm" data-reject="${r.id}">Reject</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>`;

    el.querySelectorAll('[data-approve]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await sb.from('leave_requests').update({
          status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
        }).eq('id', btn.dataset.approve);
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('leave', 'leave_request', btn.dataset.approve, 'approved', { status: 'pending' }, { status: 'approved' });
        await publishEvent('leave.request.approved', { leave_request_id: btn.dataset.approve, user_id: btn.dataset.uid, org_id: org.id, days: btn.dataset.days, leave_type_id: btn.dataset.ltid, approved_by: user.id });
        toast('Leave approved');
        renderApprovals(el);
      });
    });

    el.querySelectorAll('[data-reject]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const f = document.createElement('div');
        f.innerHTML = `<div style="display:grid;gap:var(--space-3)">
          <div class="form-group"><label class="form-label">Rejection reason</label><textarea class="form-input" id="rej-comment" rows="3"></textarea></div>
          <button class="btn btn-danger" id="rej-confirm">Reject</button>
        </div>`;
        openModal('Reject Leave', f);
        f.querySelector('#rej-confirm').addEventListener('click', async () => {
          const comment = f.querySelector('#rej-comment').value || null;
          const { error } = await sb.from('leave_requests').update({
            status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
            review_comment: comment,
          }).eq('id', btn.dataset.reject);
          if (error) { toast('Failed: ' + error.message); return; }
          await logAction('leave', 'leave_request', btn.dataset.reject, 'rejected', { status: 'pending' }, { status: 'rejected', review_comment: comment });
          closeModal();
          toast('Leave rejected');
          renderApprovals(el);
        });
      });
    });
  }

  async function renderCalendar(el) {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const [{ data: leaves, error: lvErr }, { data: holidays, error: holErr }] = await Promise.all([
      sb.from('leave_requests')
        .select('*, requester:user_id(full_name, email), leave_type:leave_type_id(name)')
        .in('status', ['approved', 'pending'])
        .lte('start_date', endDate)
        .gte('end_date', startDate)
        .order('start_date'),
      sb.from('holidays')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date'),
    ]);
    if (lvErr) toast('Failed to load leave calendar: ' + lvErr.message);
    if (holErr) toast('Failed to load holidays: ' + holErr.message);

    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">${now.toLocaleString('en', { month: 'long', year: 'numeric' })} — Team Calendar</span></div>
        <div class="card-body">
          ${(holidays || []).length ? `
            <div style="margin-bottom:var(--space-4)">
              <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);margin-bottom:var(--space-2)">Holidays</div>
              ${holidays.map(h => `
                <div style="display:flex;gap:var(--space-3);padding:var(--space-2) 0;font-size:var(--text-sm)">
                  <span style="color:var(--color-text-secondary)">${new Date(h.date).toLocaleDateString('en', { day: 'numeric', month: 'short' })}</span>
                  <span>${esc(h.name)}</span>
                  ${h.is_optional ? '<span class="badge badge-neutral">Optional</span>' : ''}
                </div>
              `).join('')}
            </div>
          ` : ''}
          ${(leaves || []).length ? `
            <div>
              <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);margin-bottom:var(--space-2)">Leave Requests</div>
              <div class="table-wrap"><table class="table">
                <thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th></tr></thead>
                <tbody>${leaves.map(l => `<tr>
                  <td>${esc(l.requester?.full_name || l.requester?.email || '—')}</td>
                  <td>${esc(l.leave_type?.name || '—')}</td>
                  <td>${l.start_date}</td><td>${l.end_date}</td><td>${l.days}</td>
                  <td><span class="badge badge-${l.status === 'approved' ? 'success' : 'warning'}"><span class="badge-dot"></span>${l.status}</span></td>
                </tr>`).join('')}</tbody>
              </table></div>
            </div>
          ` : '<div style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-4)">No leave requests this month</div>'}
        </div>
      </div>`;
  }

  renderTab();
}
