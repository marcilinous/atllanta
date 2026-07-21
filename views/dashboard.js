import sb from '../js/supabase.js';
import { getUser, getOrg, getMembership } from '../js/auth.js';
import { esc, timeAgo } from '../js/ui.js';

export default async function dashboard(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);

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
    <div class="dash-grid">
      <div class="card">
        <div class="card-header"><span class="card-title">Quick Actions</span></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:var(--space-3)">
            ${isManager ? '<a href="#/recruitment" class="btn btn-primary" style="justify-content:center">Post a Job</a>' : ''}
            <a href="#/attendance/checkin" class="btn btn-primary" style="justify-content:center">Check In</a>
            <a href="#/leave" class="btn btn-secondary" style="justify-content:center">Apply Leave</a>
            <a href="#/employees" class="btn btn-secondary" style="justify-content:center">Employees</a>
            ${isManager ? '<a href="#/approvals" class="btn btn-secondary" style="justify-content:center">Approvals</a>' : ''}
            ${isManager ? '<a href="#/attendance" class="btn btn-secondary" style="justify-content:center">Attendance</a>' : ''}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">Pending Approvals</span>
          ${isManager ? '<a href="#/approvals" style="font-size:var(--text-xs);color:var(--color-accent)">View all</a>' : ''}
        </div>
        <div class="card-body" id="dash-approvals" style="max-height:200px;overflow-y:auto">
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text" style="width:80%"></div>
        </div>
      </div>
    </div>
    <div class="dash-grid">
      <div class="card">
        <div class="card-header"><span class="card-title">Recent Activity</span></div>
        <div class="card-body" id="dash-activity" style="max-height:280px;overflow-y:auto">
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text" style="width:70%"></div>
          <div class="skeleton skeleton-text" style="width:85%"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Upcoming Interviews</span></div>
        <div class="card-body" id="dash-interviews" style="max-height:280px;overflow-y:auto">
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text" style="width:80%"></div>
        </div>
      </div>
    </div>
    <div class="dash-grid">
      <div class="card">
        <div class="card-header"><span class="card-title">My Leave Balance</span></div>
        <div class="card-body" id="dash-leave-balance">
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text" style="width:70%"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">My Attendance This Month</span></div>
        <div class="card-body" id="dash-my-attendance">
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text" style="width:60%"></div>
        </div>
      </div>
    </div>
  `;

  if (!org) return;

  const today = new Date().toISOString().split('T')[0];
  const year = new Date().getFullYear();
  const monthStart = today.slice(0, 7) + '-01';

  const [employees, presentToday, pendingLeaves, openJobs, recentEvents, pendingApprovals, upcomingInterviews, pendingRegs, myBalances, myAttendance] = await Promise.all([
    sb.from('memberships').select('*', { count: 'exact', head: true }).eq('organization_id', org.id),
    sb.from('attendance').select('*', { count: 'exact', head: true }).eq('date', today).eq('status', 'present'),
    sb.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    sb.from('events').select('*, actor:actor_id(full_name, email)').order('created_at', { ascending: false }).limit(8),
    sb.from('leave_requests').select('*, requester:user_id(full_name, email), leave_type:leave_type_id(name)').eq('status', 'pending').order('created_at', { ascending: false }).limit(5),
    sb.from('interviews').select('*, application:job_application_id(candidate:candidate_id(full_name), job:job_id(title))').eq('status', 'scheduled').gte('scheduled_at', today + 'T00:00:00').order('scheduled_at').limit(5),
    sb.from('attendance_regularizations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('leave_balances').select('*, leave_type:leave_type_id(name, code)').eq('user_id', user.id).eq('year', year),
    sb.from('attendance').select('status').eq('user_id', user.id).gte('date', monthStart).lte('date', today),
  ]);

  const statsEl = document.getElementById('dash-stats');
  if (statsEl) {
    const regCount = pendingRegs.count ?? 0;
    const totalPending = (pendingLeaves.count ?? 0) + regCount;
    statsEl.innerHTML = `
      <a href="#/employees" class="stat-card" style="text-decoration:none;color:inherit;cursor:pointer"><div class="stat-label">Employees</div><div class="stat-value">${employees.count ?? '—'}</div></a>
      <a href="#/attendance" class="stat-card" style="text-decoration:none;color:inherit;cursor:pointer"><div class="stat-label">Present Today</div><div class="stat-value">${presentToday.count ?? '—'}</div></a>
      <a href="#/approvals" class="stat-card" style="text-decoration:none;color:inherit;cursor:pointer"><div class="stat-label">Pending Approvals</div><div class="stat-value">${totalPending}</div></a>
      <a href="#/recruitment" class="stat-card" style="text-decoration:none;color:inherit;cursor:pointer"><div class="stat-label">Open Jobs</div><div class="stat-value">${openJobs.count ?? '—'}</div></a>
    `;
  }

  const approvalsEl = document.getElementById('dash-approvals');
  if (approvalsEl) {
    const pa = pendingApprovals.data || [];
    const regCount = pendingRegs.count ?? 0;
    if (!pa.length && !regCount) {
      approvalsEl.innerHTML = `<div style="text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm);padding:var(--space-3)">No pending approvals</div>`;
    } else {
      let html = pa.map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
          <div>
            <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(r.requester?.full_name || r.requester?.email || '—')}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(r.leave_type?.name || '—')} · ${r.days} day${r.days !== 1 ? 's' : ''} · ${r.start_date}</div>
          </div>
          <a href="#/approvals" class="btn btn-ghost btn-sm">Review</a>
        </div>
      `).join('');
      if (regCount > 0) {
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0">
          <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${regCount} attendance regularization${regCount !== 1 ? 's' : ''} pending</div>
          <a href="#/approvals" class="btn btn-ghost btn-sm">Review</a>
        </div>`;
      }
      approvalsEl.innerHTML = html;
    }
  }

  const activityEl = document.getElementById('dash-activity');
  if (activityEl) {
    const events = recentEvents.data || [];
    if (!events.length) {
      activityEl.innerHTML = `<div style="text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm);padding:var(--space-3)">No recent activity</div>`;
    } else {
      activityEl.innerHTML = events.map(ev => {
        const parts = ev.event_type.split('.');
        const action = parts[parts.length - 1];
        const entity = parts.length > 1 ? parts[parts.length - 2] : '';
        const colors = { created: 'var(--color-success)', approved: 'var(--color-success)', completed: 'var(--color-accent)', rejected: 'var(--color-error)', shortlisted: 'var(--color-info)' };
        return `<div style="display:flex;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
          <div style="width:8px;height:8px;border-radius:var(--radius-full);background:${colors[action] || 'var(--color-text-tertiary)'};margin-top:6px;flex-shrink:0"></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:var(--text-sm)">${esc(ev.actor?.full_name || 'System')} <span style="color:var(--color-text-secondary)">${esc(action)} ${esc(entity)}</span></div>
            <div style="font-size:10px;color:var(--color-text-tertiary)">${timeAgo(ev.created_at)}</div>
          </div>
        </div>`;
      }).join('');
    }
  }

  const interviewsEl = document.getElementById('dash-interviews');
  if (interviewsEl) {
    const intv = upcomingInterviews.data || [];
    if (!intv.length) {
      interviewsEl.innerHTML = `<div style="text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm);padding:var(--space-3)">No upcoming interviews</div>`;
    } else {
      interviewsEl.innerHTML = intv.map(i => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
          <div>
            <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(i.application?.candidate?.full_name || '—')}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(i.application?.job?.title || '—')}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:var(--text-sm)">${new Date(i.scheduled_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</div>
            <div style="font-size:10px;color:var(--color-text-tertiary)">${new Date(i.scheduled_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</div>
          </div>
        </div>
      `).join('');
    }
  }

  const balanceEl = document.getElementById('dash-leave-balance');
  if (balanceEl) {
    const bals = myBalances.data || [];
    if (!bals.length) {
      balanceEl.innerHTML = `<div style="text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm);padding:var(--space-3)">No leave balances configured</div>`;
    } else {
      balanceEl.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:var(--space-3)">${bals.map(b => {
        const total = parseFloat(b.opening_balance || 0) + parseFloat(b.accrued || 0);
        const used = parseFloat(b.used || 0);
        const remaining = total - used;
        const pct = total > 0 ? Math.round((used / total) * 100) : 0;
        return `<div style="text-align:center;padding:var(--space-2)">
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-bottom:var(--space-1)">${esc(b.leave_type?.code || '—')}</div>
          <div style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold)">${remaining}</div>
          <div style="font-size:10px;color:var(--color-text-tertiary)">${used} / ${total} used</div>
          <div style="height:4px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);margin-top:var(--space-1);overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${pct > 80 ? 'var(--color-error)' : pct > 50 ? 'var(--color-warning)' : 'var(--color-success)'};border-radius:var(--radius-full)"></div>
          </div>
        </div>`;
      }).join('')}</div>`;
    }
  }

  const myAttEl = document.getElementById('dash-my-attendance');
  if (myAttEl) {
    const records = myAttendance.data || [];
    if (!records.length) {
      myAttEl.innerHTML = `<div style="text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm);padding:var(--space-3)">No attendance records this month</div>`;
    } else {
      const counts = { present: 0, late: 0, absent: 0, half_day: 0, on_leave: 0, holiday: 0, weekly_off: 0 };
      records.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
      const items = [
        { label: 'Present', val: counts.present, color: 'var(--color-success)' },
        { label: 'Late', val: counts.late, color: 'var(--color-warning)' },
        { label: 'Absent', val: counts.absent, color: 'var(--color-error)' },
        { label: 'On Leave', val: counts.on_leave, color: 'var(--color-accent)' },
        { label: 'Half Day', val: counts.half_day, color: 'var(--color-warning)' },
      ].filter(i => i.val > 0);
      if (!items.length) items.push({ label: 'Present', val: counts.present, color: 'var(--color-success)' });
      myAttEl.innerHTML = `<div style="display:flex;gap:var(--space-4);flex-wrap:wrap">${items.map(i =>
        `<div style="text-align:center">
          <div style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold);color:${i.color}">${i.val}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${i.label}</div>
        </div>`
      ).join('')}</div>
      <div style="margin-top:var(--space-3)"><a href="#/attendance/report" style="font-size:var(--text-xs);color:var(--color-accent)">View full report</a></div>`;
    }
  }
}
