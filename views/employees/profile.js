import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, initials, avColor, formatDate } from '../../js/ui.js';
import { navigate, routeParams } from '../../js/router.js';
import { logAction } from '../../js/audit.js';

export default async function employeeProfile(container) {
  const org = getOrg();
  const params = routeParams();
  const empId = params.id;

  if (!empId) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
      <div class="empty-state-title">No employee selected</div>
      <div class="empty-state-desc">Select an employee from the directory.</div>
    </div>`;
    return;
  }

  container.innerHTML = `<div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-text" style="width:40%"></div></div>`;

  const { data: emp, error } = await sb
    .from('users')
    .select('*, department:department_id(name)')
    .eq('id', empId)
    .maybeSingle();

  if (error || !emp) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></div>
      <div class="empty-state-title">Employee not found</div>
      <div class="empty-state-desc">${error ? esc(error.message) : 'This employee record does not exist.'}</div>
    </div>`;
    return;
  }

  const statusColors = { active: 'success', on_notice: 'warning', exited: 'error' };
  const roleColors = { owner: 'error', admin: 'warning', manager: 'info', member: 'neutral' };

  container.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap">
      <button class="btn btn-ghost" id="back-btn" style="padding:var(--space-2)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <div style="display:flex;align-items:center;gap:var(--space-4);flex:1">
        <div style="width:56px;height:56px;border-radius:var(--radius-full);background:${avColor(emp.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold);font-size:var(--text-xl);flex-shrink:0">${initials(emp.full_name)}</div>
        <div>
          <h1 class="page-title" style="margin:0">${esc(emp.full_name)}</h1>
          <p class="page-subtitle" style="margin:0;margin-top:var(--space-1)">${esc(emp.designation || '—')}</p>
        </div>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <span class="badge badge-${roleColors[emp.role] || 'neutral'}">${esc(emp.role || 'member')}</span>
        <span class="badge badge-${statusColors[emp.status] || 'neutral'}"><span class="badge-dot"></span>${esc(emp.status || 'active')}</span>
      </div>
    </div>

    <div class="grid-2col" style="margin-bottom:var(--space-6)">
      <div class="card">
        <div class="card-header"><span class="card-title">Personal Information</span></div>
        <div class="card-body">
          <div style="display:grid;gap:var(--space-4)">
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Full Name</div>
              <div style="font-size:var(--text-sm)">${esc(emp.full_name)}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Email</div>
              <div style="font-size:var(--text-sm)">${esc(emp.email || '—')}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Phone</div>
              <div style="font-size:var(--text-sm)">${esc(emp.phone || '—')}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Employment Details</span></div>
        <div class="card-body">
          <div style="display:grid;gap:var(--space-4)">
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Department</div>
              <div style="font-size:var(--text-sm)">${esc(emp.department?.name || '—')}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Designation</div>
              <div style="font-size:var(--text-sm)">${esc(emp.designation || '—')}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Date of Joining</div>
              <div style="font-size:var(--text-sm)">${emp.date_of_joining ? formatDate(emp.date_of_joining) : '—'}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Reporting Manager</div>
              <div style="font-size:var(--text-sm)" id="manager-name">—</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="tabs" id="profile-tabs">
      <button class="tab active" data-tab="attendance">Attendance History</button>
      <button class="tab" data-tab="leave">Leave History</button>
      <button class="tab" data-tab="documents">Documents</button>
    </div>
    <div id="profile-tab-content" style="margin-top:var(--space-4)"></div>
  `;

  // Load reporting manager name if set
  if (emp.reporting_manager_id) {
    sb.from('users').select('full_name').eq('id', emp.reporting_manager_id).maybeSingle().then(({ data }) => {
      const el = document.getElementById('manager-name');
      if (el && data) el.textContent = data.full_name;
    });
  }

  // Back button
  document.getElementById('back-btn').addEventListener('click', () => navigate('employees'));

  // Tab logic
  let currentTab = 'attendance';

  document.getElementById('profile-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#profile-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderTab();
  });

  const tabContent = document.getElementById('profile-tab-content');

  async function renderTab() {
    if (currentTab === 'attendance') await renderAttendance();
    else if (currentTab === 'leave') await renderLeave();
    else if (currentTab === 'documents') renderDocuments();
  }

  async function renderAttendance() {
    tabContent.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading attendance...</div>`;

    const { data: records, error: attError } = await sb
      .from('attendance')
      .select('*')
      .eq('user_id', empId)
      .order('date', { ascending: false })
      .limit(30);

    if (attError) {
      tabContent.innerHTML = `<div class="card"><div class="card-body" style="color:var(--color-error)">Failed to load attendance: ${esc(attError.message)}</div></div>`;
      return;
    }

    if (!records?.length) {
      tabContent.innerHTML = `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
        <div class="empty-state-title">No attendance records</div>
        <div class="empty-state-desc">No attendance history found for this employee.</div>
      </div></div>`;
      return;
    }

    const statusColors = { present: 'success', absent: 'error', late: 'warning', on_leave: 'info', half_day: 'warning', holiday: 'neutral', weekly_off: 'neutral' };

    tabContent.innerHTML = `<div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Status</th></tr></thead>
      <tbody>${records.map(a => `<tr>
        <td style="font-weight:var(--font-weight-medium)">${formatDate(a.date)}</td>
        <td>${a.check_in ? new Date(a.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
        <td>${a.check_out ? new Date(a.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
        <td>${a.total_hours ? Number(a.total_hours).toFixed(1) : '—'}</td>
        <td><span class="badge badge-${statusColors[a.status] || 'neutral'}"><span class="badge-dot"></span>${esc(a.status || '—')}</span></td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
  }

  async function renderLeave() {
    tabContent.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading leave history...</div>`;

    const { data: requests, error: leaveError } = await sb
      .from('leave_requests')
      .select('*, leave_type:leave_type_id(name, code)')
      .eq('user_id', empId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (leaveError) {
      tabContent.innerHTML = `<div class="card"><div class="card-body" style="color:var(--color-error)">Failed to load leave history: ${esc(leaveError.message)}</div></div>`;
      return;
    }

    if (!requests?.length) {
      tabContent.innerHTML = `<div class="card"><div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></div>
        <div class="empty-state-title">No leave requests</div>
        <div class="empty-state-desc">No leave history found for this employee.</div>
      </div></div>`;
      return;
    }

    const statusColors = { pending: 'warning', approved: 'success', rejected: 'error', cancelled: 'neutral' };

    tabContent.innerHTML = `<div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th></tr></thead>
      <tbody>${requests.map(r => `<tr>
        <td><span class="badge badge-neutral">${esc(r.leave_type?.code || '—')}</span> ${esc(r.leave_type?.name || '')}</td>
        <td>${formatDate(r.start_date)}</td>
        <td>${formatDate(r.end_date)}</td>
        <td>${r.days}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.reason || '—')}</td>
        <td><span class="badge badge-${statusColors[r.status] || 'neutral'}"><span class="badge-dot"></span>${esc(r.status || '—')}</span></td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
  }

  async function renderDocuments() {
    tabContent.innerHTML = `<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading documents...</div>`;

    const { data: files, error: filesErr } = await sb
      .from('files')
      .select('*')
      .eq('entity_type', 'employee')
      .eq('entity_id', empId)
      .order('created_at', { ascending: false });

    const docs = files || [];

    tabContent.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">Documents</span>
          <button class="btn btn-primary btn-sm" id="doc-upload-btn">Upload Document</button>
        </div>
        <div class="card-body" id="docs-list"></div>
      </div>
      <input type="file" id="doc-file-input" style="display:none" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.txt">
    `;

    const listEl = document.getElementById('docs-list');

    if (!docs.length) {
      listEl.innerHTML = `<div class="empty-state" style="padding:var(--space-6)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        <div class="empty-state-title">No documents</div>
        <div class="empty-state-desc">Upload documents like offer letters, ID proofs, or certificates.</div>
      </div>`;
    } else {
      const mimeIcons = { 'application/pdf': '📄', 'image/': '🖼️', 'application/msword': '📝' };
      listEl.innerHTML = `<div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
        <tbody>${docs.map(f => {
          const icon = Object.entries(mimeIcons).find(([k]) => (f.mime_type || '').startsWith(k))?.[1] || '📎';
          const size = f.file_size ? (f.file_size < 1024 ? f.file_size + ' B' : f.file_size < 1048576 ? (f.file_size / 1024).toFixed(1) + ' KB' : (f.file_size / 1048576).toFixed(1) + ' MB') : '—';
          return `<tr>
            <td style="font-size:var(--text-sm)">${icon} ${esc(f.file_name)}</td>
            <td style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(f.mime_type || '—')}</td>
            <td style="font-size:var(--text-xs)">${size}</td>
            <td style="font-size:var(--text-xs);color:var(--color-text-secondary)">${formatDate(f.created_at)}</td>
            <td style="display:flex;gap:var(--space-1)">
              <button class="btn btn-ghost btn-sm" data-dl-doc="${esc(f.file_path)}" data-dl-name="${esc(f.file_name)}">Download</button>
              <button class="btn btn-ghost btn-sm" data-del-doc="${f.id}" data-path="${esc(f.file_path)}">Delete</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;

      listEl.querySelectorAll('[data-dl-doc]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const { data, error } = await sb.storage.from('documents').download(btn.dataset.dlDoc);
          if (error) { toast('Download failed: ' + error.message); return; }
          const url = URL.createObjectURL(data);
          const a = document.createElement('a');
          a.href = url;
          a.download = btn.dataset.dlName || 'document';
          a.click();
          URL.revokeObjectURL(url);
        });
      });

      listEl.querySelectorAll('[data-del-doc]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await sb.storage.from('documents').remove([btn.dataset.path]);
          const { error } = await sb.from('files').delete().eq('id', btn.dataset.delDoc);
          if (error) { toast('Failed: ' + error.message); return; }
          await logAction('people', 'file', btn.dataset.delDoc, 'deleted', null, null);
          toast('Document deleted');
          renderDocuments();
        });
      });
    }

    const fileInput = document.getElementById('doc-file-input');
    document.getElementById('doc-upload-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const path = `employees/${empId}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await sb.storage.from('documents').upload(path, file);
      if (uploadErr) return toast('Upload failed: ' + uploadErr.message);
      const { error: insertErr } = await sb.from('files').insert({
        org_id: org?.id,
        uploaded_by: getUser().id,
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        mime_type: file.type,
        entity_type: 'employee',
        entity_id: empId,
      });
      if (insertErr) { toast('Failed: ' + insertErr.message); return; }
      await logAction('people', 'file', null, 'uploaded', null, { file_name: file.name, entity_type: 'employee', entity_id: empId });
      toast('Document uploaded');
      fileInput.value = '';
      renderDocuments();
    });
  }

  renderTab();
}
