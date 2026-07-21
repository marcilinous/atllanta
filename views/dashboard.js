import sb from '../js/supabase.js';
import { getUser, getOrg, getMembership } from '../js/auth.js';
import { esc, timeAgo, formatDate, initials, avColor } from '../js/ui.js';

export default async function dashboard(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const year = today.getFullYear();
  const monthStart = todayStr.slice(0, 7) + '-01';
  const greeting = today.getHours() < 12 ? 'Good morning' : today.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const userName = user?.user_metadata?.full_name?.split(' ')[0] || '';

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)">
      <h1 class="page-title">${greeting}${userName ? ', ' + esc(userName) : ''}</h1>
      <p class="page-subtitle">${today.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </div>

    <div class="stat-grid" id="dash-stats">
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
    </div>

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
        <div class="card-header"><span class="card-title">Upcoming Interviews</span></div>
        <div class="card-body" id="dash-interviews" style="max-height:220px;overflow-y:auto">
          <div class="skeleton skeleton-text"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Recent Activity</span></div>
      <div class="card-body" id="dash-activity" style="max-height:280px;overflow-y:auto">
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text" style="width:70%"></div>
      </div>
    </div>
  `;

  if (!org) return;

  const [employees, presentToday, pendingLeaves, openJobs, recentEvents, pendingApprovals, upcomingInterviews, pendingRegs, myBalances, myAtt] = await Promise.all([
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
  ]);

  // Stats
  const statsEl = document.getElementById('dash-stats');
  if (statsEl) {
    const regCount = pendingRegs.count ?? 0;
    const totalPending = (pendingLeaves.count ?? 0) + regCount;
    statsEl.innerHTML = `
      <a href="#/employees" class="stat-card" style="text-decoration:none;color:inherit"><div class="stat-label">Employees</div><div class="stat-value">${employees.count ?? '—'}</div></a>
      <a href="#/attendance" class="stat-card" style="text-decoration:none;color:inherit"><div class="stat-label">Present Today</div><div class="stat-value">${presentToday.count ?? '—'}</div></a>
      <a href="#/approvals" class="stat-card" style="text-decoration:none;color:inherit"><div class="stat-label">Pending Approvals</div><div class="stat-value">${totalPending}</div></a>
      <a href="#/recruitment" class="stat-card" style="text-decoration:none;color:inherit"><div class="stat-label">Open Jobs</div><div class="stat-value">${openJobs.count ?? '—'}</div></a>
    `;
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
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(r.leave_type?.name || '—')} · ${r.days} day${r.days !== 1 ? 's' : ''} · ${formatDate(r.start_date)}</div>
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
