// Shared telecalling vocabulary + call logger, matching the imported
// "Telecalling Report" fields (Call Status, Primary/Secondary Call Outcome,
// Reminder Date, Remarks). Used by the telecaller console and the daily view.
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';
import { logAction } from '../../js/audit.js';

export const CALL_STATUS = ['Connected', 'Ringing but No Response', 'Switch Off / Rejected', 'Call Back Later', 'Wrong Number'];
export const PRIMARY_OUTCOME = ['TSS Lead Followup', 'TP Lead Followup', 'TPCA Followup', 'Payment Followup', 'Document Followup', 'Feature Explained', 'Scheme Information', 'Event Invitation', 'Event Attended', 'EDM Shared'];
export const SECONDARY_OUTCOME = ['TSS Closure', 'TP Closure', 'TPCS Closure', 'Payment Followup', 'Feature Explained', 'Scheme Information', 'Document Followup', 'Event Invitation', 'EDM Shared'];

export const CALL_STATUS_BADGE = { 'Connected': 'success', 'Ringing but No Response': 'warning', 'Switch Off / Rejected': 'error', 'Call Back Later': 'info', 'Wrong Number': 'neutral' };

const opts = (arr, sel) => arr.map(o => `<option value="${esc(o)}" ${o === sel ? 'selected' : ''}>${esc(o)}</option>`).join('');

// Opens the log-a-call modal for a partner and writes a crm_calls row.
// `partner` needs { account_id, name, external_id, telecaller, phone, tss_lfy, tss_cfy }.
// Calls onSaved(callRow) after a successful save.
export function logCallModal({ sb, org, user, partner, prefill = {}, onSaved }) {
  const p = partner;
  const f = document.createElement('div');
  f.innerHTML = `
    <div style="display:grid;gap:var(--space-4)">
      <div style="font-size:var(--text-sm)"><strong>${esc(p.name)}</strong>${p.external_id ? ` · <span style="font-family:var(--font-mono)">${esc(p.external_id)}</span>` : ''}
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">
          ${p.phone ? `<a href="tel:${esc(p.phone)}" style="color:var(--color-accent)">${esc(p.phone)}</a> · ` : ''}TSS last year ${p.tss_lfy ?? 0} · this year ${p.tss_cfy ?? 0}${(+p.tss_lfy > 0 && +p.tss_cfy === 0) ? ' — renewal due' : ''}</div></div>
      <div class="crm-cols-2" style="gap:var(--space-3)">
        <div class="form-group" style="margin:0"><label class="form-label">Call status *</label>
          <select class="form-input" id="c-status">${opts(CALL_STATUS, prefill.call_status)}</select></div>
        <div class="form-group" style="margin:0"><label class="form-label">Reminder date</label>
          <input type="date" class="form-input" id="c-follow" value="${esc(prefill.follow_up_date || '')}"></div>
        <div class="form-group" style="margin:0"><label class="form-label">Primary outcome</label>
          <select class="form-input" id="c-primary"><option value="">— Select —</option>${opts(PRIMARY_OUTCOME, prefill.outcome)}</select></div>
        <div class="form-group" style="margin:0"><label class="form-label">Secondary outcome</label>
          <select class="form-input" id="c-secondary"><option value="">— None —</option>${opts(SECONDARY_OUTCOME, prefill.secondary_outcome)}</select></div>
      </div>
      <div class="form-group" style="margin:0"><label class="form-label">Remarks</label>
        <textarea class="form-input" id="c-remarks" rows="2" placeholder="What was discussed">${esc(prefill.remarks || '')}</textarea></div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
        <button type="button" class="btn btn-secondary" id="c-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="c-save">Save call</button>
      </div>
    </div>`;
  openModal('Log a call', f);
  f.querySelector('#c-cancel').addEventListener('click', closeModal);
  f.querySelector('#c-save').addEventListener('click', async () => {
    const btn = f.querySelector('#c-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    const row = {
      org_id: org.id,
      account_id: p.account_id,
      site_id: p.external_id || null,
      firm_name: p.name,
      called_by: user.id,
      called_by_name: user.user_metadata?.full_name || user.email || null,
      telecaller_name: p.telecaller || null,
      called_at: new Date().toISOString(),
      call_status: f.querySelector('#c-status').value,
      outcome: f.querySelector('#c-primary').value || null,
      secondary_outcome: f.querySelector('#c-secondary').value || null,
      remarks: f.querySelector('#c-remarks').value.trim() || null,
      follow_up_date: f.querySelector('#c-follow').value || null,
      source: 'app',
    };
    const { data: call, error } = await sb.from('crm_calls').insert(row).select('id').single();
    if (error || !call) { toast('Could not save call: ' + (error?.message || '')); btn.disabled = false; btn.textContent = 'Save call'; return; }
    await logAction('crm', 'call', call.id, 'logged', null, { account_id: p.account_id, status: row.call_status });
    await publishEvent('crm.call.logged', { call_id: call.id, account_id: p.account_id });
    closeModal();
    toast('Call logged');
    if (onSaved) onSaved({ ...row, id: call.id });
  });
}
