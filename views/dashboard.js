import sb from '../js/supabase.js';
import { getOrg, getMembership } from '../js/auth.js';

export default async function dashboard(container) {
  const org = getOrg();
  const membership = getMembership();

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
      <p class="page-subtitle">Welcome back${org ? ' to ' + esc(org.name) : ''}</p>
    </div>
    <div class="stat-grid" id="dash-stats">
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
    </div>
    <div style="margin-top:var(--space-6)">
      <div class="card">
        <div class="card-header"><span class="card-title">Quick Actions</span></div>
        <div class="card-body">
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap">
            <a href="#/recruitment/jobs" class="btn btn-primary">Post a Job</a>
            <a href="#/employees" class="btn btn-secondary">View Employees</a>
            <a href="#/attendance" class="btn btn-secondary">Attendance</a>
            <a href="#/leave/apply" class="btn btn-secondary">Apply Leave</a>
          </div>
        </div>
      </div>
    </div>
  `;

  if (!org) return;
  await loadStats(org.id);
}

async function loadStats(orgId) {
  const today = new Date().toISOString().split('T')[0];
  const statsEl = document.getElementById('dash-stats');
  if (!statsEl) return;

  const [employees, presentToday, pendingLeaves, openJobs] = await Promise.all([
    sb.from('memberships').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
    sb.from('attendance').select('*', { count: 'exact', head: true }).eq('date', today).eq('status', 'present'),
    sb.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'open'),
  ]);

  statsEl.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Employees</div>
      <div class="stat-value">${employees.count ?? '—'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Present Today</div>
      <div class="stat-value">${presentToday.count ?? '—'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Pending Leave Requests</div>
      <div class="stat-value">${pendingLeaves.count ?? '—'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Open Jobs</div>
      <div class="stat-value">${openJobs.count ?? '—'}</div>
    </div>
  `;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
