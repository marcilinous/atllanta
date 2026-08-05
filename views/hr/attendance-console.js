import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, loadingSkeleton, initials, avColor, downloadCsv } from '../../js/ui.js';

const ATT_BUCKET = 'attendance-selfies';
const thumbOf = (p) => p ? p.replace(/\.jpg$/, '_thumb.jpg') : p;
const STATUS_BADGE = { present: 'success', late: 'warning', absent: 'error', on_leave: 'info', half_day: 'warning', holiday: 'neutral', weekly_off: 'neutral' };
const HR_LABEL = { exec: 'HR Executive', manager: 'HR Manager', head: 'HR Head' };

export default async function hrAttendanceConsole(container) {
  const org = getOrg();
  const user = getUser();
  const m = getMembership();
  const isOrgAdmin = m && ['owner', 'admin'].includes(m.role);
  const hrLevel = m?.hr_level && m.hr_level !== 'none' ? m.hr_level : null;
  const canApprove = isOrgAdmin || ['manager', 'head'].includes(m?.hr_level);

  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }
  if (!isOrgAdmin && !hrLevel) {
    container.innerHTML = `<div style="margin-bottom:var(--space-4)"><a href="#/attendance" class="btn btn-ghost btn-sm">← Attendance</a></div>
      <div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">HR access required</div>
      <div class="empty-state-desc">This console is for HR staff. Ask an admin to grant you HR access under Staff & Access.</div></div>`;
    return;
  }

  const scopeDeptId = (['exec', 'manager'].includes(m?.hr_level) && m.hr_scope_department_id) ? m.hr_scope_department_id : null;
  const todayStr = new Date().toISOString().split('T')[0];
  let date = todayStr;
  let deptFilter = '';
  let statusFilter = '';
  let search = '';

  let departments = [], deptById = {};
  let users = [];
  let locById = {};
  let attByUser = {};
  let signed = {};

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><a href="#/attendance" class="btn btn-ghost btn-sm">← Attendance</a></div>
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">HR attendance console</h1>
        <p class="page-subtitle">${isOrgAdmin ? 'Org admin' : esc(HR_LABEL[hrLevel] || 'HR')}${scopeDeptId ? ' · scoped to your department' : ' · whole organization'} — verify punches, selfies and locations.</p>
      </div>
      ${canApprove ? `<div style="display:flex;gap:var(--space-2)"><a href="#/leave/approvals" class="btn btn-secondary btn-sm">Leave approvals</a><a href="#/attendance/regularize" class="btn btn-secondary btn-sm">Regularizations</a></div>` : ''}
    </div>

    <div id="hr-kpi" class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:var(--space-3);margin-bottom:var(--space-4)"></div>

    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
        <input type="date" class="form-input" id="hr-date" value="${date}" style="max-width:170px;height:34px">
        <select class="form-input" id="hr-dept" style="max-width:200px;height:34px"><option value="">All departments</option></select>
        <select class="form-input" id="hr-status" style="max-width:160px;height:34px">
          <option value="">All statuses</option>
          <option value="present">Present</option>
          <option value="late">Late</option>
          <option value="on_leave">On leave</option>
          <option value="absent">Absent</option>
          <option value="none">Not marked</option>
        </select>
        <input type="text" class="form-input" id="hr-search" placeholder="Search employee" style="max-width:200px;height:34px;flex:1">
        <button class="btn btn-secondary btn-sm" id="hr-export">Export CSV</button>
      </div>
      <div id="hr-table">${loadingSkeleton(6)}</div>
    </div>
  `;

  // Static data (departments + roster) load once.
  const [{ data: depts }, { data: allUsers }, { data: locs }] = await Promise.all([
    sb.from('departments').select('id, name').eq('org_id', org.id).order('name'),
    sb.from('users').select('id, full_name, email, department_id, status').eq('org_id', org.id),
    sb.from('work_locations').select('id, name').eq('org_id', org.id),
  ]);
  departments = depts || [];
  deptById = Object.fromEntries(departments.map(d => [d.id, d.name]));
  locById = Object.fromEntries((locs || []).map(l => [l.id, l.name]));
  users = (allUsers || []).filter(u => u.status !== 'exited');
  if (scopeDeptId) users = users.filter(u => u.department_id === scopeDeptId);

  const deptSel = container.querySelector('#hr-dept');
  deptSel.innerHTML = `<option value="">All departments</option>` +
    departments.filter(d => !scopeDeptId || d.id === scopeDeptId).map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('') +
    `<option value="__none__">No department</option>`;

  async function loadDay() {
    const el = container.querySelector('#hr-table');
    el.innerHTML = loadingSkeleton(6);
    const { data: att } = await sb.from('attendance').select('*').eq('date', date);
    attByUser = Object.fromEntries((att || []).map(a => [a.user_id, a]));

    // Sign selfie thumbnails for this day (batch).
    const paths = [];
    (att || []).forEach(a => { if (a.check_in_selfie_path) paths.push(thumbOf(a.check_in_selfie_path)); if (a.check_out_selfie_path) paths.push(thumbOf(a.check_out_selfie_path)); });
    signed = {};
    if (paths.length) {
      const { data: urls } = await sb.storage.from(ATT_BUCKET).createSignedUrls(paths, 3600);
      (urls || []).forEach(u => { if (u.signedUrl) signed[u.path] = u.signedUrl; });
    }
    renderKpi();
    renderTable();
  }

  function rosterRows() {
    return users.map(u => ({ u, a: attByUser[u.id] || null }))
      .filter(({ u }) => {
        if (deptFilter === '__none__') { if (u.department_id) return false; }
        else if (deptFilter && u.department_id !== deptFilter) return false;
        if (search) {
          const s = search.toLowerCase();
          if (!(u.full_name || '').toLowerCase().includes(s) && !(u.email || '').toLowerCase().includes(s)) return false;
        }
        if (statusFilter) {
          if (statusFilter === 'none') return !attByUser[u.id];
          if ((attByUser[u.id]?.status || '') !== statusFilter) return false;
        }
        return true;
      });
  }

  function renderKpi() {
    const present = users.filter(u => ['present', 'late'].includes(attByUser[u.id]?.status)).length;
    const late = users.filter(u => attByUser[u.id]?.status === 'late').length;
    const onLeave = users.filter(u => attByUser[u.id]?.status === 'on_leave').length;
    const notMarked = users.filter(u => !attByUser[u.id]).length;
    const kpi = (l, v, c) => `<div class="card" style="padding:var(--space-4)"><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${l}</div><div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);${c ? `color:${c}` : ''}">${v}</div></div>`;
    container.querySelector('#hr-kpi').innerHTML =
      kpi('Employees', users.length, '') +
      kpi('Present', present, 'var(--color-success)') +
      kpi('Late', late, 'var(--color-warning)') +
      kpi('On leave', onLeave, 'var(--color-info)') +
      kpi('Not marked', notMarked, 'var(--color-error)');
  }

  function selfieCell(a) {
    const parts = [];
    if (a?.check_in_selfie_path && signed[thumbOf(a.check_in_selfie_path)]) parts.push(['Check-in', a.check_in_selfie_path]);
    if (a?.check_out_selfie_path && signed[thumbOf(a.check_out_selfie_path)]) parts.push(['Check-out', a.check_out_selfie_path]);
    if (!parts.length) return '<span style="color:var(--color-text-tertiary)">—</span>';
    return `<div style="display:flex;gap:4px">${parts.map(([label, full]) =>
      `<img src="${signed[thumbOf(full)]}" data-full="${esc(full)}" class="hr-selfie" title="${label}" style="width:32px;height:32px;object-fit:cover;border-radius:var(--radius-sm);cursor:pointer;border:1px solid var(--color-border)">`).join('')}</div>`;
  }

  const time = (t) => t ? new Date(t).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—';

  function renderTable() {
    const rows = rosterRows();
    const el = container.querySelector('#hr-table');
    if (!rows.length) { el.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">No employees match</div></div>`; return; }
    el.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Employee</th><th>Department</th><th>In</th><th>Out</th><th>Hours</th><th>Location</th><th>Status</th><th>Selfie</th></tr></thead>
      <tbody>${rows.map(({ u, a }) => {
        const loc = a?.check_in_location_id ? locById[a.check_in_location_id] : null;
        const status = a?.status || 'not marked';
        return `<tr>
          <td><div style="display:flex;align-items:center;gap:var(--space-2)">
            <div style="width:28px;height:28px;border-radius:var(--radius-full);background:${avColor(u.full_name || u.email || '')};display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(u.full_name || u.email || '?')}</div>
            <span style="font-size:var(--text-sm)">${esc(u.full_name || u.email || '—')}</span></div></td>
          <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${u.department_id ? esc(deptById[u.department_id] || '—') : '—'}</td>
          <td>${time(a?.check_in)}</td>
          <td>${time(a?.check_out)}</td>
          <td>${a?.total_hours ? Number(a.total_hours).toFixed(1) : '—'}</td>
          <td style="font-size:var(--text-sm);color:var(--color-text-secondary)">${loc ? esc(loc) : (a?.check_in_lat ? `<a href="https://maps.google.com/?q=${a.check_in_lat},${a.check_in_lng}" target="_blank" rel="noopener" style="color:var(--color-accent)">map</a>` : '—')}</td>
          <td><span class="badge badge-${STATUS_BADGE[a?.status] || 'neutral'}"><span class="badge-dot"></span>${esc(status)}</span></td>
          <td>${selfieCell(a)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div style="padding:var(--space-3) var(--space-4);font-size:var(--text-sm);color:var(--color-text-secondary)">${rows.length.toLocaleString('en-IN')} employees</div>`;

    el.querySelectorAll('.hr-selfie').forEach(img => img.addEventListener('click', async () => {
      const { data } = await sb.storage.from(ATT_BUCKET).createSignedUrl(img.dataset.full, 3600);
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
    }));
  }

  container.querySelector('#hr-date').addEventListener('change', (e) => { date = e.target.value || todayStr; loadDay(); });
  container.querySelector('#hr-dept').addEventListener('change', (e) => { deptFilter = e.target.value; renderTable(); });
  container.querySelector('#hr-status').addEventListener('change', (e) => { statusFilter = e.target.value; renderTable(); });
  container.querySelector('#hr-search').addEventListener('input', (e) => { search = e.target.value.trim(); renderTable(); });
  container.querySelector('#hr-export').addEventListener('click', () => {
    const rows = rosterRows();
    if (!rows.length) return toast('Nothing to export');
    downloadCsv(`attendance_${date}.csv`, rows.map(({ u, a }) => ({
      Employee: u.full_name || u.email || '', Department: u.department_id ? (deptById[u.department_id] || '') : '',
      Date: date, 'Check In': a?.check_in || '', 'Check Out': a?.check_out || '', Hours: a?.total_hours || '',
      Location: a?.check_in_location_id ? (locById[a.check_in_location_id] || '') : '', Status: a?.status || 'not marked',
    })));
  });

  await loadDay();
}
