import { getMembership } from '../../js/auth.js';
import { esc } from '../../js/ui.js';

export default async function adminView(container) {
  const membership = await getMembership();
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" fill="none" stroke="var(--color-text-tertiary)" stroke-width="1.5" viewBox="0 0 24 24">
          <path d="M12 15v.01M12 12a1.5 1.5 0 0 0 1.14-2.47A1.5 1.5 0 0 0 12 9m-7.4 7.8a9 9 0 1 1 14.8 0"/>
        </svg>
        <h3>Access Denied</h3>
        <p>You need an owner or admin role to view this page.</p>
      </div>`;
    return;
  }

  const sections = [
    { href: '#/settings/org', title: 'Organization Settings', desc: 'Company name, timezone, currency, and branding',
      icon: '<path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/>' },
    { href: '#/settings/users', title: 'User Management', desc: 'Invite members, manage roles and permissions',
      icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { href: '#/settings/departments', title: 'Departments & Teams', desc: 'Organize your company structure',
      icon: '<rect x="2" y="7" width="6" height="6" rx="1"/><rect x="16" y="7" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M12 8v4M5 13v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>' },
    { href: '#/leave/settings', title: 'Leave Configuration', desc: 'Leave types, quotas, and holiday calendar',
      icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>' },
    { href: '#/announcements', title: 'Announcements', desc: 'Post company-wide announcements',
      icon: '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51M2 12l9-8 9 8M4 10v10a1 1 0 0 0 1 1h4"/><path d="M12 3v18"/>' },
    { href: '#/finance/categories', title: 'Expense Categories', desc: 'Configure expense claim categories and spending limits',
      icon: '<path d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"/>' },
    { href: '#/helpdesk/settings', title: 'Helpdesk Categories', desc: 'Configure ticket categories and assign handlers',
      icon: '<path d="M15 5v2M15 11v2M15 17v2M5 5a2 2 0 0 0-2 2v3c1.66 0 3 1.34 3 3s-1.34 3-3 3v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3c-1.66 0-3-1.34-3-3s1.34-3 3-3V7a2 2 0 0 0-2-2H5z"/>' },
    { href: '#/settings/integrations', title: 'Integrations', desc: 'Connected services and API keys',
      icon: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' }
  ];

  container.innerHTML = `
    <div style="padding:var(--space-6)">
      <div style="margin-bottom:var(--space-6)">
        <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);color:var(--color-text-primary);margin:0 0 var(--space-1) 0">Admin Panel</h1>
        <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0">Organization configuration and management</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--space-4)">
        ${sections.map(s => `
          <div class="card">
            <div class="card-body" style="display:flex;flex-direction:column;gap:var(--space-3)">
              <svg width="24" height="24" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">${s.icon}</svg>
              <div>
                <h3 class="card-title" style="margin:0 0 var(--space-1) 0">${esc(s.title)}</h3>
                <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0">${esc(s.desc)}</p>
              </div>
              <a href="${s.href}" class="btn btn-secondary btn-sm" style="align-self:flex-start;margin-top:auto">Manage</a>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}
