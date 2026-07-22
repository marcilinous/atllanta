import sb from '../js/supabase.js';
import { getUser, getOrg, getMembership } from '../js/auth.js';
import { esc, timeAgo, formatDate, initials, avColor } from '../js/ui.js';

export default async function dashboard(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const year = today.getFullYear();
  const greeting = today.getHours() < 12 ? 'Good morning' : today.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const userName = user?.user_metadata?.full_name?.split(' ')[0] || '';

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-4);flex-wrap:wrap;gap:var(--space-2)">
      <div>
        <h1 class="page-title">${greeting}${userName ? ', ' + esc(userName) : ''}</h1>
        <p class="page-subtitle">${today.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${org ? ' &middot; ' + esc(org.name) : ''}</p>
      </div>
      ${isAdmin ? `<div style="display:flex;gap:var(--space-2)">
        <a href="#/settings" class="btn btn-secondary btn-sm">Org Settings</a>
        <a href="#/settings/users" class="btn btn-secondary btn-sm">Manage Users</a>
      </div>` : ''}
    </div>

    <div class="stat-grid" id="dash-stats">
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
    </div>

    ${isAdmin ? `<div class="card" style="margin-bottom:var(--space-4)" id="org-health-card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <span class="card-title">Organization Health</span>
        <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Admin view</span>
      </div>
      <div class="card-body" id="org-health-body">
        <div class="skeleton skeleton-text"></div>
      </div>
    </div>` : ''}

    <div class="dash-grid">
      <div class="card" id="dash-checkin-card">
        <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);flex-wrap:wrap">
          <div>
            <div id="dash-checkin-status" style="font-weight:var(--font-weight-semibold)">Loading...</div>
            <div id="dash-checkin-sub" style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:2px"></div>
          </div>
          <a href="#/attendance" class="btn btn-primary" id="dash-checkin-btn">Go to Attendance</a>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">My Leave Balance</span></div>
        <div class="card-body" id="dash-leave-balance">
          <div class="skeleton skeleton-text"></div>
        </div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">Pending Approvals</span>
          ${isManager ? '<a href="#/approvals" style="font-size:var(--text-xs);color:var(--color-accent)">View all</a>' : ''}
        </div>
        <div class="card-body" id="dash-approvals" style="max-height:220px;overflow-y:auto">
          <div class="skeleton skeleton-text"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">Upcoming Interviews</span>
          <a href="#/recruitment/interviews" style="font-size:var(--text-xs);color:var(--color-accent)">View all</a>
        </div>
        <div class="card-body" id="dash-interviews" style="max-height:220px;overflow-y:auto">
          <div class="skeleton skeleton-text"></div>
        </div>
      </div>
    </div>

    ${isManager ? `<div class="dash-grid">
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">Quick Actions</span>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:var(--space-2)">
            <a href="#/recruitment" class="btn btn-secondary btn-sm" style="text-align:center;padding:var(--space-3)">Post a Job</a>
            <a href="#/employees/import" class="btn btn-secondary btn-sm" style="text-align:center;padding:var(--space-3)">Import Employees</a>
            <a href="#/attendance/report" class="btn btn-secondary btn-sm" style="text-align:center;padding:var(--space-3)">Attendance Report</a>
            <a href="#/leave" class="btn btn-secondary btn-sm" style="text-align:center;padding:var(--space-3)">Leave Report</a>
            ${isAdmin ? '<a href="#/settings" class="btn btn-secondary btn-sm" style="text-align:center;padding:var(--space-3)">Configure Leave</a>' : ''}
            ${isAdmin ? '<a href="#/settings/departments" class="btn btn-secondary btn-sm" style="text-align:center;padding:var(--space-3)">Manage Depts</a>' : ''}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Recent Activity</span></div>
        <div class="card-body" id="dash-activity" style="max-height:220px;overflow-y:auto">
          <div class="skeleton skeleton-text"></div>
        </div>
      </div>
    </div>` : `<div class="card">
      <div class="card-header"><span class="card-title">Recent Activity</span></div>
      <div class="card-body" id="dash-activity" style="max-height:280px;overflow-y:auto">
        <div class="skeleton skeleton-text"></div>
      </div>
    </div>`}
  `;

  if (!org) return;

  const queries = [
    sb.from('memberships').select('*', { count: 'exact', head: true }).eq('organization_id', org.id),
    sb.from('attendance').select('*', { count: 'exact', head: true }).eq('date', todayStr).eq('status', 'present'),
    sb.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    sb.from('events').select('*, actor:actor_id(full_name, email)').order('created_at', { ascending: false }).limit(8),
    sb.from('leave_requests').select('*, requester:user_id(full_name, email), leave_type:leave_type_id(name, code)').eq('status', 'pending').order('created_at', { ascending: false }).limit(5),
    sb.from('interviews').select('*, application:job_application_id(candidate:candidate_id(full_name), job:job_id(title))').eq('status', 'scheduled').gte('scheduled_at', todayStr + 'T00:00:00').order('scheduled_at').limit(5),
    sb.from('attendance_regularizations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('leave_balances').select('*, leave_type:leave_type_id(name, code)').eq('user_id', user.id).eq('year', year),
    sb.from('attendance').select('*').eq('user_id', user.id).eq('date', todayStr).maybeSingle(),
  ];

  if (isAdmin) {
    queries.push(
      sb.from('departments').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
      sb.from('leave_types').select('*', { count: 'exact', head: true }).eq('is_active', true),
      sb.from('attendance').select('*', { count: 'exact', head: true }).eq('date', todayStr).eq('status', 'absent'),
      sb.from('attendance').select('*', { count: 'exact', head: true }).eq('date', todayStr).eq('status', 'late'),
      sb.from('candidates').select('*', { count: 'exact', head: true }),
      sb.from('job_applications').select('*', { count: 'exact', head: true }).eq('status', 'shortlisted'),
    );
  }

  const results = await Promise.all(queries);
  const [employees, presentToday, pendingLeaves, openJobs, recentEvents, pendingApprovals, upcomingInterviews, pendingRegs, myBalances, myAtt] = results;

  // Stats
  const statsEl = document.getElementById('dash-stats');
  if (statsEl) {
    const regCount = pendingRegs.count ?? 0;
    const totalPending = (pendingLeaves.count ?? 0) + regCount;
    statsEl.innerHTML = `
      <a href="#/employees" class="stat-card" style="text-decoration:none;color:inherit"><div class="stat-label">Employees</div><div class="stat-value">${employees.count ?? '—'}</div></a>
      <a href="#/attendance" class="stat-card" style="text-decoration:none;color:inherit"><div class="stat-label">Present Today</div><div class="stat-value" style="color:var(--color-success)">${presentToday.count ?? '—'}</div></a>
      <a href="#/approvals" class="stat-card" style="text-decoration:none;color:inherit"><div class="stat-label">Pending Approvals</div><div class="stat-value" style="color:${totalPending > 0 ? 'var(--color-warning)' : 'var(--color-success)'}">${totalPending}</div></a>
      <a href="#/recruitment" class="stat-card" style="text-decoration:none;color:inherit"><div class="stat-label">Open Jobs</div><div class="stat-value">${openJobs.count ?? '—'}</div></a>
    `;
  }

  // Org Health (admin only)
  if (isAdmin) {
    const [deptCount, leaveTypeCount, absentToday, lateToday, candidateCount, shortlistedCount] = results.slice(10);
    const healthEl = document.getElementById('org-health-body');
    if (healthEl) {
      const empCount = employees.count ?? 0;
      const presentCount = presentToday.count ?? 0;
      const absentCount = absentToday.count ?? 0;
      const lateCount = lateToday.count ?? 0;
      const attendancePct = empCount > 0 ? Math.round((presentCount / empCount) * 100) : 0;
      const pctColor = attendancePct >= 90 ? 'var(--color-success)' : attendancePct >= 70 ? 'var(--color-warning)' : 'var(--color-error)';

      const issues = [];
      if ((deptCount.count ?? 0) === 0) issues.push({ text: 'No departments configured', link: '#/settings', action: 'Set up departments' });
      if ((leaveTypeCount.count ?? 0) === 0) issues.push({ text: 'No leave types configured', link: '#/settings', action: 'Configure leave' });
      if (empCount <= 1) issues.push({ text: 'Only 1 member — invite your team', link: '#/settings/users', action: 'Invite members' });

      healthEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:var(--space-4);margin-bottom:${issues.length ? 'var(--space-4)' : '0'}">
          <div style="text-align:center">
            <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:${pctColor}">${attendancePct}%</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Today's Attendance</div>
            <div style="font-size:10px;color:var(--color-text-tertiary);margin-top:2px">${presentCount} present &middot; ${absentCount} absent &middot; ${lateCount} late</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold)">${deptCount.count ?? 0}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Departments</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold)">${candidateCount.count ?? 0}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Candidates</div>
            <div style="font-size:10px;color:var(--color-text-tertiary);margin-top:2px">${shortlistedCount.count ?? 0} shortlisted</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold)">${leaveTypeCount.count ?? 0}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Leave Types</div>
          </div>
        </div>
        ${issues.length ? `<div style="border-top:1px solid var(--color-border);padding-top:var(--space-3)">
          <div style="font-size:var(--text-xs);font-weight:var(--font-weight-semibold);color:var(--color-warning);margin-bottom:var(--space-2)">Setup checklist</div>
          ${issues.map(i => `<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <div style="width:6px;height:6px;border-radius:var(--radius-full);background:var(--color-warning);flex-shrink:0"></div>
              <span style="font-size:var(--text-sm)">${i.text}</span>
            </div>
            <a href="${i.link}" class="btn btn-primary btn-sm" style="font-size:var(--text-xs)">${i.action}</a>
          </div>`).join('')}
        </div>` : '<div style="border-top:1px solid var(--color-border);padding-top:var(--space-3);text-align:center;font-size:var(--text-sm);color:var(--color-success)">All configured</div>'}
      `;
    }
  }

  // Check-in status card
  const statusEl = document.getElementById('dash-checkin-status');
  const subEl = document.getElementById('dash-checkin-sub');
  const btnEl = document.getElementById('dash-checkin-btn');
  const attData = myAtt.data;

  if (!attData) {
    statusEl.textContent = 'You haven\'t checked in yet';
    subEl.textContent = 'Start your day by checking in';
    btnEl.textContent = 'Check In';
    btnEl.className = 'btn btn-primary';
  } else if (attData.check_in && !attData.check_out) {
    const inTime = new Date(attData.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    statusEl.textContent = 'Working since ' + inTime;
    const elapsed = ((Date.now() - new Date(attData.check_in).getTime()) / 3600000).toFixed(1);
    subEl.textContent = elapsed + ' hours elapsed';
    btnEl.textContent = 'Check Out';
    btnEl.className = 'btn btn-secondary';
  } else {
    const hours = attData.total_hours ? Number(attData.total_hours).toFixed(1) + 'h' : '';
    statusEl.textContent = 'Day complete' + (hours ? ' — ' + hours + ' logged' : '');
    subEl.textContent = 'Great work today!';
    btnEl.textContent = 'View Attendance';
    btnEl.className = 'btn btn-ghost';
  }

  // Leave balance
  const balanceEl = document.getElementById('dash-leave-balance');
  if (balanceEl) {
    const bals = myBalances.data || [];
    if (!bals.length) {
      balanceEl.innerHTML = '<div style="text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm);padding:var(--space-2)">No leave balances configured</div>';
    } else {
      balanceEl.innerHTML = `<div style="display:flex;gap:var(--space-3);overflow-x:auto">${bals.map(b => {
        const total = parseFloat(b.opening_balance || 0) + parseFloat(b.accrued || 0);
        const used = parseFloat(b.used || 0);
        const remaining = total - used;
        const pct = total > 0 ? Math.round((used / total) * 100) : 0;
        const barColor = pct > 80 ? 'var(--color-error)' : pct > 50 ? 'var(--color-warning)' : 'var(--color-success)';
        return `<div style="flex:0 0 auto;min-width:90px;text-align:center;padding:var(--space-2)">
          <div style="font-size:10px;color:var(--color-accent);font-weight:var(--font-weight-semibold);text-transform:uppercase;letter-spacing:0.5px">${esc(b.leave_type?.code || '—')}</div>
          <div style="font-size:var(--text-lg);font-weight:var(--font-weight-bold);margin:2px 0">${remaining}</div>
          <div style="height:3px;background:var(--color-bg-tertiary);border-radius:var(--radius-full);margin:4px 0;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${barColor};border-radius:var(--radius-full)"></div>
          </div>
          <div style="font-size:9px;color:var(--color-text-tertiary)">${used}/${total} used</div>
        </div>`;
      }).join('')}</div>
      <div style="margin-top:var(--space-2)"><a href="#/leave" style="font-size:var(--text-xs);color:var(--color-accent)">Apply leave</a></div>`;
    }
  }

  // Pending approvals
  const approvalsEl = document.getElementById('dash-approvals');
  if (approvalsEl) {
    const pa = pendingApprovals.data || [];
    const regCount = pendingRegs.count ?? 0;
    if (!pa.length && !regCount) {
      approvalsEl.innerHTML = '<div style="text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm);padding:var(--space-3)">No pending approvals</div>';
    } else {
      let html = pa.map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
          <div style="min-width:0;flex:1">
            <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(r.requester?.full_name || r.requester?.email || '—')}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(r.leave_type?.name || '—')} &middot; ${r.days} day${r.days !== 1 ? 's' : ''} &middot; ${formatDate(r.start_date)}</div>
          </div>
          <a href="#/approvals" class="btn btn-ghost btn-sm" style="flex-shrink:0">Review</a>
        </div>
      `).join('');
      if (regCount > 0) {
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0">
          <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${regCount} regularization${regCount !== 1 ? 's' : ''} pending</div>
          <a href="#/approvals" class="btn btn-ghost btn-sm">Review</a>
        </div>`;
      }
      approvalsEl.innerHTML = html;
    }
  }

  // Upcoming interviews
  const interviewsEl = document.getElementById('dash-interviews');
  if (interviewsEl) {
    const intv = upcomingInterviews.data || [];
    if (!intv.length) {
      interviewsEl.innerHTML = '<div style="text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm);padding:var(--space-3)">No upcoming interviews</div>';
    } else {
      interviewsEl.innerHTML = intv.map(i => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
          <div>
            <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(i.application?.candidate?.full_name || '—')}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(i.application?.job?.title || '—')}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${new Date(i.scheduled_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</div>
            <div style="font-size:10px;color:var(--color-text-tertiary)">${new Date(i.scheduled_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</div>
          </div>
        </div>
      `).join('');
    }
  }

  // Recent activity
  const activityEl = document.getElementById('dash-activity');
  if (activityEl) {
    const events = recentEvents.data || [];
    if (!events.length) {
      activityEl.innerHTML = '<div style="text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm);padding:var(--space-3)">No recent activity</div>';
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
}
