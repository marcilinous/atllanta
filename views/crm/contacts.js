import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, initials, avColor } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

// CRM › Contacts. People at accounts. CRUD over crm_contacts (anon+RLS).
export default async function crmContacts(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const canEdit = ['owner', 'admin', 'manager'].includes(membership?.role || 'member');

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Contacts</h1>
        <p class="page-subtitle">People at your accounts</p>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        <a href="#/crm" class="btn btn-secondary">← CRM</a>
        ${canEdit ? '<button class="btn btn-primary" id="add-contact-btn">+ New Contact</button>' : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        <input type="text" class="form-input" id="ct-search" placeholder="Search name, email, phone..." style="max-width:300px;height:34px;flex:1">
        <select class="form-input" id="ct-account-filter" style="max-width:220px;height:34px"><option value="">All accounts</option></select>
      </div>
      <div id="ct-table-wrap"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
    </div>
  `;

  if (!org) { document.getElementById('ct-table-wrap').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  let contacts = [];
  const accountMap = {};
  let accounts = [];

  const [{ data: cts, error: ctErr }, { data: accs }] = await Promise.all([
    sb.from('crm_contacts').select('*').order('created_at', { ascending: false }),
    sb.from('crm_accounts').select('id, name').order('name'),
  ]);
  if (ctErr) toast('Failed to load contacts: ' + ctErr.message);
  contacts = cts || [];
  accounts = accs || [];
  accounts.forEach(a => { accountMap[a.id] = a.name; });

  const acctFilter = document.getElementById('ct-account-filter');
  accounts.forEach(a => { const o = document.createElement('option'); o.value = a.id; o.textContent = a.name; acctFilter.appendChild(o); });

  function fullName(c) { return [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'; }

  function renderTable() {
    const wrap = document.getElementById('ct-table-wrap');
    const q = (document.getElementById('ct-search')?.value || '').toLowerCase();
    const acc = acctFilter.value || '';
    let rows = contacts;
    if (q) rows = rows.filter(c => fullName(c).toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q));
    if (acc) rows = rows.filter(c => c.account_id === acc);

    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
        <div class="empty-state-title">${q || acc ? 'No matching contacts' : 'No contacts yet'}</div>
        <div class="empty-state-desc">${q || acc ? 'Try adjusting your filters.' : canEdit ? 'Add your first contact.' : 'Contacts will appear here once added.'}</div>
      </div>`;
      return;
    }

    wrap.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Account</th><th>Title</th><th>Email</th><th>Phone</th></tr></thead>
      <tbody>${rows.map(c => `<tr${canEdit ? ' style="cursor:pointer"' : ''} data-id="${c.id}">
        <td><div class="u-row-3">
          <div style="width:30px;height:30px;border-radius:var(--radius-full);background:${avColor(fullName(c))};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(fullName(c))}</div>
          <span style="font-weight:var(--font-weight-medium)">${esc(fullName(c))}</span>
        </div></td>
        <td>${esc(accountMap[c.account_id] || '—')}</td>
        <td>${esc(c.title || '—')}</td>
        <td>${esc(c.email || '—')}</td>
        <td>${esc(c.phone || '—')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;

    if (canEdit) wrap.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', () => openContactForm(contacts.find(c => c.id === row.dataset.id)));
    });
  }

  renderTable();
  document.getElementById('ct-search').addEventListener('input', renderTable);
  acctFilter.addEventListener('change', renderTable);
  if (canEdit) document.getElementById('add-contact-btn').addEventListener('click', () => openContactForm());

  function openContactForm(existing) {
    const c = existing || {};
    const form = document.createElement('form');
    form.className = 'u-stack-4';
    form.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">First name</label><input class="form-input" name="first_name" value="${esc(c.first_name || '')}"></div>
        <div class="form-group"><label class="form-label">Last name</label><input class="form-input" name="last_name" value="${esc(c.last_name || '')}"></div>
      </div>
      <div class="form-group"><label class="form-label">Account</label>
        <select class="form-input" name="account_id">
          <option value="">— None —</option>
          ${accounts.map(a => `<option value="${a.id}" ${c.account_id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Title</label><input class="form-input" name="title" value="${esc(c.title || '')}"></div>
        <div class="form-group"><label class="form-label">Phone</label><input class="form-input" name="phone" value="${esc(c.phone || '')}"></div>
      </div>
      <div class="form-group"><label class="form-label">Email</label><input class="form-input" type="email" name="email" value="${esc(c.email || '')}"></div>
      <div id="ct-err" class="hidden" style="color:var(--color-error);font-size:var(--text-sm)"></div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
        <button type="button" class="btn btn-secondary" id="ct-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="ct-save">${existing ? 'Save changes' : 'Create contact'}</button>
      </div>
    `;
    openModal(existing ? 'Edit contact' : 'New contact', form);
    form.querySelector('#ct-cancel').addEventListener('click', closeModal);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('#ct-err');
      const btn = form.querySelector('#ct-save');
      errEl.classList.add('hidden');
      const fd = new FormData(form);
      const first = (fd.get('first_name') || '').toString().trim();
      const last = (fd.get('last_name') || '').toString().trim();
      if (!first && !last) { errEl.textContent = 'Enter a first or last name.'; errEl.classList.remove('hidden'); return; }

      const payload = {
        first_name: first || null,
        last_name: last || null,
        account_id: (fd.get('account_id') || '').toString() || null,
        title: (fd.get('title') || '').toString().trim() || null,
        phone: (fd.get('phone') || '').toString().trim() || null,
        email: (fd.get('email') || '').toString().trim() || null,
      };

      btn.disabled = true; btn.textContent = existing ? 'Saving...' : 'Creating...';
      let result;
      if (existing) result = await sb.from('crm_contacts').update(payload).eq('id', existing.id).select().single();
      else result = await sb.from('crm_contacts').insert({ ...payload, org_id: org.id, owner_id: user.id, created_by: user.id }).select().single();

      if (result.error) { btn.disabled = false; btn.textContent = existing ? 'Save changes' : 'Create contact'; errEl.textContent = result.error.message; errEl.classList.remove('hidden'); return; }
      const saved = result.data;
      if (existing) { const i = contacts.findIndex(x => x.id === saved.id); if (i !== -1) contacts[i] = saved; logAction('crm', 'contact', saved.id, 'updated', existing, saved); publishEvent('crm.contact.updated', { contact_id: saved.id }); }
      else { contacts.unshift(saved); logAction('crm', 'contact', saved.id, 'created', null, saved); publishEvent('crm.contact.created', { contact_id: saved.id, account_id: saved.account_id }); }
      closeModal();
      toast(existing ? 'Contact updated' : 'Contact created');
      renderTable();
    });
  }
}
