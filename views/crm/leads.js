import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, downloadCsv } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { navigate } from '../../js/router.js';
import { fetchOrgUsers, userOptions, leadName, field, RATING_BADGE, LEAD_STATUS_BADGE, ownerName, currentUserId, canSeeOthers, defaultScope, scopeFilter, scopeTabs } from './common.js';
import { openConvertModal } from './lead-actions.js';

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
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-secondary" id="export-leads">Export</button>
        <button class="btn btn-primary" id="add-lead">+ Lead</button>
      </div>
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
          <td style="font-weight:var(--font-weight-medium)"><a data-lead="${l.id}" style="color:var(--color-accent);cursor:pointer">${esc(leadName(l))}</a>${l.title ? `<div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(l.title)}</div>` : ''}</td>
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

    el.querySelectorAll('[data-lead]').forEach(a => a.addEventListener('click', () => navigate(`crm/lead?id=${a.dataset.lead}`)));
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(leads.find(l => l.id === b.dataset.edit))));
    el.querySelectorAll('[data-convert]').forEach(b => b.addEventListener('click', () => openConvertModal(leads.find(l => l.id === b.dataset.convert), load)));
  }

  function openForm(existing) {
    const l = existing || {};
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="crm-cols-2">
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
        await publishEvent('crm.lead.created', { lead_id: data.id, name: leadName(payload), owner_id: payload.owner_id, org_id: org.id });
        toast('Lead created');
      }
      closeModal();
      load();
    });
    openModal(existing ? 'Edit lead' : 'New lead', form);
  }

  document.getElementById('add-lead').addEventListener('click', () => openForm(null));
  document.getElementById('export-leads').addEventListener('click', () => {
    const rows = scopeFilter(leads, scope)
      .filter(l => statusFilter === 'all' ? true : statusFilter === 'converted' ? l.status === 'converted' : l.status !== 'converted')
      .map(l => ({ Name: leadName(l), Company: l.company || '', Title: l.title || '', Email: l.email || '', Phone: l.phone || '', Status: l.status, Rating: l.rating || '', Source: l.source || '', Owner: ownerName(users, l.owner_id) }));
    downloadCsv('leads.csv', rows);
  });
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
