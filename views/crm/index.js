import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { money } from './common.js';

export default async function crmHub(container) {
  const org = getOrg();
  if (!org) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">CRM</h1>
      <p class="page-subtitle">Accounts, contacts, leads, and your sales pipeline</p>
    </div>
    <div id="crm-stats" class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-3);margin-bottom:var(--space-6)"></div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))" id="crm-nav"></div>
  `;

  const sections = [
    { title: 'Pipeline', desc: 'Drag deals through your sales stages', route: 'crm/opportunities', color: 'var(--color-accent)', icon: 'M3 3v18h18M18 9l-5 5-3-3-4 4' },
    { title: 'Leads', desc: 'Capture and qualify new prospects', route: 'crm/leads', color: 'var(--color-warning)', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .001M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { title: 'Accounts', desc: 'Companies you do business with', route: 'crm/accounts', color: 'var(--color-info)', icon: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-3M9 9v.01M9 12v.01M9 15v.01M9 18v.01' },
    { title: 'Contacts', desc: 'People at your accounts', route: 'crm/contacts', color: 'var(--color-success)', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .001M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  ];

  container.querySelector('#crm-nav').innerHTML = sections.map(s => `
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
  `).join('');

  container.querySelectorAll('#crm-nav [data-route]').forEach(card => {
    card.addEventListener('click', () => navigate(card.dataset.route));
  });

  // Stats
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [openOpps, wonThisMonth, leadCount, accountCount] = await Promise.all([
    sb.from('crm_opportunities').select('amount, probability, stage:stage_id(probability)').eq('status', 'open'),
    sb.from('crm_opportunities').select('amount').eq('status', 'won').gte('updated_at', monthStart.toISOString()),
    sb.from('crm_leads').select('*', { count: 'exact', head: true }).neq('status', 'converted'),
    sb.from('crm_accounts').select('*', { count: 'exact', head: true }),
  ]);

  const open = openOpps.data || [];
  const pipelineTotal = open.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const weighted = open.reduce((s, o) => {
    const prob = (o.probability ?? o.stage?.probability ?? 0) / 100;
    return s + (Number(o.amount) || 0) * prob;
  }, 0);
  const wonTotal = (wonThisMonth.data || []).reduce((s, o) => s + (Number(o.amount) || 0), 0);

  const stat = (label, value, color) => `
    <div class="card" style="padding:var(--space-4)">
      <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-bottom:var(--space-1)">${esc(label)}</div>
      <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);${color ? `color:${color}` : ''}">${value}</div>
    </div>`;

  container.querySelector('#crm-stats').innerHTML = [
    stat('Open deals', String(open.length)),
    stat('Pipeline value', money(pipelineTotal), 'var(--color-accent)'),
    stat('Weighted forecast', money(weighted), 'var(--color-info)'),
    stat('Won this month', money(wonTotal), 'var(--color-success)'),
    stat('Active leads', String(leadCount.count || 0), 'var(--color-warning)'),
    stat('Accounts', String(accountCount.count || 0)),
  ].join('');
}
