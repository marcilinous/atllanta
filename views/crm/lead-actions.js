// Shared lead conversion flow, used by the leads list and the lead detail.
import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { navigate } from '../../js/router.js';
import { leadName, field } from './common.js';

// Convert a lead into an account (if it has a company), a contact, and
// optionally an opportunity. onDone runs only when no navigation happens.
export function openConvertModal(lead, onDone) {
  const org = getOrg();
  const user = getUser();
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
      <div class="crm-cols-2">
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
      await publishEvent('crm.lead.converted', { lead_id: lead.id, account_id: accountId, contact_id: contact.id, opportunity_id: oppId, owner_id: lead.owner_id, org_id: org.id });
      toast('Lead converted');
      closeModal();
      if (accountId) navigate(`crm/account?id=${accountId}`);
      else if (oppId) navigate('crm/opportunities');
      else if (onDone) onDone();
    } catch (err) {
      toast('Conversion failed');
      btn.disabled = false;
    }
  });
  openModal('Convert lead', form);
}
