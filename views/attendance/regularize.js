import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate, initials, avColor } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';
import { logAction } from '../../js/audit.js';

export default async function regularizeView(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Attendance Regularization</h1>
      <p class="page-subtitle">Request corrections to attendance records</p>
    </div>
    <div class="tabs" id="reg-tabs">
      <button class="tab active" data-tab="my-requests">My Requests</button>
      ${isManager ? '<button class="tab" data-tab="pending">Pending Approvals</button>' : ''}
    </div>
    <div id="reg-content" style="margin-top:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text" style="width:60%"></div></div>
  `;

  if (!org || !user) return;

  let currentTab = 'my-requests';

  document.getElementById('reg-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#reg-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderTab();
  });

  async function renderTab() {
    const content = document.getElementById('reg-content');
    if (currentTab === 'my-requests') await renderMyRequests(content);
    else if (currentTab === 'pending') await renderPending(content);
  }

  async function renderMyRequests(el) {
    el.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>`;

    const { data: attendance, error: attErr } = await sb
      .from('attendance')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(30);
    if (attErr) toast('Failed to load attendance: ' + attErr.message);

    const { data: regs, error: regsErr } = await sb
      .from('attendance_regularizations')
      .select('*, attendance:attendance_id(date)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (regsErr) toast('Failed to load regularizations: ' + regsErr.message);

    const myRegs = regs || [];
    const myAttendance = (attendance || []).filter(a =>
      a.status !== 'holiday' && a.status !== 'weekly_off' && a.status !== 'on_leave'
    );

    const statusColors = { pending: 'warning', approved: 'success', rejected: 'error' };

    el.innerHTML = `
      <div class="grid-2col">
        <div class="card">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
            <span class="card-title">Recent Attendance</span>
            <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Click a row to regularize</span>
          </div>
          <div class="table-wrap" style="max-height:400px;overflow:auto"><table class="table">
            <thead><tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Status</th><th></th></tr></thead>
            <tbody>${myAttendance.length ? myAttendance.map(a => {
              const hasReg = myRegs.some(r => r.attendance_id === a.id && r.status === 'pending');
              return `<tr style="cursor:pointer${hasReg ? ';opacity:0.6' : ''}" ${!hasReg ? `data-regularize="${a.id}"` : ''}>
                <td style="font-weight:var(--font-weight-medium)">${formatDate(a.date)}</td>
                <td>${a.check_in ? new Date(a.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td>${a.check_out ? new Date(a.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td><span class="badge badge-${a.status === 'present' ? 'success' : a.status === 'late' ? 'warning' : a.status === 'absent' ? 'error' : 'neutral'}"><span class="badge-dot"></span>${esc(a.status)}</span></td>
                <td>${hasReg ? '<span class="badge badge-warning" style="font-size:10px">pending</span>' : ''}</td>
              </tr>`;
            }).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--color-text-tertiary)">No attendance records</td></tr>`}</tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">My Regularization Requests</span></div>
          <div class="card-body" style="max-height:400px;overflow:auto">
            ${myRegs.length ? myRegs.map(r => `
              <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:var(--space-3) 0;border-bottom:1px solid var(--color-border-light)">
                <div>
                  <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${formatDate(r.attendance?.date)}</div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">
                    ${r.requested_check_in ? 'In: ' + new Date(r.requested_check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : ''}
                    ${r.requested_check_out ? ' Out: ' + new Date(r.requested_check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(r.reason)}</div>
                </div>
                <span class="badge badge-${statusColors[r.status] || 'neutral'}"><span class="badge-dot"></span>${esc(r.status)}</span>
              </div>
            `).join('') : '<div style="padding:var(--space-4);text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm)">No regularization requests</div>'}
          </div>
        </div>
      </div>
    `;

    el.querySelectorAll('[data-regularize]').forEach(row => {
      row.addEventListener('click', () => showRegularizeModal(row.dataset.regularize));
    });
  }

  function showRegularizeModal(attendanceId) {
    const att = null;
    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div class="form-group">
          <label class="form-label">Corrected Check-in Time</label>
          <input type="datetime-local" class="form-input" id="reg-checkin">
        </div>
        <div class="form-group">
          <label class="form-label">Corrected Check-out Time</label>
          <input type="datetime-local" class="form-input" id="reg-checkout">
        </div>
        <div class="form-group">
          <label class="form-label">Reason <span style="color:var(--color-error)">*</span></label>
          <textarea class="form-input" id="reg-reason" rows="3" placeholder="Explain why the correction is needed..." required></textarea>
        </div>
        <button class="btn btn-primary" id="reg-submit">Submit Request</button>
      </div>`;
    openModal('Request Regularization', f);

    f.querySelector('#reg-submit').addEventListener('click', async () => {
      const reason = f.querySelector('#reg-reason').value.trim();
      if (!reason) { toast('Reason is required'); return; }

      const checkin = f.querySelector('#reg-checkin').value;
      const checkout = f.querySelector('#reg-checkout').value;
      if (!checkin && !checkout) { toast('Provide at least one corrected time'); return; }

      const btn = f.querySelector('#reg-submit');
      btn.disabled = true;
      btn.textContent = 'Submitting...';

      const { error } = await sb.from('attendance_regularizations').insert({
        org_id: org.id,
        user_id: user.id,
        attendance_id: attendanceId,
        reason,
        requested_check_in: checkin ? new Date(checkin).toISOString() : null,
        requested_check_out: checkout ? new Date(checkout).toISOString() : null,
      });

      if (error) {
        toast('Failed: ' + error.message);
        btn.disabled = false;
        btn.textContent = 'Submit Request';
        return;
      }

      await logAction('attendance', 'regularization', attendanceId, 'created', null, { reason, requested_check_in: checkin || null, requested_check_out: checkout || null });
      await publishEvent('attendance.regularization.requested', { attendance_id: attendanceId });
      closeModal();
      toast('Regularization request submitted');
      renderMyRequests(document.getElementById('reg-content'));
    });
  }

  async function renderPending(el) {
    el.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>`;

    const { data: pending, error: pendErr } = await sb
      .from('attendance_regularizations')
      .select('*, attendance:attendance_id(date, check_in, check_out, status), requester:user_id(full_name, email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (pendErr) { toast('Failed to load pending requests: ' + pendErr.message); return; }

    const items = pending || [];

    if (!items.length) {
      el.innerHTML = `<div class="card" style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No pending regularization requests</div>`;
      return;
    }

    el.innerHTML = `<div style="display:grid;gap:var(--space-3)">
      ${items.map(r => `
        <div class="card" style="padding:var(--space-4)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-4)">
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-2)">
                <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${avColor(r.requester?.full_name || '')};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold)">${initials(r.requester?.full_name || r.requester?.email || '?')}</div>
                <div>
                  <div style="font-weight:var(--font-weight-semibold)">${esc(r.requester?.full_name || r.requester?.email || '—')}</div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${formatDate(r.attendance?.date)}</div>
                </div>
              </div>
              <div style="font-size:var(--text-sm);color:var(--color-text-secondary);display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-bottom:var(--space-2)">
                <div>
                  <span style="color:var(--color-text-tertiary)">Current in:</span> ${r.attendance?.check_in ? new Date(r.attendance.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </div>
                <div>
                  <span style="color:var(--color-text-tertiary)">Current out:</span> ${r.attendance?.check_out ? new Date(r.attendance.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </div>
                <div>
                  <span style="color:var(--color-accent)">Requested in:</span> ${r.requested_check_in ? new Date(r.requested_check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </div>
                <div>
                  <span style="color:var(--color-accent)">Requested out:</span> ${r.requested_check_out ? new Date(r.requested_check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </div>
              </div>
              <div style="font-size:var(--text-sm);color:var(--color-text-tertiary)"><strong>Reason:</strong> ${esc(r.reason)}</div>
            </div>
            <div style="display:flex;gap:var(--space-2);flex-shrink:0">
              <button class="btn btn-primary btn-sm" data-approve-reg="${r.id}" data-uid="${r.user_id}" data-att-id="${r.attendance_id}" data-checkin="${r.requested_check_in || ''}" data-checkout="${r.requested_check_out || ''}">Approve</button>
              <button class="btn btn-danger btn-sm" data-reject-reg="${r.id}">Reject</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>`;

    el.querySelectorAll('[data-approve-reg]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const regId = btn.dataset.approveReg;
        const attId = btn.dataset.attId;

        const updateData = { status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() };
        const { error } = await sb.from('attendance_regularizations').update(updateData).eq('id', regId);
        if (error) { toast('Failed: ' + error.message); return; }

        const attUpdate = {};
        if (btn.dataset.checkin) attUpdate.check_in = btn.dataset.checkin;
        if (btn.dataset.checkout) attUpdate.check_out = btn.dataset.checkout;
        if (attUpdate.check_in || attUpdate.check_out) {
          attUpdate.status = 'present';
          if (attUpdate.check_in && attUpdate.check_out) {
            const diff = (new Date(attUpdate.check_out) - new Date(attUpdate.check_in)) / 3600000;
            attUpdate.total_hours = Math.round(diff * 100) / 100;
          }
          const { error: attErr } = await sb.from('attendance').update(attUpdate).eq('id', attId);
          if (attErr) { toast('Failed to update attendance: ' + attErr.message); return; }
        }

        await logAction('attendance', 'regularization', regId, 'approved', { status: 'pending' }, { status: 'approved' });
        await publishEvent('attendance.regularization.approved', { regularization_id: regId, user_id: btn.dataset.uid, org_id: org.id });
        toast('Regularization approved');
        renderPending(el);
      });
    });

    el.querySelectorAll('[data-reject-reg]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await sb.from('attendance_regularizations').update({
          status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
        }).eq('id', btn.dataset.rejectReg);
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('attendance', 'regularization', btn.dataset.rejectReg, 'rejected', { status: 'pending' }, { status: 'rejected' });
        await publishEvent('attendance.regularization.rejected', { regularization_id: btn.dataset.rejectReg });
        toast('Regularization rejected');
        renderPending(el);
      });
    });
  }

  renderTab();
}
