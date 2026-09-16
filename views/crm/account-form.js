import sb from '../../js/supabase.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

// Shared create/edit modal for crm_accounts, used by the list and detail views.
// onSaved(savedRow, isNew) lets the caller refresh its own state.
export function openAccountForm({ account, org, user, onSaved } = {}) {
  const existing = account && account.id ? account : null;
  const a = account || {};
  const form = document.createElement('form');
  form.className = 'u-stack-4';
  form.innerHTML = `
    <div class="form-group">
      <label class="form-label">Name <span style="color:var(--color-error)">*</span></label>
      <input class="form-input" name="name" required value="${esc(a.name || '')}" placeholder="Acme Corp">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
      <div class="form-group"><label class="form-label">Industry</label><input class="form-input" name="industry" value="${esc(a.industry || '')}"></div>
      <div class="form-group"><label class="form-label">Website</label><input class="form-input" name="website" value="${esc(a.website || '')}" placeholder="acme.com"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
      <div class="form-group"><label class="form-label">Phone</label><input class="form-input" name="phone" value="${esc(a.phone || '')}"></div>
      <div class="form-group"><label class="form-label">Tier</label><input class="form-input" name="tier" value="${esc(a.tier || '')}" placeholder="Gold"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
      <div class="form-group"><label class="form-label">Region</label><input class="form-input" name="region" value="${esc(a.region || '')}"></div>
      <div class="form-group"><label class="form-label">Billing city</label><input class="form-input" name="billing_city" value="${esc(a.billing_city || '')}"></div>
    </div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" name="description" rows="3">${esc(a.description || '')}</textarea></div>
    <div id="acc-form-err" class="hidden" style="color:var(--color-error);font-size:var(--text-sm)"></div>
    <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
      <button type="button" class="btn btn-secondary" id="acc-cancel">Cancel</button>
      <button type="submit" class="btn btn-primary" id="acc-save">${existing ? 'Save changes' : 'Create account'}</button>
    </div>
  `;
  openModal(existing ? 'Edit account' : 'New account', form);
  form.querySelector('#acc-cancel').addEventListener('click', closeModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('#acc-form-err');
    const saveBtn = form.querySelector('#acc-save');
    errEl.classList.add('hidden');
    const fd = new FormData(form);
    const name = (fd.get('name') || '').toString().trim();
    if (!name) { errEl.textContent = 'Name is required.'; errEl.classList.remove('hidden'); return; }

    const payload = {
      name,
      industry: (fd.get('industry') || '').toString().trim() || null,
      website: (fd.get('website') || '').toString().trim() || null,
      phone: (fd.get('phone') || '').toString().trim() || null,
      tier: (fd.get('tier') || '').toString().trim() || null,
      region: (fd.get('region') || '').toString().trim() || null,
      billing_city: (fd.get('billing_city') || '').toString().trim() || null,
      description: (fd.get('description') || '').toString().trim() || null,
    };

    saveBtn.disabled = true;
    saveBtn.textContent = existing ? 'Saving...' : 'Creating...';

    let result;
    if (existing) {
      result = await sb.from('crm_accounts').update(payload).eq('id', existing.id).select().single();
    } else {
      result = await sb.from('crm_accounts')
        .insert({ ...payload, org_id: org.id, owner_id: user.id, created_by: user.id })
        .select().single();
    }

    if (result.error) {
      saveBtn.disabled = false;
      saveBtn.textContent = existing ? 'Save changes' : 'Create account';
      errEl.textContent = result.error.message;
      errEl.classList.remove('hidden');
      return;
    }

    const saved = result.data;
    if (existing) {
      logAction('crm', 'account', saved.id, 'updated', existing, saved);
      publishEvent('crm.account.updated', { account_id: saved.id, name: saved.name });
    } else {
      logAction('crm', 'account', saved.id, 'created', null, saved);
      publishEvent('crm.account.created', { account_id: saved.id, name: saved.name });
    }
    closeModal();
    toast(existing ? 'Account updated' : 'Account created');
    if (onSaved) onSaved(saved, !existing);
  });
}
