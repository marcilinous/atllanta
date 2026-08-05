import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, downloadCsv, loadingSkeleton, parseCsv } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { navigate } from '../../js/router.js';
import { fetchOrgUsers, userOptions, fetchAccountsLite, accountOptions, contactName, field, currentUserId, canSeeOthers, canManageData, defaultScope, scopeFilter, scopeTabs } from './common.js';

export default async function crmContacts(container) {
  const org = getOrg();
  const user = getUser();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  let contacts = [];
  let users = [];
  let accounts = [];
  let search = '';
  let scope = defaultScope();
  const showScope = canSeeOthers();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Contacts</h1>
        <p class="page-subtitle">People at your partners</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        ${canManageData() ? `<button class="btn btn-secondary" id="import-contacts">Import</button>
        <button class="btn btn-secondary" id="export-contacts">Export</button>` : ''}
        <button class="btn btn-primary" id="add-contact">+ Contact</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-4);align-items:center;flex-wrap:wrap">
        ${showScope ? scopeTabs(scope) : ''}
        <input type="text" class="form-input" id="contact-search" placeholder="Search contacts..." style="max-width:280px;height:34px">
      </div>
      <div id="contact-list">${loadingSkeleton()}</div>
    </div>
  `;

  async function load() {
    if (!users.length) users = await fetchOrgUsers();
    if (!accounts.length) accounts = await fetchAccountsLite();
    const { data } = await sb
      .from('crm_contacts')
      .select('*, account:account_id(id, name)')
      .order('created_at', { ascending: false });
    contacts = data || [];
    render();
  }

  function render() {
    const el = document.getElementById('contact-list');
    const rows = scopeFilter(contacts, scope).filter(c => {
      if (!search) return true;
      return contactName(c).toLowerCase().includes(search) || c.email?.toLowerCase().includes(search) || c.account?.name?.toLowerCase().includes(search);
    });

    if (!rows.length) {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">${contacts.length ? 'No matches' : 'No contacts yet'}</div>
        <div class="empty-state-desc">${contacts.length ? 'Try a different search.' : 'Add the people you sell to.'}</div>
      </div>`;
      return;
    }

    el.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Title</th><th>Partner</th><th>Email</th><th>Phone</th><th></th></tr></thead>
      <tbody>${rows.map(c => `
        <tr>
          <td style="font-weight:var(--font-weight-medium)"><a data-contact="${c.id}" style="color:var(--color-accent);cursor:pointer">${esc(contactName(c))}</a></td>
          <td>${c.title ? esc(c.title) : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>
          <td>${c.account ? `<a data-account="${c.account.id}" style="color:var(--color-accent);cursor:pointer">${esc(c.account.name)}</a>` : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>
          <td>${c.email ? `<a href="mailto:${esc(c.email)}" style="color:var(--color-accent)">${esc(c.email)}</a>` : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>
          <td>${c.phone ? esc(c.phone) : '<span style="color:var(--color-text-tertiary)">—</span>'}</td>
          <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-edit="${c.id}">Edit</button></td>
        </tr>`).join('')}</tbody>
    </table></div>`;

    el.querySelectorAll('[data-account]').forEach(a => a.addEventListener('click', () => navigate(`crm/account?id=${a.dataset.account}`)));
    el.querySelectorAll('[data-contact]').forEach(a => a.addEventListener('click', () => navigate(`crm/contact?id=${a.dataset.contact}`)));
    el.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => openForm(contacts.find(c => c.id === btn.dataset.edit))));
  }

  function openForm(existing) {
    const c = existing || {};
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="crm-cols-2">
        ${field('First name', `<input class="form-input" name="first_name" value="${esc(c.first_name || '')}">`)}
        ${field('Last name', `<input class="form-input" name="last_name" value="${esc(c.last_name || '')}">`)}
        ${field('Title', `<input class="form-input" name="title" value="${esc(c.title || '')}">`)}
        ${field('Email', `<input class="form-input" type="email" name="email" value="${esc(c.email || '')}">`)}
        ${field('Phone', `<input class="form-input" name="phone" value="${esc(c.phone || '')}">`)}
        ${field('Owner', `<select class="form-input" name="owner_id">${userOptions(users, existing ? c.owner_id : currentUserId())}</select>`)}
      </div>
      ${field('Partner', `<select class="form-input" name="account_id">${accountOptions(accounts, c.account_id)}</select>`)}
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-4)">
        <button type="button" class="btn btn-secondary" id="cancel-c">Cancel</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Create contact'}</button>
      </div>`;
    form.querySelector('#cancel-c').addEventListener('click', closeModal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        first_name: fd.get('first_name').trim() || null,
        last_name: fd.get('last_name').trim() || null,
        title: fd.get('title').trim() || null,
        email: fd.get('email').trim() || null,
        phone: fd.get('phone').trim() || null,
        owner_id: fd.get('owner_id') || null,
        account_id: fd.get('account_id') || null,
      };
      if (!payload.first_name && !payload.last_name && !payload.email) return toast('Enter a name or email');

      if (existing) {
        const { error } = await sb.from('crm_contacts').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) return toast('Could not save contact');
        await logAction('crm', 'contact', existing.id, 'updated', existing, payload);
        toast('Contact updated');
      } else {
        const { data, error } = await sb.from('crm_contacts').insert({ ...payload, org_id: org.id, created_by: user?.id }).select('id').single();
        if (error) return toast('Could not create contact');
        await logAction('crm', 'contact', data.id, 'created', null, payload);
        await publishEvent('crm.contact.created', { contact_id: data.id, account_id: payload.account_id, org_id: org.id });
        toast('Contact created');
      }
      closeModal();
      load();
    });
    openModal(existing ? 'Edit contact' : 'New contact', form);
  }

  document.getElementById('add-contact').addEventListener('click', () => openForm(null));
  document.getElementById('import-contacts')?.addEventListener('click', openImport);

  function pick(row, ...keys) {
    for (const k of keys) { if (row[k]?.trim()) return row[k].trim(); }
    return '';
  }

  function rowToContact(r) {
    let first = pick(r, 'first_name', 'first name', 'firstname');
    let last = pick(r, 'last_name', 'last name', 'lastname');
    const full = pick(r, 'name', 'full name', 'fullname');
    if (!first && !last && full) { const p = full.split(' '); first = p[0]; last = p.slice(1).join(' '); }
    const accName = pick(r, 'account', 'company', 'organization', 'organisation').toLowerCase();
    const account = accName ? accounts.find(a => a.name?.toLowerCase() === accName) : null;
    return {
      org_id: org.id,
      first_name: first || null,
      last_name: last || null,
      title: pick(r, 'title', 'designation', 'job title') || null,
      email: pick(r, 'email', 'email address', 'e-mail') || null,
      phone: pick(r, 'phone', 'mobile', 'phone number', 'contact number') || null,
      account_id: account?.id || null,
      owner_id: user?.id || null,
      created_by: user?.id || null,
    };
  }

  function openImport() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div style="display:grid;gap:var(--space-3)">
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">
          Upload a CSV with columns like <strong>first_name, last_name, title, email, phone, account</strong>.
          A single <strong>name</strong> column works too. An <strong>account</strong>/<strong>company</strong> value is linked to a matching account if one exists.
        </div>
        <input type="file" accept=".csv,text/csv" class="form-input" id="import-file">
        <div id="import-preview" style="font-size:var(--text-sm);color:var(--color-text-secondary)"></div>
        <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
          <button type="button" class="btn btn-secondary" id="import-cancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="import-go" disabled>Import</button>
        </div>
      </div>`;
    let parsed = [];
    wrap.querySelector('#import-cancel').addEventListener('click', closeModal);
    wrap.querySelector('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      parsed = parseCsv(text).map(rowToContact).filter(c => c.first_name || c.last_name || c.email);
      const preview = wrap.querySelector('#import-preview');
      const go = wrap.querySelector('#import-go');
      if (!parsed.length) {
        preview.innerHTML = `<span style="color:var(--color-error)">No valid rows found. Check your headers.</span>`;
        go.disabled = true;
      } else {
        const linked = parsed.filter(c => c.account_id).length;
        preview.innerHTML = `Ready to import <strong>${parsed.length}</strong> contact${parsed.length !== 1 ? 's' : ''}${linked ? ` (${linked} linked to accounts)` : ''}.`;
        go.disabled = false;
      }
    });
    wrap.querySelector('#import-go').addEventListener('click', async () => {
      const go = wrap.querySelector('#import-go');
      go.disabled = true; go.textContent = 'Importing...';
      const { error } = await sb.from('crm_contacts').insert(parsed);
      if (error) { toast('Import failed: ' + error.message); go.disabled = false; go.textContent = 'Import'; return; }
      await logAction('crm', 'contact', null, 'imported', null, { count: parsed.length });
      toast(`Imported ${parsed.length} contact${parsed.length !== 1 ? 's' : ''}`);
      closeModal();
      load();
    });
    openModal('Import contacts', wrap);
  }
  document.getElementById('export-contacts')?.addEventListener('click', () => {
    const rows = scopeFilter(contacts, scope)
      .filter(c => !search || contactName(c).toLowerCase().includes(search) || c.email?.toLowerCase().includes(search) || c.account?.name?.toLowerCase().includes(search))
      .map(c => ({ Name: contactName(c), Title: c.title || '', Partner: c.account?.name || '', Email: c.email || '', Phone: c.phone || '' }));
    downloadCsv('contacts.csv', rows);
  });
  document.getElementById('contact-search').addEventListener('input', (e) => { search = e.target.value.toLowerCase().trim(); render(); });
  container.querySelector('.crm-scope')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    scope = btn.dataset.scope;
    container.querySelectorAll('.crm-scope .tab').forEach(t => t.classList.toggle('active', t === btn));
    render();
  });

  await load();
}
