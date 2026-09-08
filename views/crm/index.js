import { esc } from '../../js/ui.js';
import { navigate } from '../../js/router.js';

// CRM module hub. Accent is CRM blue (var(--color-accent) under data-module="crm").
// Built objects link through; upcoming ones render as muted, non-interactive cards
// so the module's shape is visible without dead links.
export default async function crmHub(container) {
  const live = [
    {
      title: 'Accounts',
      desc: 'Companies and partners you sell to',
      icon: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-3M9 9v.01M9 12v.01M9 15v.01M9 18v.01',
      route: 'crm/accounts',
    },
  ];

  const soon = [
    { title: 'Contacts', desc: 'People at your accounts', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8' },
    { title: 'Leads', desc: 'Unqualified prospects to convert', icon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3' },
    { title: 'Pipeline', desc: 'Opportunities across your sales stages', icon: 'M3 3v18h18M18 17V9M13 17V5M8 17v-3' },
    { title: 'Activities', desc: 'Notes, calls, and tasks timeline', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  ];

  container.innerHTML = `
    <div style="margin-bottom:var(--space-6)">
      <h1 class="page-title">CRM</h1>
      <p class="page-subtitle">Accounts, contacts, leads, and your sales pipeline</p>
    </div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
      ${live.map(s => `
        <div class="card" style="cursor:pointer;transition:box-shadow var(--transition-fast),border-color var(--transition-fast)" data-route="${s.route}"
          onmouseover="this.style.borderColor='var(--color-accent)';this.style.boxShadow='var(--shadow-md)'"
          onmouseout="this.style.borderColor='';this.style.boxShadow=''">
          <div class="card-body" style="display:flex;gap:var(--space-4);align-items:flex-start">
            <div style="width:44px;height:44px;border-radius:var(--radius-lg);background:var(--color-accent-light);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${s.icon}"/></svg>
            </div>
            <div>
              <div style="font-weight:var(--font-weight-semibold);margin-bottom:var(--space-1)">${esc(s.title)}</div>
              <div class="u-sm-muted">${esc(s.desc)}</div>
            </div>
          </div>
        </div>
      `).join('')}
      ${soon.map(s => `
        <div class="card" style="opacity:0.55" title="Coming soon">
          <div class="card-body" style="display:flex;gap:var(--space-4);align-items:flex-start">
            <div style="width:44px;height:44px;border-radius:var(--radius-lg);background:var(--color-bg-secondary);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${s.icon}"/></svg>
            </div>
            <div>
              <div style="font-weight:var(--font-weight-semibold);margin-bottom:var(--space-1)">${esc(s.title)} <span class="badge badge-neutral" style="margin-left:var(--space-1)">Soon</span></div>
              <div class="u-sm-muted">${esc(s.desc)}</div>
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
