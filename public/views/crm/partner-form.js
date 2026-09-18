import sb from '../../js/supabase.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

// Create / edit modal for crm_partner_details. Any org member (BDEs included)
// can onboard a partner or edit one; RLS enforces org scope. onSaved(row, isNew)
// lets the caller refresh.

// Field groups → [name, label, type]. type 'num' → numeric, else text.
const GROUPS = [
  ['Identity', [
    ['site_id', 'Site ID', 'text'],
    ['role', 'Role', 'text'],
    ['role_status', 'Role Status', 'text'],
    ['top_25_list', 'Top 25 list', 'text'],
  ]],
  ['Contact', [
    ['contact_person_name', 'Contact Person', 'text'],
    ['email_address', 'Email', 'text'],
    ['mobile_number', 'Mobile', 'text'],
    ['alternative_mobile_no', 'Alt. Mobile', 'text'],
  ]],
  ['Location', [
    ['city', 'City', 'text'],
    ['pincode', 'Pincode', 'text'],
    ['district', 'District', 'text'],
    ['state', 'State', 'text'],
    ['region', 'Region', 'text'],
    ['hub', 'Hub', 'text'],
    ['coordinates', 'Co-ordinates', 'text'],
  ]],
  ['Tally & Tax', [
    ['tally_serial_no', 'Tally Serial No.', 'text'],
    ['pan_no', 'PAN No', 'text'],
    ['gstin', 'GSTIN', 'text'],
  ]],
  ['Assignment', [
    ['bde_name', 'BDE Name', 'text'],
    ['telecaller_name', 'Telecaller Name', 'text'],
  ]],
  ['Finance', [
    ['credit_limit', 'Credit Limit', 'num'],
    ['account_number', 'Account Number', 'text'],
    ['bank_name', 'Bank Name', 'text'],
    ['ifsc_code', 'IFSC Code', 'text'],
    ['upi_id', 'UPI ID', 'text'],
  ]],
  ['AP-CP Taalmel', [
    ['ap_cp_taalmel', 'AP-CP Taalmel', 'text'],
    ['ap_cp_taalmel_partner', 'AP-CP Taalmel Partner', 'text'],
  ]],
];
const ALL_FIELDS = GROUPS.flatMap(([, fs]) => fs);

export function openPartnerForm({ partner, org, user, onSaved } = {}) {
  const existing = partner && partner.id ? partner : null;
  const p = partner || {};
  const form = document.createElement('form');
  form.className = 'u-stack-4';
  form.innerHTML = `
    <div class="form-group">
      <label class="form-label">Partner Name <span style="color:var(--color-error)">*</span></label>
      <input class="form-input" name="partner_name" required value="${esc(p.partner_name || '')}" placeholder="Acme Systems">
    </div>
    ${GROUPS.map(([title, fields]) => `
      <div>
        <div class="u-sm-muted" style="font-weight:var(--font-weight-semibold);margin-bottom:var(--space-2)">${esc(title)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          ${fields.map(([name, label, type]) => `
            <div class="form-group">
              <label class="form-label">${esc(label)}</label>
              <input class="form-input" name="${name}" ${type === 'num' ? 'type="number" step="any"' : ''} value="${esc(p[name] == null ? '' : String(p[name]))}">
            </div>`).join('')}
        </div>
      </div>`).join('')}
    <div class="form-group">
      <label class="form-label">Address</label>
      <textarea class="form-input" name="address" rows="2">${esc(p.address || '')}</textarea>
    </div>
    <div id="pf-err" class="hidden" style="color:var(--color-error);font-size:var(--text-sm)"></div>
    <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
      <button type="button" class="btn btn-secondary" id="pf-cancel">Cancel</button>
      <button type="submit" class="btn btn-primary" id="pf-save">${existing ? 'Save changes' : 'Onboard partner'}</button>
    </div>
  `;
  openModal(existing ? 'Edit partner' : 'Onboard partner', form);
  form.querySelector('#pf-cancel').addEventListener('click', closeModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('#pf-err');
    const saveBtn = form.querySelector('#pf-save');
    errEl.classList.add('hidden');
    const fd = new FormData(form);
    const partner_name = (fd.get('partner_name') || '').toString().trim();
    if (!partner_name) { errEl.textContent = 'Partner name is required.'; errEl.classList.remove('hidden'); return; }

    const payload = { partner_name, address: (fd.get('address') || '').toString().trim() || null };
    for (const [name, , type] of ALL_FIELDS) {
      const raw = (fd.get(name) || '').toString().trim();
      if (type === 'num') {
        payload[name] = raw === '' ? null : (Number.isFinite(Number(raw)) ? Number(raw) : null);
      } else {
        payload[name] = raw || null;
      }
    }

    saveBtn.disabled = true;
    saveBtn.textContent = existing ? 'Saving...' : 'Onboarding...';

    let result;
    if (existing) {
      result = await sb.from('crm_partner_details').update(payload).eq('id', existing.id).select().single();
    } else {
      result = await sb.from('crm_partner_details')
        .insert({ ...payload, org_id: org.id, created_by: user.id })
        .select().single();
    }

    if (result.error) {
      saveBtn.disabled = false;
      saveBtn.textContent = existing ? 'Save changes' : 'Onboard partner';
      errEl.textContent = result.error.message;
      errEl.classList.remove('hidden');
      return;
    }

    const saved = result.data;
    logAction('crm', 'partner_detail', saved.id, existing ? 'updated' : 'created', existing || null, saved);
    publishEvent(existing ? 'crm.partner.updated' : 'crm.partner.created',
      { partner_id: saved.id, partner_name: saved.partner_name });
    closeModal();
    toast(existing ? 'Partner updated' : 'Partner onboarded');
    if (onSaved) onSaved(saved, !existing);
  });
}
