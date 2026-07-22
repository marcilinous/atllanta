import { getOrg, getMembership } from '../../js/auth.js';
import { esc } from '../../js/ui.js';
import { navigate } from '../../js/router.js';

export default async function peopleHub(container) {
  const org = getOrg();
  const membership = getMembership();
  const role = membership?.role || 'member';
  const isAdmin = ['owner', 'admin'].includes(role);
  const isManager = ['owner', 'admin', 'manager'].includes(role);

  const sections = [
    {
      title: 'Employee Directory',
      desc: 'View and manage all employees in your organization',
      icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
      route: 'employees',
      color: 'var(--color-accent)',
    },
    {
      title: 'Org Chart',
      desc: 'Visualize your organization\'s reporting structure',
      icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 11h-6M20 8v6',
      route: 'employees/orgchart',
      color: 'var(--color-info)',
    },
    {
      title: 'Bulk Import',
      desc: 'Import employees from CSV or spreadsheet',
      icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
      route: 'employees/import',
      color: 'var(--color-success)',
      requiresAdmin: true,
    },
    {
      title: 'Employee Lifecycle',
      desc: 'Track employee journey from onboarding to exit',
      icon: 'M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
      route: 'lifecycle',
      color: 'var(--color-warning)',
      requiresAdmin: true,
    },
    {
      title: 'Asset Tracking',
      desc: 'Manage company assets assigned to employees',
      icon: 'M20 7h-3V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v3H4a1 1 0 0 0-1 1v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a1 1 0 0 0-1-1zM9 5h6v2H9V5z',
      route: 'assets',
      color: 'var(--color-accent)',
      requiresAdmin: true,
    },
    {
      title: 'Letters & Documents',
      desc: 'Generate offer letters, experience certificates, and more',
      icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
      route: 'letters',
      color: 'var(--color-success)',
      requiresAdmin: true,
    },
    {
      title: 'Recruitment',
      desc: 'Post jobs, match resumes to JDs, shortlist candidates, and schedule interviews',
      icon: 'M3 7h18v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 12h4',
      route: 'recruitment',
      color: 'var(--color-warning)',
      requiresAdmin: true,
    },
  ];

  const visible = sections.filter(s => !s.requiresAdmin || isAdmin);

  container.innerHTML = `
    <div style="margin-bottom:var(--space-6)">
      <h1 class="page-title">People</h1>
      <p class="page-subtitle">Manage your team, track lifecycle, and maintain records</p>
    </div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
      ${visible.map(s => `
        <div class="card" style="cursor:pointer;transition:box-shadow var(--transition-fast),border-color var(--transition-fast)" data-route="${s.route}"
          onmouseover="this.style.borderColor='${s.color}';this.style.boxShadow='var(--shadow-md)'"
          onmouseout="this.style.borderColor='';this.style.boxShadow=''">
          <div class="card-body" style="display:flex;gap:var(--space-4);align-items:flex-start">
            <div style="width:44px;height:44px;border-radius:var(--radius-lg);background:${s.color}15;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${s.icon}"/></svg>
            </div>
            <div>
              <div style="font-weight:var(--font-weight-semibold);margin-bottom:var(--space-1)">${esc(s.title)}</div>
              <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(s.desc)}</div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('[data-route]').forEach(card => {
    card.addEventListener('click', () => navigate(card.dataset.route));
  });
}
