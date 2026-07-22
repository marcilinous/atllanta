import sb from '../js/supabase.js';
import { getUser, getOrg, getMembership } from '../js/auth.js';
import { esc, formatDate, timeAgo } from '../js/ui.js';

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
    <div style="margin-bottom:var(--space-6)">
      <h1 class="page-title">${greeting}${userName ? ', ' + esc(userName) : ''}</h1>
      <p class="page-subtitle">${today.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${org ? ' &middot; ' + esc(org.name) : ''}</p>
    </div>
    <div class="stat-grid" id="dash-stats">
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
      <div class="stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-heading"></div></div>
    </div>
    <div class="dash-grid" id="dash-main">
      <div class="card" id="dash-actions-card">
        <div class="card-body"><div class="skeleton skeleton-text"></div></div>
      </div>
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">Recent Activity</span>
        </div>
        <div class="card-body" id="dash-activity" style="max-height:300px;overflow-y:auto">
          <div class="skeleton skeleton-text"></div>
        </div>
      </div>
    </div>
  `;

  if (!org) return;

  const queries = [
    sb.from('memberships').select('*', { count: 'exact', head: true }).eq('organization_id', org.id),
    sb.from('attendance').select('*', { count: 'exact', head: true }).eq('date', todayStr).eq('status', 'present'),
    sb.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    sb.from('events').select('*, actor:actor_id(full_name, email)').order('created_at', { ascending: false }).limit(8),
    sb.from('attendance').select('*').eq('user_id', user.id).eq('date', todayStr).maybeSingle(),
    sb.from('attendance_regularizations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
  ];

  const results = await Promise.all(queries);
  const [employees, presentToday, pendingLeaves, openJobs, recentEvents, myAtt, pendingRegs] = results;

  const regCount = pendingRegs.count ?? 0;
  const totalPending = (pendingLeaves.count ?? 0) + regCount;

  const statsEl = document.getElementById('dash-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <a href="#/people" class="stat-card" style="text-decoration:none;color:inherit">
        <div class="stat-label">Employees</div>
        <div class="stat-value">${employees.count ?? '—'}</div>
      </a>
      <a href="#/me" class="stat-card" style="text-decoration:none;color:inherit">
        <div class="stat-label">Present Today</div>
        <div class="stat-value" style="color:var(--color-success)">${presentToday.count ?? '—'}</div>
      </a>
      <a href="#/inbox" class="stat-card" style="text-decoration:none;color:inherit">
        <div class="stat-label">Pending Approvals</div>
        <div class="stat-value" style="color:${totalPending > 0 ? 'var(--color-warning)' : 'var(--color-success)'}">${totalPending}</div>
      </a>
      <a href="#/recruitment" class="stat-card" style="text-decoration:none;color:inherit">
        <div class="stat-label">Open Jobs</div>
        <div class="stat-value">${openJobs.count ?? '—'}</div>
      </a>
    `;
  }

  const actionsCard = document.getElementById('dash-actions-card');
  if (actionsCard) {
    const attData = myAtt.data;
    let attStatus = 'Not checked in';
    let attSub = 'Start your day';
    let attColor = 'var(--color-text-secondary)';

    if (attData?.check_in && !attData?.check_out) {
      const inTime = new Date(attData.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
      const elapsed = ((Date.now() - new Date(attData.check_in).getTime()) / 3600000).toFixed(1);
      attStatus = 'Working since ' + inTime;
      attSub = elapsed + 'h elapsed';
      attColor = 'var(--color-success)';
    } else if (attData?.check_out) {
      attStatus = 'Day complete';
      attSub = (attData.total_hours ? Number(attData.total_hours).toFixed(1) + 'h logged' : 'Done');
      attColor = 'var(--color-accent)';
    }

    const shortcuts = [
      { label: 'My Hub', href: '#/me', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' },
      { label: 'Inbox', href: '#/inbox', icon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01 9 11.01' },
      { label: 'Helpdesk', href: '#/helpdesk', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
    ];

    if (isManager) {
      shortcuts.push({ label: 'Reports', href: '#/reports', icon: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z' });
    }
    if (isAdmin) {
      shortcuts.push({ label: 'Admin', href: '#/admin', icon: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' });
    }

    actionsCard.innerHTML = `
      <div class="card-header"><span class="card-title">Quick Access</span></div>
      <div class="card-body">
        <div style="display:flex;align-items:center;gap:var(--space-4);padding:var(--space-3);background:var(--color-bg-secondary);border-radius:var(--radius-lg);margin-bottom:var(--space-4)">
          <div style="width:10px;height:10px;border-radius:var(--radius-full);background:${attColor};flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold)">${attStatus}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${attSub}</div>
          </div>
          <a href="#/me" class="btn btn-primary btn-sm">My Hub</a>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:var(--space-2)">
          ${shortcuts.map(s => `
            <a href="${s.href}" style="display:flex;flex-direction:column;align-items:center;gap:var(--space-1);padding:var(--space-3);border-radius:var(--radius-md);text-decoration:none;color:var(--color-text-secondary);font-size:var(--text-xs);font-weight:var(--font-weight-medium);transition:background var(--transition-fast)" onmouseover="this.style.background='var(--color-bg-secondary)'" onmouseout="this.style.background='transparent'">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${s.icon}"/></svg>
              ${s.label}
            </a>
          `).join('')}
        </div>
      </div>
    `;
  }

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
