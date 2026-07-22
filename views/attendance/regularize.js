import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate, initials, avColor } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

export default async function regularizeView(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);

  if (!org || !user) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Please log in</div></div>';
    return;
  }

  let currentTab = 'my';

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Attendance Regularization</h1>
        <p class="page-subtitle">Request corrections for missed or incorrect check-ins</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <a href="#/attendance" class="btn btn-secondary btn-sm">Attendance</a>
        <button class="btn btn-primary btn-sm" id="new-reg-btn">+ New Request</button>
      </div>
    </div>

    <div class="tabs" id="reg-tabs">
      <button class="tab active" data-tab="my">My Requests</button>
      ${isManager ? '<button class="tab" data-tab="review">Team Requests</button>' : ''}
    </div>
    <div id="reg-content" style="margin-top:var(--space-3)"></div>
  `;

  document.getElementById('reg-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#reg-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderTab();
  });

  document.getElementById('new-reg-btn').addEventListener('click', openNewRegModal);

  async function openNewRegModal() {
    const { data: myAtt } = await sb.from('attendance')
      .select('id, date, check_in, check_out, status')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(30);

    const f = document.createElement('div');
    f.innerHTML = `<div style="display:grid;gap:var(--space-4)">
      <div class="form-group">
        <label class="form-label">Select Attendance Record</label>
        <select class="form-input" id="reg-att-id">
          <option value="">— Select a date —</option>
          ${(myAtt || []).map(a => {
            const checkIn = a.check_in ? new Date(a.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : 'Missing';
            const checkOut = a.check_out ? new Date(a.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : 'Missing';
            return `<option value="${a.id}">${formatDate(a.date)} — In: ${checkIn}, Out: ${checkOut} (${a.status})</option>`;
          }).join('')}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Corrected Check-In</label><input type="datetime-local" class="form-input" id="reg-checkin"></div>
        <div class="form-group"><label class="form-label">Corrected Check-Out</label><input type="datetime-local" class="form-input" id="reg-checkout"></div>
      </div>
      <div class="form-group"><label class="form-label">Reason</label><textarea class="form-input" id="reg-reason" rows="3" placeholder="Why does this need correction?" required></textarea></div>
      <button class="btn btn-primary" id="reg-submit">Submit Request</button>
    </div>`;
    openModal('Request Regularization', f);

    f.querySelector('#reg-submit').addEventListener('click', async () => {
      const attId = f.querySelector('#reg-att-id').value;
      const reason = f.querySelector('#reg-reason').value.trim();
      if (!attId) return toast('Select an attendance record');
      if (!reason) return toast('Reason is required');

      const checkIn = f.querySelector('#reg-checkin').value;
      const checkOut = f.querySelector('#reg-checkout').value;
      if (!checkIn && !checkOut) return toast('Provide at least one corrected time');

      const btn = f.querySelector('#reg-submit');
      btn.disabled = true;
      btn.textContent = 'Submitting...';

      const { data, error } = await sb.from('attendance_regularizations').insert({
        org_id: org.id,
        user_id: user.id,
        attendance_id: attId,
        reason,
        requested_check_in: checkIn ? new Date(checkIn).toISOString() : null,
        requested_check_out: checkOut ? new Date(checkOut).toISOString() : null,
      }).select().single();

      if (error) {
        toast('Failed: ' + error.message);
        btn.disabled = false;
        btn.textContent = 'Submit Request';
        return;
      }

      await logAction('attendance', 'regularization', data.id, 'created', null, { attendance_id: attId, reason });
      await publishEvent('attendance.regularization.created', { regularization_id: data.id, user_id: user.id, org_id: org.id });
      closeModal();
      toast('Regularization request submitted');
      renderTab();
    });
  }

  async function renderTab() {
    const el = document.getElementById('reg-content');
    if (currentTab === 'my') await renderMyRequests(el);
    else if (currentTab === 'review') await renderTeamRequests(el);
  }

  async function renderMyRequests(el) {
    el.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>';
    const { data: regs, error } = await sb.from('attendance_regularizations')
      .select('*, attendance:attendance_id(date, check_in, check_out, status)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) { toast('Failed: ' + error.message); return; }
    const all = regs || [];

    if (!all.length) {
      el.innerHTML = `<div class="card"><div class="empty-state" style="padding:var(--space-6)">
        <div class="empty-state-title">No regularization requests</div>
        <div class="empty-state-desc">Use the "+ New Request" button to submit a correction.</div>
      </div></div>`;
      return;
    }

    const statusColors = { pending: 'warning', approved: 'success', rejected: 'error' };

    el.innerHTML = `<div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Date</th><th>Original</th><th>Requested</th><th>Reason</th><th>Status</th><th>Reviewed</th></tr></thead>
      <tbody>${all.map(r => {
        const origIn = r.attendance?.check_in ? new Date(r.attendance.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
        const origOut = r.attendance?.check_out ? new Date(r.attendance.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
        const reqIn = r.requested_check_in ? new Date(r.requested_check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
        const reqOut = r.requested_check_out ? new Date(r.requested_check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
        return `<tr>
          <td style="font-weight:var(--font-weight-medium)">${r.attendance ? formatDate(r.attendance.date) : '—'}</td>
          <td style="font-size:var(--text-sm)">In: ${origIn}<br>Out: ${origOut}</td>
          <td style="font-size:var(--text-sm);color:var(--color-accent);font-weight:var(--font-weight-medium)">In: ${reqIn}<br>Out: ${reqOut}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-sm)">${esc(r.reason)}</td>
          <td><span class="badge badge-${statusColors[r.status] || 'neutral'}"><span class="badge-dot"></span>${r.status}</span></td>
          <td style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${r.reviewed_at ? formatDate(r.reviewed_at) : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div></div>`;
  }

  async function renderTeamRequests(el) {
    el.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading team requests...</div>';
    const { data: regs, error } = await sb.from('attendance_regularizations')
      .select('*, attendance:attendance_id(date, check_in, check_out, status), requester:user_id(full_name, email, department:department_id(name))')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) { toast('Failed: ' + error.message); return; }
    const all = regs || [];

    if (!all.length) {
      el.innerHTML = `<div class="card"><div style="padding:var(--space-6);text-align:center">
        <div style="color:var(--color-success);margin-bottom:var(--space-2)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <div style="font-weight:var(--font-weight-semibold)">All caught up</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">No pending regularization requests to review.</div>
      </div></div>`;
      return;
    }

    el.innerHTML = `
      ${all.length > 1 ? `<div id="reg-bulk-bar" style="display:none;padding:var(--space-3) var(--space-4);background:var(--color-accent-light);border-radius:var(--radius-md);margin-bottom:var(--space-3);align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)" id="reg-bulk-count">0 selected</span>
        <button class="btn btn-primary btn-sm" id="reg-bulk-approve">Approve Selected</button>
        <button class="btn btn-secondary btn-sm" id="reg-bulk-reject">Reject Selected</button>
        <button class="btn btn-ghost btn-sm" id="reg-bulk-clear">Clear</button>
      </div>` : ''}
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr>
          ${all.length > 1 ? '<th style="width:36px"><input type="checkbox" id="reg-sel-all"></th>' : ''}
          <th>Employee</th>
          <th>Dept</th>
          <th>Date</th>
          <th>Original</th>
          <th>Requested</th>
          <th>Reason</th>
          <th>Waiting</th>
          <th>Actions</th>
        </tr></thead>
        <tbody>${all.map(r => {
          const origIn = r.attendance?.check_in ? new Date(r.attendance.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
          const origOut = r.attendance?.check_out ? new Date(r.attendance.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
          const reqIn = r.requested_check_in ? new Date(r.requested_check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
          const reqOut = r.requested_check_out ? new Date(r.requested_check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';
          const waitDays = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
          const waitColor = waitDays >= 5 ? 'var(--color-error)' : waitDays >= 2 ? 'var(--color-warning)' : 'var(--color-text-tertiary)';
          return `<tr>
            ${all.length > 1 ? `<td><input type="checkbox" class="reg-check" data-id="${r.id}" data-att-id="${r.attendance_id}"></td>` : ''}
            <td>
              <div style="display:flex;align-items:center;gap:var(--space-2)">
                <div style="width:26px;height:26px;border-radius:var(--radius-full);background:${avColor(r.requester?.full_name || '')};display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(r.requester?.full_name || '?')}</div>
                <span style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(r.requester?.full_name || r.requester?.email || '—')}</span>
              </div>
            </td>
            <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(r.requester?.department?.name || '—')}</td>
            <td style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${r.attendance ? formatDate(r.attendance.date) : '—'}</td>
            <td style="font-size:var(--text-xs)">In: ${origIn}<br>Out: ${origOut}</td>
            <td style="font-size:var(--text-xs);color:var(--color-accent);font-weight:var(--font-weight-medium)">In: ${reqIn}<br>Out: ${reqOut}</td>
            <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-sm)" title="${esc(r.reason)}">${esc(r.reason)}</td>
            <td style="font-size:var(--text-xs);color:${waitColor};font-weight:var(--font-weight-medium)">${waitDays === 0 ? 'Today' : waitDays + 'd'}</td>
            <td>
              <div style="display:flex;gap:var(--space-1)">
                <button class="btn btn-primary btn-sm" data-reg-approve="${r.id}" data-att-id="${r.attendance_id}" data-req-checkin="${r.requested_check_in || ''}" data-req-checkout="${r.requested_check_out || ''}">Approve</button>
                <button class="btn btn-secondary btn-sm" data-reg-reject="${r.id}">Reject</button>
              </div>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div></div>`;

    el.querySelectorAll('[data-reg-approve]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '...';
        await approveReg(btn.dataset.regApprove, btn.dataset.attId, btn.dataset.reqCheckin, btn.dataset.reqCheckout);
        toast('Regularization approved');
        renderTeamRequests(el);
      });
    });

    el.querySelectorAll('[data-reg-reject]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Reject this regularization request?')) return;
        const { error } = await sb.from('attendance_regularizations').update({
          status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
        }).eq('id', btn.dataset.regReject);
        if (error) return toast(error.message);
        await logAction('attendance', 'regularization', btn.dataset.regReject, 'rejected', null, null);
        toast('Regularization rejected');
        renderTeamRequests(el);
      });
    });

    if (all.length > 1) {
      const bulkBar = document.getElementById('reg-bulk-bar');
      const selAll = document.getElementById('reg-sel-all');
      const checks = el.querySelectorAll('.reg-check');

      function getChecked() { return [...el.querySelectorAll('.reg-check:checked')]; }
      function updateBar() {
        const sel = getChecked();
        if (bulkBar) bulkBar.style.display = sel.length ? 'flex' : 'none';
        const cnt = document.getElementById('reg-bulk-count');
        if (cnt) cnt.textContent = `${sel.length} selected`;
      }

      checks.forEach(c => c.addEventListener('change', updateBar));
      if (selAll) selAll.addEventListener('change', () => {
        checks.forEach(c => { c.checked = selAll.checked; });
        updateBar();
      });

      document.getElementById('reg-bulk-approve')?.addEventListener('click', async () => {
        const sel = getChecked();
        if (!sel.length) return;
        if (!confirm(`Approve ${sel.length} regularization${sel.length > 1 ? 's' : ''}?`)) return;
        for (const c of sel) {
          const reg = all.find(r => r.id === c.dataset.id);
          if (reg) await approveReg(reg.id, reg.attendance_id, reg.requested_check_in, reg.requested_check_out);
        }
        toast(`${sel.length} regularization${sel.length > 1 ? 's' : ''} approved`);
        renderTeamRequests(el);
      });

      document.getElementById('reg-bulk-reject')?.addEventListener('click', async () => {
        const sel = getChecked();
        if (!sel.length) return;
        if (!confirm(`Reject ${sel.length} regularization${sel.length > 1 ? 's' : ''}?`)) return;
        for (const c of sel) {
          await sb.from('attendance_regularizations').update({
            status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
          }).eq('id', c.dataset.id);
          await logAction('attendance', 'regularization', c.dataset.id, 'rejected', null, null);
        }
        toast(`${sel.length} regularization${sel.length > 1 ? 's' : ''} rejected`);
        renderTeamRequests(el);
      });

      document.getElementById('reg-bulk-clear')?.addEventListener('click', () => {
        checks.forEach(c => { c.checked = false; });
        if (selAll) selAll.checked = false;
        updateBar();
      });
    }
  }

  async function approveReg(regId, attId, reqCheckIn, reqCheckOut) {
    const updates = { status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() };
    await sb.from('attendance_regularizations').update(updates).eq('id', regId);

    const attUpdates = {};
    if (reqCheckIn) attUpdates.check_in = reqCheckIn;
    if (reqCheckOut) attUpdates.check_out = reqCheckOut;
    if (reqCheckIn && reqCheckOut) {
      const hrs = (new Date(reqCheckOut) - new Date(reqCheckIn)) / 3600000;
      attUpdates.total_hours = Math.max(0, hrs).toFixed(2);
      attUpdates.status = 'present';
    }
    if (Object.keys(attUpdates).length) {
      await sb.from('attendance').update(attUpdates).eq('id', attId);
    }

    await logAction('attendance', 'regularization', regId, 'approved', null, attUpdates);
    await publishEvent('attendance.regularization.approved', { regularization_id: regId, attendance_id: attId, org_id: org.id });
  }

  renderTab();
}
