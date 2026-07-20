import sb from '../../js/supabase.js';
import { getUser, getOrg } from '../../js/auth.js';
import { publishEvent } from '../../js/events.js';

export default async function leaveApply(container) {
  const user = getUser();
  const org = getOrg();

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Leave</h1>
      <p class="page-subtitle">Apply for leave and view your balances</p>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6)">
      <div class="card">
        <div class="card-header"><span class="card-title">Apply for Leave</span></div>
        <div class="card-body">
          <form id="leave-form">
            <div class="form-group">
              <label class="form-label">Leave Type</label>
              <select class="form-input" id="leave-type" required>
                <option value="">Select type...</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Start Date</label>
              <input type="date" class="form-input" id="leave-start" required>
            </div>
            <div class="form-group">
              <label class="form-label">End Date</label>
              <input type="date" class="form-input" id="leave-end" required>
            </div>
            <div class="form-group">
              <label class="form-label">Reason</label>
              <textarea class="form-input" id="leave-reason" rows="3" placeholder="Optional reason..."></textarea>
            </div>
            <button type="submit" class="btn btn-primary">Submit Request</button>
            <div id="leave-msg" style="margin-top:var(--space-3);font-size:var(--text-sm)" class="hidden"></div>
          </form>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">My Balances</span></div>
        <div class="card-body" id="leave-balances">
          <div class="empty-state"><div class="empty-state-desc">Loading balances...</div></div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:var(--space-6)">
      <div class="card-header"><span class="card-title">Recent Requests</span></div>
      <div id="leave-requests-list"></div>
    </div>
  `;

  if (!org || !user) return;

  const { data: types } = await sb.from('leave_types').select('*').eq('is_active', true);
  const select = document.getElementById('leave-type');
  (types || []).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.name} (${t.code})`;
    select.appendChild(opt);
  });

  const year = new Date().getFullYear();
  const { data: balances } = await sb.from('leave_balances')
    .select('*, leave_type:leave_type_id(name, code)')
    .eq('user_id', user.id)
    .eq('year', year);

  const balEl = document.getElementById('leave-balances');
  if (balances?.length) {
    balEl.innerHTML = balances.map(b => `
      <div style="display:flex;justify-content:space-between;padding:var(--space-3) 0;border-bottom:1px solid var(--color-border-light)">
        <span>${esc(b.leave_type?.name || '—')}</span>
        <span style="font-weight:var(--font-weight-semibold)">${b.balance ?? '—'} days</span>
      </div>
    `).join('');
  } else {
    balEl.innerHTML = `<div class="empty-state"><div class="empty-state-desc">No leave balances configured yet.</div></div>`;
  }

  const { data: requests } = await sb.from('leave_requests')
    .select('*, leave_type:leave_type_id(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const listEl = document.getElementById('leave-requests-list');
  if (requests?.length) {
    listEl.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th></tr></thead>
      <tbody>${requests.map(r => `<tr>
        <td>${esc(r.leave_type?.name || '—')}</td>
        <td>${r.start_date}</td>
        <td>${r.end_date}</td>
        <td>${r.days}</td>
        <td><span class="badge badge-${r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'error' : r.status === 'pending' ? 'warning' : 'neutral'}">${r.status}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } else {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-state-desc">No leave requests yet.</div></div>`;
  }

  document.getElementById('leave-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('leave-msg');
    msg.classList.add('hidden');
    const startDate = document.getElementById('leave-start').value;
    const endDate = document.getElementById('leave-end').value;
    const days = (new Date(endDate) - new Date(startDate)) / 86400000 + 1;

    if (days <= 0) {
      msg.textContent = 'End date must be after start date.';
      msg.style.color = 'var(--color-error)';
      msg.classList.remove('hidden');
      return;
    }

    const { data, error } = await sb.from('leave_requests').insert({
      org_id: org.id,
      user_id: user.id,
      leave_type_id: document.getElementById('leave-type').value,
      start_date: startDate,
      end_date: endDate,
      days,
      reason: document.getElementById('leave-reason').value || null,
    }).select().single();

    if (error) {
      msg.textContent = 'Error: ' + error.message;
      msg.style.color = 'var(--color-error)';
      msg.classList.remove('hidden');
      return;
    }

    await publishEvent('leave.request.created', { leave_request_id: data.id });
    msg.textContent = 'Leave request submitted!';
    msg.style.color = 'var(--color-success)';
    msg.classList.remove('hidden');
    e.target.reset();
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
