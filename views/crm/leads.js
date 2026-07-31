import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { navigate } from '../../js/router.js';
import { fetchOrgUsers, userOptions, leadName, field, RATING_BADGE, LEAD_STATUS_BADGE, ownerName, currentUserId, canSeeOthers, defaultScope, scopeFilter, scopeTabs } from './common.js';

export default async function crmLeads(container) {
  const org = getOrg();
  const user = getUser();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  let leads = [];
  let users = [];
  let statusFilter = 'active';
  let scope = defaultScope();
  const showScope = canSeeOthers();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Leads</h1>
        <p class="page-subtitle">Capture and qualify new prospects</p>
      </div>
      <button class="btn btn-primary" id="add-lead">+ Lead</button>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-4);align-items:center;flex-wrap:wrap">
        <div class="tabs" id="lead-filter" style="border-bottom:none;margin-bottom:0">
          <button class="tab active" data-f="active">Active</button>
          <button class="tab" data-f="all">All</button>
          <button class="tab" data-f="converted">Converted</button>
        </div>
        ${showScope ? scopeTabs(scope) : ''}
      </div>
      <div id="lead-list"></div>
    </div>
  `;

  async function load() {
    if (!users.length) users = await fetchOrgUsers();
    const { data } = await sb
      .from('crm_leads')
      .select('*')
      .order('created_at', { ascending: false });
    leads = data || [];
    render();
  }

  function render() {
    const el = document.getElementById('lead-list');
    const rows = scopeFilter(leads, scope).filter(l =>
      statusFilter === 'all' ? true :
      statusFilter === 'converted' ? l.status === 'converted' :
      l.status !== 'converted');

    if (!rows.length) {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">${leads.length ? 'Nothing here' : 'No leads yet'}</div>
        <div class="empty-state-desc">${leads.length ? 'Try another filter.' : 'Add your first prospect to start qualifying.'}</div>
      </div>`;
      return;
    }

    el.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Company</th><th>Status</th><th>Rating</th><th>Owner</th><th></th></tr></thead>
      <tbody>${rows.map(l => `
        <tr>
          <td style="font-weight:var(--font-weight-medium)">${esc(leadName(l))}${l.title ? `<div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(l.title)}</div>` : ''}</td>
          <td>${l.company ? esc(l.company) : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>
          <td><span class="badge badge-${LEAD_STATUS_BADGE[l.status] || 'neutral'}"><span class="badge-dot"></span>${esc(l.status)}</span></td>
          <td>${l.rating ? `<span class="badge badge-${RATING_BADGE[l.rating] || 'neutral'}">${esc(l.rating)}</span>` : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>
          <td>${esc(ownerName(users, l.owner_id))}</td>
          <td style="text-align:right;white-space:nowrap">
            ${l.status !== 'converted' ? `<button class="btn btn-secondary btn-sm" data-convert="${l.id}">Convert</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-edit="${l.id}">Edit</button>
          </td>
        </tr>`).join('')}</tbody>
    </table></div>`;

    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(leads.find(l => l.id === b.dataset.edit))));
    el.querySelectorAll('[data-convert]').forEach(b => b.addEventListener('click', () => openConvert(leads.find(l => l.id === b.dataset.convert))));
  }

  function openForm(existing) {
    const l = existing || {};
    const form = document.createElement('form');
    form.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        ${field('First name', `<input class="form-input" name="first_name" value="${esc(l.first_name || '')}">`)}
        ${field('Last name', `<input class="form-input" name="last_name" value="${esc(l.last_name || '')}">`)}
        ${field('Company', `<input class="form-input" name="company" value="${esc(l.company || '')}">`)}
        ${field('Title', `<input class="form-input" name="title" value="${esc(l.title || '')}">`)}
        ${field('Email', `<input class="form-input" type="email" name="email" value="${esc(l.email || '')}">`)}
        ${field('Phone', `<input class="form-input" name="phone" value="${esc(l.phone || '')}">`)}
        ${field('Status', `<select class="form-input" name="status">${['new', 'working', 'qualified', 'unqualified'].map(s => `<option value="${s}" ${(l.status || 'new') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
        ${field('Rating', `<select class="form-input" name="rating"><option value="">—</option>${['hot', 'warm', 'cold'].map(r => `<option value="${r}" ${l.rating === r ? 'selected' : ''}>${r}</option>`).join('')}</select>`)}
        ${field('Source', `<input class="form-input" name="source" value="${esc(l.source || '')}" placeholder="web, referral...">`)}
        ${field('Owner', `<select class="form-input" name="owner_id">${userOptions(users, existing ? l.owner_id : currentUserId())}</select>`)}
      </div>
      ${field('Notes', `<textarea class="form-input" name="description">${esc(l.description || '')}</textarea>`)}
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-4)">
        <button type="button" class="btn btn-secondary" id="cancel-l">Cancel</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Create lead'}</button>
      </div>`;
    form.querySelector('#cancel-l').addEventListener('click', closeModal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
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
      };
      if (!payload.first_name && !payload.last_name && !payload.company && !payload.email) return toast('Enter a name, company, or email');

      if (existing) {
        const { error } = await sb.from('crm_leads').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) return toast('Could not save lead');
        await logAction('crm', 'lead', existing.id, 'updated', existing, payload);
        toast('Lead updated');
      } else {
        const { data, error } = await sb.from('crm_leads').insert({ ...payload, org_id: org.id, created_by: user?.id }).select('id').single();
        if (error) return toast('Could not create lead');
        await logAction('crm', 'lead', data.id, 'created', null, payload);
        await publishEvent('crm.lead.created', { lead_id: data.id, name: leadName(payload), org_id: org.id });
        toast('Lead created');
      }
      closeModal();
      load();
    });
    openModal(existing ? 'Edit lead' : 'New lead', form);
  }

  function openConvert(lead) {
    const form = document.createElement('form');
    form.innerHTML = `
      <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-4)">
        Converting <strong>${esc(leadName(lead))}</strong> creates a contact${lead.company ? ', an account' : ''}, and optionally a deal.
      </p>
      ${lead.company ? field('Account name', `<input class="form-input" name="account_name" value="${esc(lead.company)}">`) : ''}
      ${field('Contact name', `<input class="form-input" name="contact_name" value="${esc(leadName(lead))}">`)}
      <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);margin:var(--space-3) 0;cursor:pointer">
        <input type="checkbox" name="make_opp" checked> Create an opportunity
      </label>
      <div id="opp-fields">
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:var(--space-3)">
          ${field('Deal name', `<input class="form-input" name="opp_name" value="${esc((lead.company || leadName(lead)) + ' — New deal')}">`)}
          ${field('Amount', `<input class="form-input" type="number" name="opp_amount">`)}
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-4)">
        <button type="button" class="btn btn-secondary" id="cancel-cv">Cancel</button>
        <button type="submit" class="btn btn-primary">Convert lead</button>
      </div>`;
    const makeOpp = form.querySelector('[name=make_opp]');
    const oppFields = form.querySelector('#opp-fields');
    makeOpp.addEventListener('change', () => { oppFields.style.display = makeOpp.checked ? '' : 'none'; });
    form.querySelector('#cancel-cv').addEventListener('click', closeModal);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        let accountId = null;
        if (lead.company) {
          const accName = (fd.get('account_name') || lead.company).trim();
          const { data: acc, error: accErr } = await sb.from('crm_accounts')
            .insert({ org_id: org.id, name: accName, phone: lead.phone || null, owner_id: lead.owner_id || user?.id, created_by: user?.id })
            .select('id').single();
          if (accErr) throw accErr;
          accountId = acc.id;
        }

        const cname = (fd.get('contact_name') || leadName(lead)).trim().split(' ');
        const { data: contact, error: cErr } = await sb.from('crm_contacts').insert({
          org_id: org.id, account_id: accountId,
          first_name: cname[0] || null,
          last_name: cname.slice(1).join(' ') || null,
          email: lead.email || null, phone: lead.phone || null, title: lead.title || null,
          owner_id: lead.owner_id || user?.id, created_by: user?.id,
        }).select('id').single();
        if (cErr) throw cErr;

        let oppId = null;
        if (fd.get('make_opp')) {
          const { data: stages } = await sb.from('crm_pipeline_stages').select('id, probability, is_won, is_lost').order('sort_order');
          const stage = (stages || []).find(s => !s.is_won && !s.is_lost);
          const { data: opp, error: oErr } = await sb.from('crm_opportunities').insert({
            org_id: org.id,
            name: (fd.get('opp_name') || 'New deal').trim(),
            account_id: accountId, primary_contact_id: contact.id,
            stage_id: stage?.id || null, probability: stage?.probability ?? null,
            amount: fd.get('opp_amount') ? Number(fd.get('opp_amount')) : null,
            owner_id: lead.owner_id || user?.id, source: lead.source || null, created_by: user?.id,
          }).select('id').single();
          if (oErr) throw oErr;
          oppId = opp.id;
        }

        const { error: lErr } = await sb.from('crm_leads').update({
          status: 'converted', converted_at: new Date().toISOString(),
          converted_account_id: accountId, converted_contact_id: contact.id, converted_opportunity_id: oppId,
          updated_at: new Date().toISOString(),
        }).eq('id', lead.id);
        if (lErr) throw lErr;

        await logAction('crm', 'lead', lead.id, 'converted', null, { account_id: accountId, contact_id: contact.id, opportunity_id: oppId });
        await publishEvent('crm.lead.converted', { lead_id: lead.id, account_id: accountId, contact_id: contact.id, opportunity_id: oppId, org_id: org.id });
        toast('Lead converted');
        closeModal();
        if (accountId) navigate(`crm/account?id=${accountId}`);
        else if (oppId) navigate('crm/opportunities');
        else load();
      } catch (err) {
        toast('Conversion failed');
        btn.disabled = false;
      }
    });
    openModal('Convert lead', form);
  }

  document.getElementById('add-lead').addEventListener('click', () => openForm(null));
  document.getElementById('lead-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    statusFilter = btn.dataset.f;
    document.querySelectorAll('#lead-filter .tab').forEach(t => t.classList.toggle('active', t === btn));
    render();
  });
  container.querySelector('.crm-scope')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    scope = btn.dataset.scope;
    container.querySelectorAll('.crm-scope .tab').forEach(t => t.classList.toggle('active', t === btn));
    render();
  });

  await load();
}
