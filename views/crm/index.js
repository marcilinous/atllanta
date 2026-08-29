import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { money, fetchAllRpc } from './common.js';
import { isFeatureAllowed, hasPartnerPack } from '../../js/features.js';

export default async function crmHub(container) {
  const org = getOrg();
  const user = getUser();
  if (!org) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`;
    return;
  }

  const partner = hasPartnerPack();

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">CRM</h1>
      <p class="page-subtitle">${partner ? 'Your Tally partners — coverage, visits, targets and sales' : 'Accounts, contacts, leads and your sales pipeline'}</p>
    </div>
    <div id="crm-stats" class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--space-3);margin-bottom:var(--space-6)"></div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))" id="crm-nav"></div>
    <div style="margin-top:var(--space-6)" id="crm-general-section">
      <div style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold);color:var(--color-text-secondary);margin-bottom:var(--space-3)">General CRM</div>
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))" id="crm-nav-general"></div>
    </div>
    <div id="crm-tasks" style="margin-top:var(--space-6)"></div>
  `;

  // Generic CRM cards (every org).
  const generic = {
    accounts: { title: 'Accounts', feature: 'crm', desc: 'Companies you do business with', route: 'crm/accounts', color: 'var(--color-info)', icon: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-3M9 9v.01M9 12v.01M9 15v.01M9 18v.01' },
    contacts: { title: 'Contacts', feature: 'crm_contacts', desc: 'People at your accounts', route: 'crm/contacts', color: 'var(--color-success)', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .001M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    leads: { title: 'Leads', feature: 'crm_leads', desc: 'Capture and qualify new prospects', route: 'crm/leads', color: 'var(--color-warning)', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .001M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    pipeline: { title: 'Pipeline', feature: 'crm_pipeline', desc: 'Drag deals through your sales stages', route: 'crm/opportunities', color: 'var(--color-accent)', icon: 'M3 3v18h18M18 9l-5 5-3-3-4 4' },
  };

  // Partner vertical cards (RT / partner-pack orgs).
  const partnerCards = [
    { title: 'Partners', feature: 'crm', desc: 'Your Tally partner base, by region & role', route: 'crm/accounts', color: 'var(--color-info)', icon: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-3M9 9v.01M9 12v.01M9 15v.01M9 18v.01' },
    { title: 'My targets', feature: 'crm_targets', desc: 'Where to do business — partners ranked', route: 'crm/targets', color: 'var(--color-error)', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z' },
    { title: 'Opportunity engine', feature: 'crm_engine', desc: 'Why to go — five scored signals per partner', route: 'crm/engine', color: 'var(--color-error)', icon: 'M13 2L3 14h8l-1 8 10-12h-8l1-8z' },
    { title: 'Journey plan', feature: 'crm_pjp', desc: 'Plan the month day by day, by territory', route: 'crm/pjp', color: 'var(--color-info)', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
    { title: 'Log a visit', feature: 'crm_visits', desc: 'Record a partner visit with GPS & selfie', route: 'crm/visits', color: 'var(--color-success)', icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
    { title: 'Telecalling', feature: 'crm_telecalling', desc: 'Your call book — TSS renewals to drive', route: 'crm/telecalling', color: 'var(--color-warning)', icon: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z' },
    { title: 'Opportunities', feature: 'crm_opps', desc: 'TP & TSS gaps to drive, by team', route: 'crm/opps', color: 'var(--color-accent)', icon: 'M3 3v18h18M18 9l-5 5-3-3-4 4' },
    { title: 'Business by territory', feature: 'crm_coverage', desc: 'Revenue, TP/TSS & coverage: CM → TL → BDE', route: 'crm/coverage', color: 'var(--color-accent)', icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
    { title: 'Sales', feature: 'crm_sales', desc: 'Activation revenue by product, channel & area', route: 'crm/sales', color: 'var(--color-success)', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
    { title: 'Reports', feature: 'crm_reports', desc: 'Import partner reports keyed on Site ID', route: 'crm/reports', color: 'var(--color-text-secondary)', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8' },
  ];

  const primary = partner ? partnerCards : [generic.accounts, generic.contacts, generic.leads, generic.pipeline];
  const general = partner ? [generic.contacts, generic.pipeline, generic.leads] : [];
  const showFeature = (s) => !s.feature || isFeatureAllowed(s.feature);

  const cardHtml = (s) => `
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
    </div>`;

  const generalVisible = general.filter(showFeature);
  container.querySelector('#crm-nav').innerHTML = primary.filter(showFeature).map(cardHtml).join('');
  container.querySelector('#crm-nav-general').innerHTML = generalVisible.map(cardHtml).join('');
  if (!generalVisible.length) container.querySelector('#crm-general-section').style.display = 'none';
  container.querySelectorAll('[data-route]').forEach(card => card.addEventListener('click', () => navigate(card.dataset.route)));

  const statsEl = container.querySelector('#crm-stats');
  const stat = (label, value, color) => `
    <div class="card" style="padding:var(--space-4)">
      <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-bottom:var(--space-1)">${esc(label)}</div>
      <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);${color ? `color:${color}` : ''}">${value}</div>
    </div>`;

  if (partner) {
    // RT KPIs from the partner-activity rollup (same source as Targets/Coverage).
    statsEl.innerHTML = stat('Partners', '…') + stat('Revenue (FY)', '…') + stat('TP (FY)', '…') + stat('TSS (FY)', '…') + stat('Inactive this FY', '…');
    try {
      const { data: rows } = await fetchAllRpc('crm_partner_activity');
      const data = rows || [];
      const revFY = data.reduce((t, p) => t + (+p.rev_cfy || 0), 0);
      const tpFY = data.reduce((t, p) => t + (+p.tp_cfy || 0), 0);
      const tssFY = data.reduce((t, p) => t + (+p.tss_cfy || 0), 0);
      const inactive = data.filter(p => (+p.any_cfy || 0) === 0).length;
      statsEl.innerHTML =
        stat('Partners', data.length.toLocaleString('en-IN')) +
        stat('Revenue (FY)', money(revFY), 'var(--color-success)') +
        stat('TP (FY)', tpFY.toLocaleString('en-IN'), 'var(--color-accent)') +
        stat('TSS (FY)', tssFY.toLocaleString('en-IN'), 'var(--color-info)') +
        stat('Inactive this FY', inactive.toLocaleString('en-IN'), inactive ? 'var(--color-warning)' : undefined);
    } catch {
      const { count } = await sb.from('crm_accounts').select('*', { count: 'exact', head: true });
      statsEl.innerHTML = stat('Partners', String(count || 0));
    }
  } else {
    // Generic CRM KPIs — pipeline, leads, accounts.
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [openOpps, wonThisMonth, leadCount, accountCount] = await Promise.all([
      sb.from('crm_opportunities').select('amount, probability, stage:stage_id(probability)').eq('status', 'open'),
      sb.from('crm_opportunities').select('amount').eq('status', 'won').gte('updated_at', monthStart.toISOString()),
      sb.from('crm_leads').select('*', { count: 'exact', head: true }).neq('status', 'converted'),
      sb.from('crm_accounts').select('*', { count: 'exact', head: true }),
    ]);
    const open = openOpps.data || [];
    const pipelineTotal = open.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const weighted = open.reduce((s, o) => s + (Number(o.amount) || 0) * ((o.probability ?? o.stage?.probability ?? 0) / 100), 0);
    const wonTotal = (wonThisMonth.data || []).reduce((s, o) => s + (Number(o.amount) || 0), 0);
    statsEl.innerHTML =
      stat('Open deals', String(open.length)) +
      stat('Pipeline value', money(pipelineTotal), 'var(--color-accent)') +
      stat('Weighted forecast', money(weighted), 'var(--color-info)') +
      stat('Won this month', money(wonTotal), 'var(--color-success)') +
      stat('Active leads', String(leadCount.count || 0), 'var(--color-warning)') +
      stat('Accounts', String(accountCount.count || 0));
  }

  await loadTasks();

  async function loadTasks() {
    const el = container.querySelector('#crm-tasks');
    const { data: tasks } = await sb
      .from('crm_activities')
      .select('*')
      .eq('owner_id', user?.id)
      .eq('completed', false)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(15);

    if (!tasks?.length) { el.innerHTML = ''; return; }

    const TYPE_ICON = { task: '✓', call: '\u{1F4DE}', meeting: '\u{1F4C5}', email: '✉', note: '\u{1F4DD}' };
    const routeFor = { account: 'crm/account', contact: 'crm/contact', lead: 'crm/leads', opportunity: 'crm/opportunities' };
    const today = new Date(); today.setHours(0, 0, 0, 0);

    el.innerHTML = `<div class="card">
      <div class="card-header"><span class="card-title">My open tasks (${tasks.length})</span></div>
      <div>${tasks.map(t => {
        const due = t.due_date ? new Date(t.due_date) : null;
        const overdue = due && due < today;
        return `<div class="crm-task" data-id="${t.id}" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border-light)">
          <button class="btn btn-ghost btn-sm crm-task-done" data-done="${t.id}" title="Mark done" style="padding:2px 8px">Done</button>
          <div style="flex:1;min-width:0">
            <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${TYPE_ICON[t.type] || '•'} ${esc(t.subject)}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${t.related_type ? esc(t.related_type) : 'general'}${due ? ` · <span style="color:${overdue ? 'var(--color-error)' : 'var(--color-text-tertiary)'}">${overdue ? 'overdue · ' : ''}due ${due.toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>` : ''}</div>
          </div>
          ${t.related_type && t.related_id && routeFor[t.related_type] ? `<button class="btn btn-ghost btn-sm crm-task-open" data-route="${routeFor[t.related_type]}${['account', 'contact'].includes(t.related_type) ? '?id=' + t.related_id : ''}">Open</button>` : ''}
        </div>`;
      }).join('')}</div>
    </div>`;

    el.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', async () => {
      const { error } = await sb.from('crm_activities').update({ completed: true, completed_at: new Date().toISOString() }).eq('id', b.dataset.done);
      if (error) return toast('Could not update');
      toast('Task completed');
      loadTasks();
    }));
    el.querySelectorAll('[data-route]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.route)));
  }
}
