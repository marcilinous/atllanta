import { esc } from '../../js/ui.js';
import { navigate } from '../../js/router.js';

// CRM module hub. Accent is CRM blue (var(--color-accent) under data-module="crm").
// Built objects link through; upcoming ones render as muted, non-interactive cards
// so the module's shape is visible without dead links.
export default async function crmHub(container) {
  const live = [
    {
      title: 'Leads',
      desc: 'Prospects your partners report from the field',
      icon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
      route: 'crm/leads',
    },
    {
      title: 'Sales',
      desc: 'Revenue & activations by region, tier, and product',
      icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
      route: 'crm/sales',
    },
    {
      title: 'Partners',
      desc: 'Partner master: onboard, update, and manage details',
      icon: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-3M9 9v.01M9 12v.01M9 15v.01',
      route: 'crm/partners',
    },
    {
      title: 'Events',
      desc: 'Digital, physical & partner events — planned and executed',
      icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
      route: 'crm/events',
    },
    {
      title: 'Distribution',
      desc: 'Command center: BDEs, territories, partners to act on',
      icon: 'M3 3v18h18M18 17V9M13 17V5M8 17v-3',
      route: 'crm/field-sales',
    },
    {
      title: 'Journey Plan',
      desc: 'PJP: plan each BDE\'s beat by territory, day by day',
      icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
      route: 'crm/pjp',
    },
    {
      title: 'Log Visit',
      desc: 'Field visit capture: outcome, Tally check, GPS, selfie',
      icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
      route: 'crm/log-visit',
    },
    {
      title: 'Prospects',
      desc: 'Unregistered partners from the field — register to onboard',
      icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
      route: 'crm/prospects',
    },
    {
      title: 'Opportunities',
      desc: 'UAP & transacting win-back, and a two-period comparison playground',
      icon: 'M13 2L3 14h7l-1 8 10-12h-7l1-8z',
      route: 'crm/opportunities',
    },
    {
      title: 'Reports & exports',
      desc: 'Canned CSV downloads for MIS & analysts',
      icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
      route: 'crm/exports',
    },
  ];

  const soon = [];

  container.innerHTML = `
    <div style="margin-bottom:var(--space-6)">
      <h1 class="page-title">CRM</h1>
      <p class="page-subtitle">Distribution sales: partners, field activity, opportunities & reports</p>
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
