import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { navigate, routeParams } from '../../js/router.js';
import { money, contactName, ownerName, field, fetchOrgUsers, fetchAccountsLite, accountOptions, userOptions, currentUserId } from './common.js';
import { renderTimeline, openActivityModal } from './activities.js';

export default async function crmContactDetail(container) {
  const org = getOrg();
  const user = getUser();
  const { id } = routeParams();
  if (!org || !id) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Contact not found</div></div>`; return; }

  const { data: contact, error } = await sb
    .from('crm_contacts')
    .select('*, account:account_id(id, name)')
    .eq('id', id)
    .maybeSingle();

  if (error || !contact) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Contact not found</div>
      <button class="btn btn-secondary" id="back">Back to contacts</button></div>`;
    container.querySelector('#back')?.addEventListener('click', () => navigate('crm/contacts'));
    return;
  }

  const [{ data: opps }, users] = await Promise.all([
    sb.from('crm_opportunities').select('*, stage:stage_id(name)').eq('primary_contact_id', id).order('created_at', { ascending: false }),
    fetchOrgUsers(),
  ]);

  const name = contactName(contact);
  const ownerLabel = contact.owner_id ? ownerName(users, contact.owner_id) : null;

  const infoRow = (label, val) => val ? `<div style="display:flex;justify-content:space-between;gap:var(--space-4);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
    <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(label)}</span>
    <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);text-align:right">${val}</span></div>` : '';

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><button class="btn btn-ghost btn-sm" id="back">← Contacts</button></div>
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">${esc(name)}</h1>
        <p class="page-subtitle">${esc(contact.title || 'Contact')}${contact.account ? ' · ' : ''}${contact.account ? `<a data-account="${contact.account.id}" style="color:var(--color-accent);cursor:pointer">${esc(contact.account.name)}</a>` : ''}${ownerLabel && ownerLabel !== '—' ? ' · Owner: ' + esc(ownerLabel) : ''}</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-secondary" id="log-activity">Log activity</button>
        <button class="btn btn-secondary" id="edit-contact">Edit</button>
      </div>
    </div>

    <div class="crm-detail-cols">
      <div class="card">
        <div class="card-header"><span class="card-title">Details</span></div>
        <div class="card-body">
          ${infoRow('Email', contact.email ? `<a href="mailto:${esc(contact.email)}" style="color:var(--color-accent)">${esc(contact.email)}</a>` : '')}
          ${infoRow('Phone', contact.phone ? esc(contact.phone) : '')}
          ${infoRow('Title', contact.title ? esc(contact.title) : '')}
          ${infoRow('Account', contact.account ? `<a data-account="${contact.account.id}" style="color:var(--color-accent);cursor:pointer">${esc(contact.account.name)}</a>` : '')}
          ${contact.description ? `<div style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(contact.description)}</div>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Deals (${(opps || []).length})</span></div>
        <div>${renderOpps(opps || [])}</div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4)">
      <div class="card-header"><span class="card-title">Activity</span></div>
      <div id="activity-timeline"></div>
    </div>
  `;

  container.querySelector('#back').addEventListener('click', () => navigate('crm/contacts'));
  container.querySelector('#log-activity').addEventListener('click', () => openActivityModal('contact', id, refreshTimeline));
  container.querySelector('#edit-contact').addEventListener('click', openEdit);
  container.querySelectorAll('[data-account]').forEach(a => a.addEventListener('click', () => navigate(`crm/account?id=${a.dataset.account}`)));
  container.querySelectorAll('[data-opp]').forEach(row => row.addEventListener('click', () => navigate(`crm/opportunity?id=${row.dataset.opp}`)));

  const timelineEl = container.querySelector('#activity-timeline');
  function refreshTimeline() { renderTimeline(timelineEl, 'contact', id); }
  refreshTimeline();

  function renderOpps(list) {
    if (!list.length) return `<div style="padding:var(--space-5);text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm)">No deals yet.</div>`;
    return `<div>${list.map(o => {
      const badge = o.status === 'won' ? 'success' : o.status === 'lost' ? 'error' : 'info';
      return `<div data-opp="${o.id}" style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border-light);cursor:pointer">
        <div>
          <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(o.name)}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(o.stage?.name || '—')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${money(o.amount, o.currency)}</div>
          <span class="badge badge-${badge}" style="font-size:10px">${esc(o.status)}</span>
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  async function openEdit() {
    const accounts = await fetchAccountsLite();
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="crm-cols-2">
        ${field('First name', `<input class="form-input" name="first_name" value="${esc(contact.first_name || '')}">`)}
        ${field('Last name', `<input class="form-input" name="last_name" value="${esc(contact.last_name || '')}">`)}
        ${field('Title', `<input class="form-input" name="title" value="${esc(contact.title || '')}">`)}
        ${field('Email', `<input class="form-input" type="email" name="email" value="${esc(contact.email || '')}">`)}
        ${field('Phone', `<input class="form-input" name="phone" value="${esc(contact.phone || '')}">`)}
        ${field('Owner', `<select class="form-input" name="owner_id">${userOptions(users, contact.owner_id ?? currentUserId())}</select>`)}
      </div>
      ${field('Account', `<select class="form-input" name="account_id">${accountOptions(accounts, contact.account_id)}</select>`)}
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-4)">
        <button type="button" class="btn btn-secondary" id="cancel-c">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>`;
    form.querySelector('#cancel-c').addEventListener('click', closeModal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const update = {
        first_name: fd.get('first_name').trim() || null,
        last_name: fd.get('last_name').trim() || null,
        title: fd.get('title').trim() || null,
        email: fd.get('email').trim() || null,
        phone: fd.get('phone').trim() || null,
        owner_id: fd.get('owner_id') || null,
        account_id: fd.get('account_id') || null,
        updated_at: new Date().toISOString(),
      };
      const { error: upErr } = await sb.from('crm_contacts').update(update).eq('id', id);
      if (upErr) return toast('Could not save contact');
      await logAction('crm', 'contact', id, 'updated', contact, update);
      toast('Contact updated');
      closeModal();
      crmContactDetail(container);
    });
    openModal('Edit contact', form);
  }
}
