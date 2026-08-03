import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, loadingSkeleton } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { navigate, routeParams } from '../../js/router.js';
import { money, contactName, ownerName, field, fetchOrgUsers, userOptions, fetchAccountsLite, accountOptions, currentUserId } from './common.js';
import { renderTimeline, openActivityModal } from './activities.js';

export default async function crmOpportunityDetail(container) {
  const org = getOrg();
  const user = getUser();
  const { id } = routeParams();
  if (!org || !id) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Deal not found</div></div>`; return; }

  container.innerHTML = loadingSkeleton(8);

  const [{ data: opp, error }, { data: stages }, users] = await Promise.all([
    sb.from('crm_opportunities').select('*, account:account_id(id, name), contact:primary_contact_id(id, first_name, last_name), stage:stage_id(name, is_won, is_lost)').eq('id', id).maybeSingle(),
    sb.from('crm_pipeline_stages').select('*').eq('org_id', org.id).order('sort_order'),
    fetchOrgUsers(),
  ]);

  if (error || !opp) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Deal not found</div>
      <button class="btn btn-secondary" id="back">Back to pipeline</button></div>`;
    container.querySelector('#back')?.addEventListener('click', () => navigate('crm/opportunities'));
    return;
  }

  const allStages = stages || [];
  const statusBadge = opp.status === 'won' ? 'success' : opp.status === 'lost' ? 'error' : 'info';
  const ownerLabel = opp.owner_id ? ownerName(users, opp.owner_id) : null;

  const infoRow = (label, val) => val ? `<div style="display:flex;justify-content:space-between;gap:var(--space-4);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
    <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(label)}</span>
    <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);text-align:right">${val}</span></div>` : '';

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><button class="btn btn-ghost btn-sm" id="back">← Pipeline</button></div>
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">${esc(opp.name)}</h1>
        <p class="page-subtitle" style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
          <span style="font-weight:var(--font-weight-semibold);color:var(--color-accent)">${money(opp.amount, opp.currency)}</span>
          <span class="badge badge-neutral">${esc(opp.stage?.name || '—')}</span>
          <span class="badge badge-${statusBadge}">${esc(opp.status)}</span>
          ${opp.account ? `<a data-nav="crm/account?id=${opp.account.id}" style="color:var(--color-accent);cursor:pointer">${esc(opp.account.name)}</a>` : ''}
          ${ownerLabel && ownerLabel !== '—' ? `<span style="color:var(--color-text-secondary)">· ${esc(ownerLabel)}</span>` : ''}
        </p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-secondary" id="log-activity">Log activity</button>
        ${opp.status === 'open' ? `<button class="btn btn-secondary" id="mark-won" style="color:var(--color-success)">Mark won</button>
        <button class="btn btn-secondary" id="mark-lost" style="color:var(--color-error)">Mark lost</button>` : ''}
        <button class="btn btn-secondary" id="edit-deal">Edit</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card-header"><span class="card-title">Details</span></div>
      <div class="card-body">
        ${infoRow('Amount', opp.amount != null ? money(opp.amount, opp.currency) : '')}
        ${infoRow('Stage', opp.stage?.name ? esc(opp.stage.name) : '')}
        ${infoRow('Probability', opp.probability != null ? opp.probability + '%' : '')}
        ${infoRow('Close date', opp.close_date ? new Date(opp.close_date).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '')}
        ${infoRow('Account', opp.account ? `<a data-nav="crm/account?id=${opp.account.id}" style="color:var(--color-accent);cursor:pointer">${esc(opp.account.name)}</a>` : '')}
        ${infoRow('Primary contact', opp.contact ? `<a data-nav="crm/contact?id=${opp.contact.id}" style="color:var(--color-accent);cursor:pointer">${esc(contactName(opp.contact))}</a>` : '')}
        ${infoRow('Source', opp.source ? esc(opp.source) : '')}
        ${opp.lost_reason ? infoRow('Lost reason', esc(opp.lost_reason)) : ''}
        ${opp.description ? `<div style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(opp.description)}</div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Activity</span></div>
      <div id="activity-timeline"></div>
    </div>
  `;

  container.querySelector('#back').addEventListener('click', () => navigate('crm/opportunities'));
  container.querySelector('#log-activity').addEventListener('click', () => openActivityModal('opportunity', id, refreshTimeline));
  container.querySelector('#edit-deal').addEventListener('click', openEdit);
  container.querySelector('#mark-won')?.addEventListener('click', () => close('won'));
  container.querySelector('#mark-lost')?.addEventListener('click', () => close('lost'));
  container.querySelectorAll('[data-nav]').forEach(a => a.addEventListener('click', () => navigate(a.dataset.nav)));

  const timelineEl = container.querySelector('#activity-timeline');
  function refreshTimeline() { renderTimeline(timelineEl, 'opportunity', id); }
  refreshTimeline();

  async function close(outcome) {
    const stage = allStages.find(s => outcome === 'won' ? s.is_won : s.is_lost);
    const update = { status: outcome, updated_at: new Date().toISOString() };
    if (stage) { update.stage_id = stage.id; update.probability = stage.probability; }
    const { error: upErr } = await sb.from('crm_opportunities').update(update).eq('id', id);
    if (upErr) return toast('Could not update deal');
    await logAction('crm', 'opportunity', id, outcome, null, { stage: stage?.name });
    await publishEvent(`crm.opportunity.${outcome}`, { opportunity_id: id, name: opp.name, amount: opp.amount, owner_id: opp.owner_id, org_id: org.id });
    toast(`Deal marked ${outcome}`);
    crmOpportunityDetail(container);
  }

  async function openEdit() {
    const [accounts, { data: contacts }] = await Promise.all([
      fetchAccountsLite(),
      sb.from('crm_contacts').select('id, first_name, last_name').order('first_name'),
    ]);
    const form = document.createElement('form');
    form.innerHTML = `
      ${field('Deal name *', `<input class="form-input" name="name" required value="${esc(opp.name || '')}">`)}
      <div class="crm-cols-2">
        ${field('Account', `<select class="form-input" name="account_id">${accountOptions(accounts, opp.account_id)}</select>`)}
        ${field('Primary contact', `<select class="form-input" name="primary_contact_id"><option value="">— None —</option>${(contacts || []).map(c => `<option value="${c.id}" ${c.id === opp.primary_contact_id ? 'selected' : ''}>${esc(contactName(c))}</option>`).join('')}</select>`)}
        ${field('Stage', `<select class="form-input" name="stage_id">${allStages.map(s => `<option value="${s.id}" ${opp.stage_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`)}
        ${field('Amount', `<input class="form-input" type="number" name="amount" value="${opp.amount ?? ''}">`)}
        ${field('Close date', `<input class="form-input" type="date" name="close_date" value="${opp.close_date || ''}">`)}
        ${field('Owner', `<select class="form-input" name="owner_id">${userOptions(users, opp.owner_id ?? currentUserId())}</select>`)}
      </div>
      ${field('Source', `<input class="form-input" name="source" value="${esc(opp.source || '')}">`)}
      ${field('Notes', `<textarea class="form-input" name="description">${esc(opp.description || '')}</textarea>`)}
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-4)">
        <button type="button" class="btn btn-secondary" id="cancel-d">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>`;
    form.querySelector('#cancel-d').addEventListener('click', closeModal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const stageId = fd.get('stage_id');
      const stage = allStages.find(s => s.id === stageId);
      const status = stage?.is_won ? 'won' : stage?.is_lost ? 'lost' : 'open';
      const update = {
        name: fd.get('name').trim(),
        account_id: fd.get('account_id') || null,
        primary_contact_id: fd.get('primary_contact_id') || null,
        stage_id: stageId || null,
        amount: fd.get('amount') ? Number(fd.get('amount')) : null,
        close_date: fd.get('close_date') || null,
        owner_id: fd.get('owner_id') || null,
        source: fd.get('source').trim() || null,
        description: fd.get('description').trim() || null,
        probability: stage?.probability ?? null,
        status,
        updated_at: new Date().toISOString(),
      };
      if (!update.name) return;
      const { error: upErr } = await sb.from('crm_opportunities').update(update).eq('id', id);
      if (upErr) return toast('Could not save deal');
      await logAction('crm', 'opportunity', id, 'updated', opp, update);
      toast('Deal updated');
      closeModal();
      crmOpportunityDetail(container);
    });
    openModal('Edit deal', form);
  }
}
