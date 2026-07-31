import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { navigate } from '../../js/router.js';
import { fetchOrgUsers, userOptions, field, ownerName, currentUserId, canSeeOthers, defaultScope, scopeFilter, scopeTabs } from './common.js';

export default async function crmAccounts(container) {
  const org = getOrg();
  const user = getUser();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  let accounts = [];
  let users = [];
  let search = '';
  let scope = defaultScope();
  const showScope = canSeeOthers();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Accounts</h1>
        <p class="page-subtitle">Companies you do business with</p>
      </div>
      <button class="btn btn-primary" id="add-account">+ Account</button>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-4);align-items:center;flex-wrap:wrap">
        ${showScope ? scopeTabs(scope) : ''}
        <input type="text" class="form-input" id="account-search" placeholder="Search accounts..." style="max-width:280px;height:34px">
      </div>
      <div id="account-list"></div>
    </div>
  `;

  async function load() {
    if (!users.length) users = await fetchOrgUsers();
    const { data } = await sb
      .from('crm_accounts')
      .select('*')
      .order('name');
    accounts = data || [];
    render();
  }

  function render() {
    const el = document.getElementById('account-list');
    const rows = scopeFilter(accounts, scope)
      .filter(a => !search || a.name?.toLowerCase().includes(search) || a.industry?.toLowerCase().includes(search));

    if (!rows.length) {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">${accounts.length ? 'No matches' : 'No accounts yet'}</div>
        <div class="empty-state-desc">${accounts.length ? 'Try a different search.' : 'Add your first company to start tracking deals.'}</div>
      </div>`;
      return;
    }

    el.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Industry</th><th>Website</th><th>Owner</th><th></th></tr></thead>
      <tbody>${rows.map(a => `
        <tr data-id="${a.id}" style="cursor:pointer">
          <td style="font-weight:var(--font-weight-medium)">${esc(a.name)}</td>
          <td>${a.industry ? esc(a.industry) : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>
          <td>${a.website ? `<a href="${esc(a.website.startsWith('http') ? a.website : 'https://' + a.website)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--color-accent)">${esc(a.website)}</a>` : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>
          <td>${esc(ownerName(users, a.owner_id))}</td>
          <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-edit="${a.id}" onclick="event.stopPropagation()">Edit</button></td>
        </tr>`).join('')}</tbody>
    </table></div>`;

    el.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => navigate(`crm/account?id=${tr.dataset.id}`));
    });
    el.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openForm(accounts.find(a => a.id === btn.dataset.edit)));
    });
  }

  function openForm(existing) {
    const a = existing || {};
    const form = document.createElement('form');
    form.innerHTML = `
      ${field('Company name *', `<input class="form-input" name="name" required value="${esc(a.name || '')}">`)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        ${field('Industry', `<input class="form-input" name="industry" value="${esc(a.industry || '')}">`)}
        ${field('Website', `<input class="form-input" name="website" value="${esc(a.website || '')}">`)}
        ${field('Phone', `<input class="form-input" name="phone" value="${esc(a.phone || '')}">`)}
        ${field('Employees', `<input class="form-input" type="number" name="employees_count" value="${a.employees_count ?? ''}">`)}
        ${field('Annual revenue', `<input class="form-input" type="number" name="annual_revenue" value="${a.annual_revenue ?? ''}">`)}
        ${field('Owner', `<select class="form-input" name="owner_id">${userOptions(users, existing ? a.owner_id : currentUserId())}</select>`)}
        ${field('City', `<input class="form-input" name="billing_city" value="${esc(a.billing_city || '')}">`)}
        ${field('Country', `<input class="form-input" name="billing_country" value="${esc(a.billing_country || '')}">`)}
      </div>
      ${field('Notes', `<textarea class="form-input" name="description">${esc(a.description || '')}</textarea>`)}
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-4)">
        <button type="button" class="btn btn-secondary" id="cancel-account">Cancel</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Create account'}</button>
      </div>
    `;
    form.querySelector('#cancel-account').addEventListener('click', closeModal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        name: fd.get('name').trim(),
        industry: fd.get('industry').trim() || null,
        website: fd.get('website').trim() || null,
        phone: fd.get('phone').trim() || null,
        employees_count: fd.get('employees_count') ? parseInt(fd.get('employees_count')) : null,
        annual_revenue: fd.get('annual_revenue') ? Number(fd.get('annual_revenue')) : null,
        owner_id: fd.get('owner_id') || null,
        billing_city: fd.get('billing_city').trim() || null,
        billing_country: fd.get('billing_country').trim() || null,
        description: fd.get('description').trim() || null,
      };
      if (!payload.name) return;

      if (existing) {
        const { error } = await sb.from('crm_accounts').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) return toast('Could not save account');
        await logAction('crm', 'account', existing.id, 'updated', existing, payload);
        toast('Account updated');
      } else {
        const { data, error } = await sb.from('crm_accounts').insert({ ...payload, org_id: org.id, created_by: user?.id }).select('id').single();
        if (error) return toast('Could not create account');
        await logAction('crm', 'account', data.id, 'created', null, payload);
        await publishEvent('crm.account.created', { account_id: data.id, name: payload.name, org_id: org.id });
        toast('Account created');
      }
      closeModal();
      load();
    });
    openModal(existing ? 'Edit account' : 'New account', form);
  }

  document.getElementById('add-account').addEventListener('click', () => openForm(null));
  document.getElementById('account-search').addEventListener('input', (e) => { search = e.target.value.toLowerCase().trim(); render(); });
  container.querySelector('.crm-scope')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    scope = btn.dataset.scope;
    container.querySelectorAll('.crm-scope .tab').forEach(t => t.classList.toggle('active', t === btn));
    render();
  });

  await load();
}
