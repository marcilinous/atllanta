import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, formatDate, initials, avColor, openModal } from '../../js/ui.js';

export default async function leaveReport(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  if (!org || !user) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Please log in</div></div>';
    return;
  }

  if (!isManager) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Access Denied</div><div class="empty-state-text">Leave reports are available for managers and admins.</div></div>';
    return;
  }

  const now = new Date();
  let reportYear = now.getFullYear();
  let reportMonth = now.getMonth();
  let viewMode = 'monthly';
  let filterDept = '';
  let filterType = '';

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Leave Report</h1>
        <p class="page-subtitle">Employee leave usage breakdown</p>
      </div>
      <div style="display:flex;gap:var(--space-2);align-items:center">
        <a href="#/leave" class="btn btn-secondary btn-sm">Leave Dashboard</a>
        <a href="#/leave/balances" class="btn btn-secondary btn-sm">Balances</a>
      </div>
    </div>

    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card-body" style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center">
        <div class="tabs" style="margin:0;border:0">
          <button class="tab active" data-mode="monthly">Monthly</button>
          <button class="tab" data-mode="yearly">Yearly</button>
        </div>
        <div style="display:flex;gap:var(--space-2);align-items:center" id="period-nav">
          <button class="btn btn-secondary btn-sm" id="rpt-prev">&larr;</button>
          <span style="font-weight:var(--font-weight-semibold);min-width:130px;text-align:center" id="rpt-period-label"></span>
          <button class="btn btn-secondary btn-sm" id="rpt-next">&rarr;</button>
        </div>
        <select class="form-input form-input-sm" id="rpt-dept" style="min-width:150px">
          <option value="">All Departments</option>
        </select>
        <select class="form-input form-input-sm" id="rpt-type" style="min-width:150px">
          <option value="">All Leave Types</option>
        </select>
        <button class="btn btn-secondary btn-sm" id="rpt-export">Export CSV</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card-header"><span class="card-title">Summary</span></div>
      <div class="card-body" id="rpt-summary">
        <div class="skeleton skeleton-text"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Employee-wise Breakdown</span></div>
      <div id="rpt-table">
        <div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div></div>
      </div>
    </div>
  `;

  const [deptResult, typeResult] = await Promise.all([
    sb.from('departments').select('id, name').order('name'),
    sb.from('leave_types').select('id, name, code').eq('is_active', true).order('name'),
  ]);

  const depts = deptResult.data || [];
  const leaveTypes = typeResult.data || [];

  const deptSelect = document.getElementById('rpt-dept');
  depts.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    deptSelect.appendChild(opt);
  });

  const typeSelect = document.getElementById('rpt-type');
  leaveTypes.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.name} (${t.code})`;
    typeSelect.appendChild(opt);
  });

  let reportData = [];

  function getDateRange() {
    if (viewMode === 'monthly') {
      const start = new Date(reportYear, reportMonth, 1);
      const end = new Date(reportYear, reportMonth + 1, 0);
      return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
        label: `${MONTHS[reportMonth]} ${reportYear}`,
      };
    }
    return {
      start: `${reportYear}-01-01`,
      end: `${reportYear}-12-31`,
      label: `${reportYear}`,
    };
  }

  function updatePeriodLabel() {
    const range = getDateRange();
    document.getElementById('rpt-period-label').textContent = range.label;
  }

  async function loadReport() {
    updatePeriodLabel();
    const range = getDateRange();
    const summaryEl = document.getElementById('rpt-summary');
    const tableEl = document.getElementById('rpt-table');
    summaryEl.innerHTML = '<div class="skeleton skeleton-text"></div>';
    tableEl.innerHTML = '<div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div></div>';

    let reqQuery = sb.from('leave_requests')
      .select('id, user_id, leave_type_id, start_date, end_date, days, status, created_at, user:user_id(full_name, email, department_id, department:department_id(name)), leave_type:leave_type_id(name, code)')
      .gte('start_date', range.start)
      .lte('start_date', range.end);

    if (filterType) reqQuery = reqQuery.eq('leave_type_id', filterType);

    const { data: requests, error } = await reqQuery;
    if (error) { summaryEl.innerHTML = `<div style="color:var(--color-error)">${esc(error.message)}</div>`; return; }

    let filtered = requests || [];
    if (filterDept) {
      filtered = filtered.filter(r => r.user?.department_id === filterDept);
    }

    const totalRequests = filtered.length;
    const approved = filtered.filter(r => r.status === 'approved');
    const pending = filtered.filter(r => r.status === 'pending');
    const rejected = filtered.filter(r => r.status === 'rejected');
    const totalDays = approved.reduce((s, r) => s + parseFloat(r.days || 0), 0);
    const pendingDays = pending.reduce((s, r) => s + parseFloat(r.days || 0), 0);

    const byType = {};
    approved.forEach(r => {
      const code = r.leave_type?.code || '?';
      byType[code] = (byType[code] || 0) + parseFloat(r.days || 0);
    });

    summaryEl.innerHTML = `<div style="display:flex;gap:var(--space-4);flex-wrap:wrap">
      <div style="text-align:center;min-width:100px">
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-accent)">${totalRequests}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Total Requests</div>
      </div>
      <div style="text-align:center;min-width:100px">
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-success)">${approved.length}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Approved</div>
      </div>
      <div style="text-align:center;min-width:100px">
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-warning)">${pending.length}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Pending</div>
      </div>
      <div style="text-align:center;min-width:100px">
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-error)">${rejected.length}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Rejected</div>
      </div>
      <div style="border-left:1px solid var(--color-border);padding-left:var(--space-4)">
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold)">${totalDays}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Days Taken</div>
      </div>
      ${pendingDays > 0 ? `<div>
        <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-warning)">${pendingDays}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Days Pending</div>
      </div>` : ''}
    </div>
    ${Object.keys(byType).length > 0 ? `<div style="margin-top:var(--space-3);display:flex;gap:var(--space-2);flex-wrap:wrap">
      ${Object.entries(byType).sort((a,b) => b[1] - a[1]).map(([code, days]) =>
        `<span class="badge badge-info">${esc(code)}: ${days} days</span>`
      ).join('')}
    </div>` : ''}`;

    const byEmployee = {};
    filtered.forEach(r => {
      const uid = r.user_id;
      if (!byEmployee[uid]) {
        byEmployee[uid] = {
          name: r.user?.full_name || '—',
          dept: r.user?.department?.name || '—',
          requests: [],
          byType: {},
          totalDays: 0,
          approvedDays: 0,
          pendingDays: 0,
        };
      }
      const emp = byEmployee[uid];
      emp.requests.push(r);
      const code = r.leave_type?.code || '?';
      if (r.status === 'approved') {
        emp.byType[code] = (emp.byType[code] || 0) + parseFloat(r.days || 0);
        emp.approvedDays += parseFloat(r.days || 0);
      }
      if (r.status === 'pending') {
        emp.pendingDays += parseFloat(r.days || 0);
      }
      emp.totalDays += parseFloat(r.days || 0);
    });

    const employees = Object.entries(byEmployee)
      .map(([uid, data]) => ({ uid, ...data }))
      .sort((a, b) => b.approvedDays - a.approvedDays);

    reportData = employees;

    const allCodes = [...new Set(filtered.map(r => r.leave_type?.code).filter(Boolean))].sort();

    if (!employees.length) {
      tableEl.innerHTML = '<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary)">No leave requests found for this period.</div>';
      return;
    }

    tableEl.innerHTML = `<div class="table-wrap"><table class="table" style="font-size:var(--text-sm)">
      <thead><tr>
        <th style="position:sticky;left:0;background:var(--color-bg-secondary);z-index:2;min-width:180px">Employee</th>
        <th>Department</th>
        ${allCodes.map(c => `<th style="text-align:center">${esc(c)}</th>`).join('')}
        <th style="text-align:center">Approved</th>
        <th style="text-align:center">Pending</th>
        <th style="text-align:center">Total</th>
        <th style="text-align:center">Requests</th>
      </tr></thead>
      <tbody>${employees.map(emp => `<tr>
        <td style="position:sticky;left:0;background:var(--color-surface);z-index:1">
          <div style="display:flex;align-items:center;gap:var(--space-2)">
            <div style="width:24px;height:24px;border-radius:var(--radius-full);background:${avColor(emp.name)};display:flex;align-items:center;justify-content:center;color:white;font-size:8px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(emp.name)}</div>
            <span style="font-weight:var(--font-weight-medium)">${esc(emp.name)}</span>
          </div>
        </td>
        <td style="color:var(--color-text-secondary);font-size:var(--text-xs)">${esc(emp.dept)}</td>
        ${allCodes.map(c => {
          const d = emp.byType[c];
          return `<td style="text-align:center">${d ? `<span style="font-weight:var(--font-weight-semibold)">${d}</span>` : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>`;
        }).join('')}
        <td style="text-align:center;font-weight:var(--font-weight-semibold);color:var(--color-success)">${emp.approvedDays}</td>
        <td style="text-align:center;font-weight:var(--font-weight-semibold);color:${emp.pendingDays > 0 ? 'var(--color-warning)' : 'var(--color-text-tertiary)'}">${emp.pendingDays || '—'}</td>
        <td style="text-align:center;font-weight:var(--font-weight-bold)">${emp.totalDays}</td>
        <td style="text-align:center">
          <button class="btn btn-ghost btn-sm" data-detail="${emp.uid}" style="font-size:var(--text-xs)">View ${emp.requests.length}</button>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>`;

    tableEl.querySelectorAll('[data-detail]').forEach(btn => {
      btn.addEventListener('click', () => showEmployeeDetail(btn.dataset.detail));
    });
  }

  function showEmployeeDetail(uid) {
    const emp = reportData.find(e => e.uid === uid);
    if (!emp) return;
    const range = getDateRange();

    const detailEl = document.createElement('div');
    detailEl.innerHTML = `
      <div style="margin-bottom:var(--space-3);font-weight:var(--font-weight-medium)">${esc(emp.name)} — ${esc(range.label)}</div>
      <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-4)">
        <div style="text-align:center"><div style="font-size:var(--text-lg);font-weight:var(--font-weight-bold);color:var(--color-success)">${emp.approvedDays}</div><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Approved</div></div>
        <div style="text-align:center"><div style="font-size:var(--text-lg);font-weight:var(--font-weight-bold);color:var(--color-warning)">${emp.pendingDays}</div><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Pending</div></div>
        <div style="text-align:center"><div style="font-size:var(--text-lg);font-weight:var(--font-weight-bold)">${emp.requests.length}</div><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Requests</div></div>
      </div>
      <div class="table-wrap"><table class="table" style="font-size:var(--text-sm)">
        <thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th></tr></thead>
        <tbody>${emp.requests.sort((a,b) => a.start_date > b.start_date ? 1 : -1).map(r => {
          const statusColors = { approved: 'var(--color-success)', pending: 'var(--color-warning)', rejected: 'var(--color-error)', cancelled: 'var(--color-text-tertiary)' };
          return `<tr>
            <td><span class="badge badge-info">${esc(r.leave_type?.code || '—')}</span></td>
            <td>${formatDate(r.start_date)}</td>
            <td>${formatDate(r.end_date)}</td>
            <td>${r.days}</td>
            <td><span style="color:${statusColors[r.status] || ''};font-weight:var(--font-weight-medium);text-transform:capitalize">${r.status}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    `;

    openModal('Leave Details', detailEl);
  }

  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      viewMode = btn.dataset.mode;
      loadReport();
    });
  });

  document.getElementById('rpt-prev').addEventListener('click', () => {
    if (viewMode === 'monthly') {
      reportMonth--;
      if (reportMonth < 0) { reportMonth = 11; reportYear--; }
    } else {
      reportYear--;
    }
    loadReport();
  });

  document.getElementById('rpt-next').addEventListener('click', () => {
    if (viewMode === 'monthly') {
      reportMonth++;
      if (reportMonth > 11) { reportMonth = 0; reportYear++; }
    } else {
      reportYear++;
    }
    loadReport();
  });

  deptSelect.addEventListener('change', () => { filterDept = deptSelect.value; loadReport(); });
  typeSelect.addEventListener('change', () => { filterType = typeSelect.value; loadReport(); });

  document.getElementById('rpt-export').addEventListener('click', () => {
    if (!reportData.length) return toast('No data to export');
    const range = getDateRange();
    const allCodes = [...new Set(reportData.flatMap(e => Object.keys(e.byType)))].sort();
    const headers = ['Employee', 'Department', ...allCodes.map(c => `${c} Days`), 'Approved Days', 'Pending Days', 'Total Days', 'Total Requests'].join(',');
    const rows = reportData.map(emp => [
      `"${emp.name}"`,
      `"${emp.dept}"`,
      ...allCodes.map(c => emp.byType[c] || 0),
      emp.approvedDays,
      emp.pendingDays,
      emp.totalDays,
      emp.requests.length,
    ].join(',')).join('\n');
    const blob = new Blob([headers + '\n' + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `leave_report_${range.label.replace(/\s/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  await loadReport();
}
