import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate, initials, avColor } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';
import { logAction } from '../../js/audit.js';

export default async function leaveModule(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);
  const currentYear = new Date().getFullYear();

  if (!org || !user) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Please log in</div></div>';
    return;
  }

  let currentTab = 'apply';
  let calMonth = new Date().getMonth();
  let calYear = new Date().getFullYear();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Leave</h1>
        <p class="page-subtitle">Manage leaves, balances, and approvals</p>
      </div>
      ${isManager ? '<a href="#/leave/settings" class="btn btn-secondary btn-sm">Leave Settings</a>' : ''}
    </div>

    <div id="leave-balances-row" style="margin-bottom:var(--space-4)">
      <div style="display:flex;gap:var(--space-3);overflow-x:auto;padding-bottom:var(--space-2)"></div>
    </div>

    <div class="tabs" id="leave-tabs">
      <button class="tab active" data-tab="apply">Apply</button>
      <button class="tab" data-tab="requests">My Requests</button>
      <button class="tab" data-tab="calendar">Team Calendar</button>
      ${isManager ? '<button class="tab" data-tab="approvals">Approvals</button>' : ''}
      ${isManager ? '<button class="tab" data-tab="report">Report</button>' : ''}
    </div>
    <div id="leave-content" style="margin-top:var(--space-3)">
      <div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>
    </div>
  `;

  // Load shared data
  const [typesResult, balResult, pendingResult] = await Promise.all([
    sb.from('leave_types').select('*').eq('is_active', true),
    sb.from('leave_balances').select('*, leave_type:leave_type_id(name, code, is_paid)').eq('user_id', user.id).eq('year', currentYear),
    sb.from('leave_requests').select('leave_type_id, days').eq('user_id', user.id).eq('status', 'pending'),
  ]);

  const leaveTypes = typesResult.data || [];
  const myBalances = balResult.data || [];
  const pendingByType = {};
  (pendingResult.data || []).forEach(p => {
    pendingByType[p.leave_type_id] = (pendingByType[p.leave_type_id] || 0) + parseFloat(p.days);
  });

  renderBalanceCards();

  document.getElementById('leave-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab || !tab.dataset.tab) return;
    document.querySelectorAll('#leave-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderTab();
  });

  function renderBalanceCards() {
    const row = document.querySelector('#leave-balances-row > div');
    if (!row) return;

    if (!myBalances.length) {
      row.innerHTML = '<div style="padding:var(--space-3);color:var(--color-text-tertiary);font-size:var(--text-sm)">No leave balances configured. Contact your admin.</div>';
      return;
    }

    row.innerHTML = myBalances.map(b => {
      const total = parseFloat(b.opening_balance || 0) + parseFloat(b.accrued || 0);
      const used = parseFloat(b.used || 0);
      const available = parseFloat(b.balance || 0);
      const pending = pendingByType[b.leave_type_id] || 0;
      const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
      const barColor = pct > 80 ? 'var(--color-error)' : pct > 50 ? 'var(--color-warning)' : 'var(--color-success)';

      return `<div class="leave-balance-card">
        <div class="leave-bal-header">
          <span class="leave-bal-code">${esc(b.leave_type?.code || '—')}</span>
          <span class="leave-bal-avail">${available}</span>
        </div>
        <div class="leave-bal-name">${esc(b.leave_type?.name || '—')}</div>
        <div class="leave-bal-bar">
          <div class="leave-bal-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <div class="leave-bal-meta">
          <span>Used ${used}/${total}</span>
          ${pending > 0 ? `<span style="color:var(--color-warning)">${pending} pending</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  renderTab();

  async function renderTab() {
    const el = document.getElementById('leave-content');
    if (currentTab === 'apply') renderApply(el);
    else if (currentTab === 'requests') await renderRequests(el);
    else if (currentTab === 'calendar') await renderCalendar(el);
    else if (currentTab === 'approvals') await renderApprovals(el);
    else if (currentTab === 'report') await renderReport(el);
  }

  function renderApply(el) {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Apply for Leave</span></div>
        <div class="card-body">
          <form id="leave-form" style="max-width:480px">
            <div class="form-group">
              <label class="form-label">Leave Type</label>
              <select class="form-input" id="leave-type" required>
                <option value="">Select type...</option>
                ${leaveTypes.map(t => {
                  const bal = myBalances.find(b => b.leave_type_id === t.id);
                  const avail = bal ? parseFloat(bal.balance || 0) : '—';
                  return `<option value="${t.id}">${esc(t.name)} (${esc(t.code)}) — ${avail} days left</option>`;
                }).join('')}
              </select>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
              <div class="form-group"><label class="form-label">Start Date</label><input type="date" class="form-input" id="leave-start" required></div>
              <div class="form-group"><label class="form-label">End Date</label><input type="date" class="form-input" id="leave-end" required></div>
            </div>
            <div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-3)">
              <div id="leave-days-preview" style="font-size:var(--text-sm);color:var(--color-text-secondary);flex:1"></div>
              <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);cursor:pointer;white-space:nowrap">
                <input type="checkbox" id="leave-half-day"> Half day
              </label>
            </div>
            <div class="form-group"><label class="form-label">Reason</label><textarea class="form-input" id="leave-reason" rows="3" placeholder="Optional reason..."></textarea></div>
            <div class="form-group" id="leave-doc-group" style="display:none">
              <label class="form-label">Attachment <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">(medical certificate, etc.)</span></label>
              <input type="file" class="form-input" id="leave-doc" accept=".pdf,.jpg,.jpeg,.png" style="padding:var(--space-2)">
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">Submit Request</button>
          </form>
        </div>
      </div>`;

    const startInput = el.querySelector('#leave-start');
    const endInput = el.querySelector('#leave-end');
    const preview = el.querySelector('#leave-days-preview');
    const halfDayCheck = el.querySelector('#leave-half-day');
    const typeSelect = el.querySelector('#leave-type');
    const docGroup = el.querySelector('#leave-doc-group');

    function countWorkingDays(start, end) {
      let count = 0;
      const d = new Date(start);
      const e = new Date(end);
      while (d <= e) {
        const day = d.getDay();
        if (day !== 0 && day !== 6) count++;
        d.setDate(d.getDate() + 1);
      }
      return count;
    }

    function updatePreview() {
      const s = startInput.value;
      const e = endInput.value;
      if (s && e) {
        const rawDays = (new Date(e) - new Date(s)) / 86400000 + 1;
        if (rawDays <= 0) { preview.textContent = 'End date must be after start date'; return; }
        let workDays = countWorkingDays(s, e);
        const isHalf = halfDayCheck.checked;
        if (isHalf && s === e) workDays = 0.5;
        else if (isHalf) workDays = Math.max(0.5, workDays - 0.5);
        const skipped = rawDays - (isHalf ? workDays : countWorkingDays(s, e));
        preview.innerHTML = `<strong>${workDays}</strong> working day${workDays !== 1 ? 's' : ''}` +
          (skipped > 0 ? ` <span style="color:var(--color-text-tertiary)">(${skipped} weekend${skipped > 1 ? 's' : ''} excluded)</span>` : '');
      } else {
        preview.textContent = '';
      }
    }
    startInput.addEventListener('change', updatePreview);
    endInput.addEventListener('change', updatePreview);
    halfDayCheck.addEventListener('change', () => {
      if (halfDayCheck.checked) endInput.value = startInput.value;
      endInput.disabled = halfDayCheck.checked;
      updatePreview();
    });

    typeSelect.addEventListener('change', () => {
      const lt = leaveTypes.find(t => t.id === typeSelect.value);
      docGroup.style.display = lt?.requires_document ? 'block' : 'none';
    });

    el.querySelector('#leave-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const leaveTypeId = typeSelect.value;
      const startDate = startInput.value;
      const endDate = halfDayCheck.checked ? startDate : endInput.value;
      if (!leaveTypeId) return toast('Select a leave type');
      const rawDays = (new Date(endDate) - new Date(startDate)) / 86400000 + 1;
      if (rawDays <= 0) return toast('End date must be after start date');
      let days = countWorkingDays(startDate, endDate);
      if (halfDayCheck.checked) days = 0.5;
      if (days <= 0) return toast('No working days in selected range');

      const submitBtn = el.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';

      let documentUrl = null;
      const docFile = el.querySelector('#leave-doc')?.files?.[0];
      if (docFile) {
        const path = `leave-docs/${org.id}/${user.id}/${Date.now()}_${docFile.name}`;
        const { error: upErr } = await sb.storage.from('documents').upload(path, docFile);
        if (upErr) { toast('File upload failed: ' + upErr.message); submitBtn.disabled = false; submitBtn.textContent = 'Submit Request'; return; }
        documentUrl = path;
      }

      const { data, error } = await sb.from('leave_requests').insert({
        org_id: org.id, user_id: user.id, leave_type_id: leaveTypeId,
        start_date: startDate, end_date: endDate, days,
        reason: el.querySelector('#leave-reason').value || null,
        document_url: documentUrl,
      }).select().single();

      if (error) {
        toast(error.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Request';
        return;
      }

      await logAction('leave', 'leave_request', data.id, 'created', null, { start_date: startDate, end_date: endDate, days });
      await publishEvent('leave.request.created', { leave_request_id: data.id, user_id: user.id, org_id: org.id });
      toast('Leave request submitted!');
      e.target.reset();
      preview.textContent = '';
      halfDayCheck.checked = false;
      endInput.disabled = false;
      docGroup.style.display = 'none';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Request';

      pendingByType[leaveTypeId] = (pendingByType[leaveTypeId] || 0) + days;
      renderBalanceCards();
    });
  }

  async function renderRequests(el) {
    el.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>';
    const { data: requests, error } = await sb.from('leave_requests')
      .select('*, leave_type:leave_type_id(name, code)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) return toast('Failed: ' + error.message);

    if (!requests?.length) {
      el.innerHTML = '<div class="card"><div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No leave requests yet. Use the Apply tab to submit one.</div></div>';
      return;
    }

    const statusColors = { pending: 'warning', approved: 'success', rejected: 'error', cancelled: 'neutral' };

    el.innerHTML = `<div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th><th></th></tr></thead>
      <tbody>${requests.map(r => `<tr>
        <td><span class="badge badge-neutral">${esc(r.leave_type?.code || '—')}</span> ${esc(r.leave_type?.name || '')}</td>
        <td>${formatDate(r.start_date)}</td>
        <td>${formatDate(r.end_date)}</td>
        <td>${r.days}</td>
        <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.reason || '—')}</td>
        <td><span class="badge badge-${statusColors[r.status] || 'neutral'}"><span class="badge-dot"></span>${r.status}</span></td>
        <td>${r.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-cancel="${r.id}">Cancel</button>` : (r.review_comment ? `<span style="font-size:var(--text-xs);color:var(--color-text-tertiary)" title="${esc(r.review_comment)}">Note</span>` : '')}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;

    el.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await sb.from('leave_requests').update({ status: 'cancelled' }).eq('id', btn.dataset.cancel);
        if (error) return toast('Failed: ' + error.message);
        await logAction('leave', 'leave_request', btn.dataset.cancel, 'cancelled', { status: 'pending' }, { status: 'cancelled' });
        toast('Leave request cancelled');
        renderRequests(el);
      });
    });
  }

  async function renderCalendar(el) {
    el.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>';

    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const startDate = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-01`;
    const endDate = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const [{ data: leaves }, { data: holidays }] = await Promise.all([
      sb.from('leave_requests')
        .select('*, requester:user_id(full_name, email), leave_type:leave_type_id(name, code)')
        .eq('status', 'approved').lte('start_date', endDate).gte('end_date', startDate),
      sb.from('holidays').select('name, date').eq('year', calYear).gte('date', startDate).lte('date', endDate),
    ]);

    const holidayMap = {};
    (holidays || []).forEach(h => { holidayMap[h.date] = h.name; });

    const people = {};
    (leaves || []).forEach(l => {
      const name = l.requester?.full_name || l.requester?.email || 'Unknown';
      if (!people[name]) people[name] = {};
      const s = new Date(l.start_date);
      const e = new Date(l.end_date);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) people[name][ds] = l.leave_type?.code || '?';
      }
    });

    const monthLabel = new Date(calYear, calMonth).toLocaleString('en', { month: 'long', year: 'numeric' });

    el.innerHTML = `<div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <span class="card-title">Team Calendar</span>
        <div style="display:flex;align-items:center;gap:var(--space-3)">
          <button class="btn btn-ghost btn-sm" id="cal-prev">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span style="font-weight:var(--font-weight-semibold);min-width:140px;text-align:center">${monthLabel}</span>
          <button class="btn btn-ghost btn-sm" id="cal-next">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
      <div style="overflow-x:auto">
        ${Object.keys(people).length || Object.keys(holidayMap).length ? `<table class="table" style="font-size:var(--text-xs)">
          <thead><tr>
            <th style="position:sticky;left:0;background:var(--color-surface);z-index:1;min-width:120px">Employee</th>
            ${Array.from({ length: daysInMonth }, (_, i) => {
              const d = i + 1;
              const dt = new Date(calYear, calMonth, d);
              const day = dt.toLocaleDateString('en', { weekday: 'short' }).charAt(0);
              const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
              const isHol = !!holidayMap[dateStr];
              return `<th style="padding:4px;text-align:center;min-width:28px;${isWeekend || isHol ? 'background:var(--color-bg-tertiary);' : ''}" title="${isHol ? holidayMap[dateStr] : ''}">${d}<br>${day}</th>`;
            }).join('')}
          </tr></thead>
          <tbody>
            ${Object.entries(people).map(([name, dates]) => `<tr>
              <td style="position:sticky;left:0;background:var(--color-surface);z-index:1;white-space:nowrap;font-weight:var(--font-weight-medium)">
                <div style="display:flex;align-items:center;gap:var(--space-1)">
                  <div style="width:20px;height:20px;border-radius:var(--radius-full);background:${avColor(name)};display:flex;align-items:center;justify-content:center;color:white;font-size:8px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(name)}</div>
                  ${esc(name)}
                </div>
              </td>
              ${Array.from({ length: daysInMonth }, (_, i) => {
                const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
                const code = dates[dateStr];
                const isHol = !!holidayMap[dateStr];
                const bg = code ? 'var(--color-accent-light)' : isHol ? 'var(--color-warning-light)' : '';
                return `<td style="padding:4px;text-align:center;${bg ? 'background:' + bg + ';' : ''}">${code || (isHol ? 'H' : '')}</td>`;
              }).join('')}
            </tr>`).join('')}
          </tbody>
        </table>` : '<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No approved leaves this month</div>'}
      </div>
    </div>`;

    el.querySelector('#cal-prev')?.addEventListener('click', () => {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar(el);
    });
    el.querySelector('#cal-next')?.addEventListener('click', () => {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar(el);
    });
  }

  async function renderApprovals(el) {
    el.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>';

    const { data: pending, error } = await sb.from('leave_requests')
      .select('*, leave_type:leave_type_id(name, code), requester:user_id(full_name, email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) return toast('Failed: ' + error.message);

    if (!pending?.length) {
      el.innerHTML = `<div class="card"><div style="padding:var(--space-6);text-align:center">
        <div style="color:var(--color-success);margin-bottom:var(--space-2)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <div style="font-weight:var(--font-weight-semibold);color:var(--color-text-primary)">All caught up</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">No pending leave requests to review.</div>
      </div></div>`;
      return;
    }

    el.innerHTML = `<div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Actions</th></tr></thead>
      <tbody>${pending.map(r => `<tr>
        <td>
          <div style="display:flex;align-items:center;gap:var(--space-2)">
            <div style="width:28px;height:28px;border-radius:var(--radius-full);background:${avColor(r.requester?.full_name || '')};display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(r.requester?.full_name || r.requester?.email || '?')}</div>
            <span style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(r.requester?.full_name || r.requester?.email || '—')}</span>
          </div>
        </td>
        <td><span class="badge badge-neutral">${esc(r.leave_type?.code || '—')}</span></td>
        <td>${formatDate(r.start_date)}</td>
        <td>${formatDate(r.end_date)}</td>
        <td>${r.days}</td>
        <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-sm)">${esc(r.reason || '—')}</td>
        <td>
          <div style="display:flex;gap:var(--space-1)">
            <button class="btn btn-primary btn-sm" data-approve="${r.id}" data-uid="${r.user_id}" data-ltid="${r.leave_type_id}" data-days="${r.days}">Approve</button>
            <button class="btn btn-secondary btn-sm" data-reject="${r.id}" data-uid="${r.user_id}">Reject</button>
          </div>
        </td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;

    el.querySelectorAll('[data-approve]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const id = btn.dataset.approve;
        const { error } = await sb.from('leave_requests').update({
          status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) { toast(error.message); btn.disabled = false; return; }
        await logAction('leave', 'leave_request', id, 'approved', { status: 'pending' }, { status: 'approved' });
        await publishEvent('leave.request.approved', { leave_request_id: id, user_id: btn.dataset.uid, org_id: org.id, days: btn.dataset.days, leave_type_id: btn.dataset.ltid, approved_by: user.id });
        toast('Leave approved');
        renderApprovals(el);
      });
    });

    el.querySelectorAll('[data-reject]').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = document.createElement('div');
        f.innerHTML = `<div style="display:grid;gap:var(--space-3)">
          <div class="form-group"><label class="form-label">Rejection Reason</label><textarea class="form-input" id="rej-reason" rows="3" placeholder="Optional reason..."></textarea></div>
          <button class="btn btn-primary" id="rej-confirm">Reject Leave</button>
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
          renderApprovals(el);
        });
      });
    });
  }

  async function renderReport(el) {
    el.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading...</div>';

    const year = currentYear;
    const [{ data: requests }, { data: balances }] = await Promise.all([
      sb.from('leave_requests')
        .select('*, user:user_id(full_name, email), leave_type:leave_type_id(name, code)')
        .gte('start_date', `${year}-01-01`).lte('start_date', `${year}-12-31`).order('start_date'),
      sb.from('leave_balances')
        .select('*, user:user_id(full_name, email), leave_type:leave_type_id(name, code)')
        .eq('year', year),
    ]);

    const allRequests = requests || [];
    const allBalances = balances || [];

    const byUser = {};
    allBalances.forEach(b => {
      const uid = b.user_id;
      if (!byUser[uid]) byUser[uid] = { name: b.user?.full_name || b.user?.email || 'Unknown', types: {}, totalUsed: 0, totalBalance: 0 };
      const code = b.leave_type?.code || b.leave_type?.name || '—';
      byUser[uid].types[code] = { total: parseFloat(b.opening_balance || 0) + parseFloat(b.accrued || 0), used: parseFloat(b.used || 0), balance: parseFloat(b.balance || 0) };
      byUser[uid].totalUsed += parseFloat(b.used || 0);
      byUser[uid].totalBalance += parseFloat(b.balance || 0);
    });

    const reportData = Object.values(byUser);
    const leaveTypeCodes = [...new Set(allBalances.map(b => b.leave_type?.code || b.leave_type?.name).filter(Boolean))];

    const approved = allRequests.filter(r => r.status === 'approved').length;
    const pendingCount = allRequests.filter(r => r.status === 'pending').length;
    const rejected = allRequests.filter(r => r.status === 'rejected').length;

    el.innerHTML = `<div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2)">
        <span class="card-title">Leave Report — ${year}</span>
        <button class="btn btn-secondary btn-sm" id="lr-export">Export CSV</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:var(--space-3);padding:var(--space-4)">
        <div class="att-mini-stat"><div class="att-mini-stat-value">${allRequests.length}</div><div class="att-mini-stat-label">Total</div></div>
        <div class="att-mini-stat"><div class="att-mini-stat-value" style="color:var(--color-success)">${approved}</div><div class="att-mini-stat-label">Approved</div></div>
        <div class="att-mini-stat"><div class="att-mini-stat-value" style="color:var(--color-warning)">${pendingCount}</div><div class="att-mini-stat-label">Pending</div></div>
        <div class="att-mini-stat"><div class="att-mini-stat-value" style="color:var(--color-error)">${rejected}</div><div class="att-mini-stat-label">Rejected</div></div>
      </div>
      ${reportData.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Employee</th>${leaveTypeCodes.map(c => `<th style="text-align:center">${esc(c)}</th>`).join('')}<th style="text-align:center">Used</th><th style="text-align:center">Balance</th></tr></thead>
        <tbody>${reportData.map(u => `<tr>
          <td>
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <div style="width:24px;height:24px;border-radius:var(--radius-full);background:${avColor(u.name)};display:flex;align-items:center;justify-content:center;color:white;font-size:8px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(u.name)}</div>
              <span style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(u.name)}</span>
            </div>
          </td>
          ${leaveTypeCodes.map(c => {
            const t = u.types[c];
            return `<td style="text-align:center">${t ? `<span style="color:var(--color-error)">${t.used}</span>/${t.total}` : '—'}</td>`;
          }).join('')}
          <td style="text-align:center;font-weight:var(--font-weight-semibold);color:var(--color-error)">${u.totalUsed}</td>
          <td style="text-align:center;font-weight:var(--font-weight-semibold);color:var(--color-success)">${u.totalBalance}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No leave data for this year</div>'}
    </div>`;

    el.querySelector('#lr-export')?.addEventListener('click', () => {
      if (!reportData.length) return;
      const headers = 'Employee,Total Used,Total Balance\n';
      const rows = reportData.map(u => `"${u.name}",${u.totalUsed},${u.totalBalance}`).join('\n');
      const blob = new Blob([headers + rows], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `leave_report_${year}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }
}
