import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, loadingSkeleton } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { navigate, routeParams } from '../../js/router.js';
import { leadName, ownerName, field, fetchOrgUsers, userOptions, currentUserId, RATING_BADGE, LEAD_STATUS_BADGE } from './common.js';
import { renderTimeline, openActivityModal } from './activities.js';
import { openConvertModal } from './lead-actions.js';

export default async function crmLeadDetail(container) {
  const org = getOrg();
  const user = getUser();
  const { id } = routeParams();
  if (!org || !id) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Lead not found</div></div>`; return; }

  container.innerHTML = loadingSkeleton(8);

  const [{ data: lead, error }, users] = await Promise.all([
    sb.from('crm_leads').select('*').eq('id', id).maybeSingle(),
    fetchOrgUsers(),
  ]);

  if (error || !lead) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Lead not found</div>
      <button class="btn btn-secondary" id="back">Back to leads</button></div>`;
    container.querySelector('#back')?.addEventListener('click', () => navigate('crm/leads'));
    return;
  }

  const name = leadName(lead);
  const converted = lead.status === 'converted';
  const ownerLabel = lead.owner_id ? ownerName(users, lead.owner_id) : null;

  const infoRow = (label, val) => val ? `<div style="display:flex;justify-content:space-between;gap:var(--space-4);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
    <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(label)}</span>
    <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);text-align:right">${val}</span></div>` : '';

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><button class="btn btn-ghost btn-sm" id="back">← Leads</button></div>
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">${esc(name)}</h1>
        <p class="page-subtitle" style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
          ${lead.company ? esc(lead.company) : 'Lead'}
          <span class="badge badge-${LEAD_STATUS_BADGE[lead.status] || 'neutral'}"><span class="badge-dot"></span>${esc(lead.status)}</span>
          ${lead.rating ? `<span class="badge badge-${RATING_BADGE[lead.rating] || 'neutral'}">${esc(lead.rating)}</span>` : ''}
          ${ownerLabel && ownerLabel !== '—' ? `<span style="color:var(--color-text-secondary)">· ${esc(ownerLabel)}</span>` : ''}
        </p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-secondary" id="log-activity">Log activity</button>
        ${!converted ? '<button class="btn btn-secondary" id="convert-lead">Convert</button>' : ''}
        <button class="btn btn-secondary" id="edit-lead">Edit</button>
      </div>
    </div>

    ${converted ? `<div class="card" style="margin-bottom:var(--space-4);border-left:3px solid var(--color-success)">
      <div class="card-body" style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:center">
        <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);color:var(--color-success)">✓ Converted</span>
        ${lead.converted_account_id ? `<a data-nav="crm/account?id=${lead.converted_account_id}" style="color:var(--color-accent);cursor:pointer;font-size:var(--text-sm)">View account →</a>` : ''}
        ${lead.converted_contact_id ? `<a data-nav="crm/contact?id=${lead.converted_contact_id}" style="color:var(--color-accent);cursor:pointer;font-size:var(--text-sm)">View contact →</a>` : ''}
        ${lead.converted_opportunity_id ? `<a data-nav="crm/opportunity?id=${lead.converted_opportunity_id}" style="color:var(--color-accent);cursor:pointer;font-size:var(--text-sm)">View deal →</a>` : ''}
      </div>
    </div>` : ''}

    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card-header"><span class="card-title">Details</span></div>
      <div class="card-body">
        ${infoRow('Email', lead.email ? `<a href="mailto:${esc(lead.email)}" style="color:var(--color-accent)">${esc(lead.email)}</a>` : '')}
        ${infoRow('Phone', lead.phone ? esc(lead.phone) : '')}
        ${infoRow('Title', lead.title ? esc(lead.title) : '')}
        ${infoRow('Company', lead.company ? esc(lead.company) : '')}
        ${infoRow('Source', lead.source ? esc(lead.source) : '')}
        ${lead.description ? `<div style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(lead.description)}</div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Activity</span></div>
      <div id="activity-timeline"></div>
    </div>
  `;

  container.querySelector('#back').addEventListener('click', () => navigate('crm/leads'));
  container.querySelector('#log-activity').addEventListener('click', () => openActivityModal('lead', id, refreshTimeline));
  container.querySelector('#edit-lead').addEventListener('click', openEdit);
  container.querySelector('#convert-lead')?.addEventListener('click', () => openConvertModal(lead, () => crmLeadDetail(container)));
  container.querySelectorAll('[data-nav]').forEach(a => a.addEventListener('click', () => navigate(a.dataset.nav)));

  const timelineEl = container.querySelector('#activity-timeline');
  function refreshTimeline() { renderTimeline(timelineEl, 'lead', id); }
  refreshTimeline();

  function openEdit() {
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="crm-cols-2">
        ${field('First name', `<input class="form-input" name="first_name" value="${esc(lead.first_name || '')}">`)}
        ${field('Last name', `<input class="form-input" name="last_name" value="${esc(lead.last_name || '')}">`)}
        ${field('Company', `<input class="form-input" name="company" value="${esc(lead.company || '')}">`)}
        ${field('Title', `<input class="form-input" name="title" value="${esc(lead.title || '')}">`)}
        ${field('Email', `<input class="form-input" type="email" name="email" value="${esc(lead.email || '')}">`)}
        ${field('Phone', `<input class="form-input" name="phone" value="${esc(lead.phone || '')}">`)}
        ${field('Status', `<select class="form-input" name="status">${['new', 'working', 'qualified', 'unqualified'].map(s => `<option value="${s}" ${(lead.status || 'new') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
        ${field('Rating', `<select class="form-input" name="rating"><option value="">—</option>${['hot', 'warm', 'cold'].map(r => `<option value="${r}" ${lead.rating === r ? 'selected' : ''}>${r}</option>`).join('')}</select>`)}
        ${field('Source', `<input class="form-input" name="source" value="${esc(lead.source || '')}">`)}
        ${field('Owner', `<select class="form-input" name="owner_id">${userOptions(users, lead.owner_id ?? currentUserId())}</select>`)}
      </div>
      ${field('Notes', `<textarea class="form-input" name="description">${esc(lead.description || '')}</textarea>`)}
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-4)">
        <button type="button" class="btn btn-secondary" id="cancel-l">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>`;
    form.querySelector('#cancel-l').addEventListener('click', closeModal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const update = {
        first_name: fd.get('first_name').trim() || null,
        last_name: fd.get('last_name').trim() || null,
        company: fd.get('company').trim() || null,
        title: fd.get('title').trim() || null,
        email: fd.get('email').trim() || null,
        phone: fd.get('phone').trim() || null,
        status: fd.get('status'),
        rating: fd.get('rating') || null,
        source: fd.get('source').trim() || null,
        owner_id: fd.get('owner_id') || null,
        description: fd.get('description').trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { error: upErr } = await sb.from('crm_leads').update(update).eq('id', id);
      if (upErr) return toast('Could not save lead');
      await logAction('crm', 'lead', id, 'updated', lead, update);
      toast('Lead updated');
      closeModal();
      crmLeadDetail(container);
    });
    openModal('Edit lead', form);
  }
}
