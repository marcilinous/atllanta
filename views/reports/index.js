import { getMembership } from '../../js/auth.js';

export default async function reportsView(container) {
  const membership = await getMembership();
  const role = membership?.role || 'member';
  const isManager = ['owner', 'admin', 'manager'].includes(role);
  const isAdmin = ['owner', 'admin'].includes(role);

  if (!isManager) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <h3 class="empty-state-title">Access Denied</h3>
        <p class="empty-state-desc">Reports are available to managers and admins only.</p>
      </div>`;
    return;
  }

  const reports = [
    { icon: '📊', title: 'Attendance Report', desc: 'Monthly attendance breakdown by employee', route: '#/attendance/report', roles: ['owner', 'admin', 'manager'] },
    { icon: '🌿', title: 'Leave Report', desc: 'Leave usage and balance summary', route: '#/leave/report', roles: ['owner', 'admin', 'manager'] },
    { icon: '📋', title: 'Audit Log', desc: 'Track all actions across the platform', route: '#/audit', roles: ['owner', 'admin'] },
  ];

  const visible = reports.filter(r => r.roles.includes(role));

  container.innerHTML = `
    <div style="margin-bottom:var(--space-6);">
      <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);color:var(--color-text-primary);margin:0 0 var(--space-1);">Reports</h1>
      <p style="font-size:var(--text-base);color:var(--color-text-secondary);margin:0;">Generate and view reports</p>
    </div>
    <div class="stat-grid">
      ${visible.map(r => `
        <a href="${r.route}" class="card" style="text-decoration:none;cursor:pointer;">
          <div class="card-body" style="display:flex;flex-direction:column;gap:var(--space-3);">
            <span style="font-size:var(--text-2xl);">${r.icon}</span>
            <h3 class="card-title" style="margin:0;color:var(--color-text-primary);">${r.title}</h3>
            <p style="margin:0;font-size:var(--text-sm);color:var(--color-text-secondary);">${r.desc}</p>
            <span class="btn btn-ghost btn-sm" style="align-self:flex-start;margin-top:auto;">View Report &rarr;</span>
          </div>
        </a>`).join('')}
    </div>`;
}
