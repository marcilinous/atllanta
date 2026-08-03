import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { navigate, routeParams } from '../../js/router.js';
import { money, contactName, field, ownerName, fetchOrgUsers } from './common.js';
import { renderTimeline, openActivityModal } from './activities.js';

export default async function crmAccountDetail(container) {
  const org = getOrg();
  const user = getUser();
  const { id } = routeParams();
  if (!org || !id) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Account not found</div></div>`; return; }

  const { data: account, error } = await sb
    .from('crm_accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !account) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Account not found</div>
      <button class="btn btn-secondary" id="back">Back to accounts</button></div>`;
    container.querySelector('#back')?.addEventListener('click', () => navigate('crm/accounts'));
    return;
  }

  const [{ data: contacts }, { data: opps }, users] = await Promise.all([
    sb.from('crm_contacts').select('*').eq('account_id', id).order('created_at', { ascending: false }),
    sb.from('crm_opportunities').select('*, stage:stage_id(name, is_won, is_lost)').eq('account_id', id).order('created_at', { ascending: false }),
    fetchOrgUsers(),
  ]);
  const ownerLabel = account.owner_id ? ownerName(users, account.owner_id) : null;

  const infoRow = (label, val) => val ? `<div style="display:flex;justify-content:space-between;gap:var(--space-4);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
    <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(label)}</span>
    <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);text-align:right">${val}</span></div>` : '';

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)">
      <button class="btn btn-ghost btn-sm" id="back">← Accounts</button>
    </div>
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">${esc(account.name)}</h1>
        <p class="page-subtitle">${esc(account.industry || 'Account')}${ownerLabel && ownerLabel !== '—' ? ' · Owner: ' + esc(ownerLabel) : ''}</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-secondary" id="log-activity">Log activity</button>
        <button class="btn btn-primary" id="new-deal">+ Deal</button>
      </div>
    </div>

    <div class="crm-detail-cols">
      <div class="card">
        <div class="card-header"><span class="card-title">Details</span></div>
        <div class="card-body">
          ${infoRow('Website', account.website ? `<a href="${esc(account.website.startsWith('http') ? account.website : 'https://' + account.website)}" target="_blank" rel="noopener" style="color:var(--color-accent)">${esc(account.website)}</a>` : '')}
          ${infoRow('Phone', account.phone ? esc(account.phone) : '')}
          ${infoRow('Employees', account.employees_count ? esc(String(account.employees_count)) : '')}
          ${infoRow('Annual revenue', account.annual_revenue ? money(account.annual_revenue) : '')}
          ${infoRow('Location', [account.billing_city, account.billing_country].filter(Boolean).map(esc).join(', '))}
          ${account.description ? `<div style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(account.description)}</div>` : ''}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="card">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
            <span class="card-title" id="contacts-count">Contacts (${(contacts || []).length})</span>
            <button class="btn btn-ghost btn-sm" id="add-contact">+ Add</button>
          </div>
          <div id="contacts-body">${renderContacts(contacts || [])}</div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Opportunities (${(opps || []).length})</span></div>
          <div>${renderOpps(opps || [])}</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4)">
      <div class="card-header"><span class="card-title">Activity</span></div>
      <div id="activity-timeline"></div>
    </div>
  `;

  container.querySelector('#back').addEventListener('click', () => navigate('crm/accounts'));
  container.querySelector('#new-deal').addEventListener('click', () => navigate(`crm/opportunities?account=${id}`));
  container.querySelector('#log-activity').addEventListener('click', () => openActivityModal('account', id, refreshTimeline));
  container.querySelector('#add-contact').addEventListener('click', openContactForm);

  wireContactRows();
  container.querySelectorAll('[data-opp]').forEach(row => {
    row.addEventListener('click', () => navigate(`crm/opportunity?id=${row.dataset.opp}`));
  });

  function wireContactRows() {
    container.querySelectorAll('#contacts-body [data-contact]').forEach(row => {
      row.addEventListener('click', () => navigate(`crm/contact?id=${row.dataset.contact}`));
    });
  }

  async function reloadContacts() {
    const { data: fresh } = await sb.from('crm_contacts').select('*').eq('account_id', id).order('created_at', { ascending: false });
    container.querySelector('#contacts-body').innerHTML = renderContacts(fresh || []);
    container.querySelector('#contacts-count').textContent = `Contacts (${(fresh || []).length})`;
    wireContactRows();
  }

  const timelineEl = container.querySelector('#activity-timeline');
  function refreshTimeline() { renderTimeline(timelineEl, 'account', id); }
  refreshTimeline();

  function renderContacts(list) {
    if (!list.length) return `<div style="padding:var(--space-5);text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm)">No contacts yet.</div>`;
    return `<div>${list.map(c => `
      <div data-contact="${c.id}" style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border-light);cursor:pointer">
        <div>
          <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(contactName(c))}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc([c.title, c.email].filter(Boolean).join(' · ') || '—')}</div>
        </div>
        ${c.phone ? `<span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(c.phone)}</span>` : ''}
      </div>`).join('')}</div>`;
  }

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

  function openContactForm() {
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="crm-cols-2">
        ${field('First name', `<input class="form-input" name="first_name">`)}
        ${field('Last name', `<input class="form-input" name="last_name">`)}
        ${field('Title', `<input class="form-input" name="title">`)}
        ${field('Email', `<input class="form-input" type="email" name="email">`)}
        ${field('Phone', `<input class="form-input" name="phone">`)}
      </div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-4)">
        <button type="button" class="btn btn-secondary" id="cancel-c">Cancel</button>
        <button type="submit" class="btn btn-primary">Add contact</button>
      </div>`;
    form.querySelector('#cancel-c').addEventListener('click', closeModal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        org_id: org.id, account_id: id,
        first_name: fd.get('first_name').trim() || null,
        last_name: fd.get('last_name').trim() || null,
        title: fd.get('title').trim() || null,
        email: fd.get('email').trim() || null,
        phone: fd.get('phone').trim() || null,
        created_by: user?.id, owner_id: user?.id,
      };
      if (!payload.first_name && !payload.last_name && !payload.email) return toast('Enter a name or email');
      const { data, error } = await sb.from('crm_contacts').insert(payload).select('id').single();
      if (error) return toast('Could not add contact');
      await logAction('crm', 'contact', data.id, 'created', null, payload);
      await publishEvent('crm.contact.created', { contact_id: data.id, account_id: id, org_id: org.id });
      toast('Contact added');
      closeModal();
      reloadContacts();
    });
    openModal('Add contact', form);
  }
}
