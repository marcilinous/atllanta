import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, backButton, timeAgo } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { routeParams } from '../../js/router.js';

// CRM › Leads (distribution pipeline). A lead is what a PARTNER reports — a
// prospective end customer. RTcompu sells through the channel and doesn't track
// the end user, so the partner's information is final. Leads run through a simple
// pipeline (Hot / Warm / Cold / Dropped) with a next follow-up date and a running
// remarks log. CRUD over crm_leads (anon+RLS); any member collects/updates.

const PRODUCTS = ['TP', 'TSS', 'TPCA', 'Other'];
// Pipeline stages (DB-constrained status values).
const STAGES = [
  { key: 'hot', label: 'Hot', badge: 'error' },
  { key: 'warm', label: 'Warm', badge: 'warning' },
  { key: 'cold', label: 'Cold', badge: 'info' },
  { key: 'dropped', label: 'Dropped', badge: 'neutral' },
];
const STAGE = Object.fromEntries(STAGES.map(s => [s.key, s]));
const today = () => new Date().toISOString().slice(0, 10);

export default async function crmLeads(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const userName = membership?.full_name || user?.user_metadata?.full_name || user?.email || 'BDE';
  const canAdd = !!membership;

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Leads pipeline</h1>
        <p class="page-subtitle">Prospects your partners report — tracked to follow-up</p>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        ${backButton('crm')}
        ${canAdd ? '<button class="btn btn-primary" id="add-lead-btn">+ Collect lead</button>' : ''}
      </div>
    </div>
    <input type="text" class="form-input" id="ld-search" placeholder="Search customer, partner, product…" style="max-width:340px;margin-bottom:var(--space-3)">
    <div id="ld-body"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
  `;
  if (!org) { document.getElementById('ld-body').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  let leads = [];
  const ownerMap = {};
  const partnerMap = {};

  async function loadPartnerNames(ids) {
    const missing = [...new Set(ids.filter(id => id && !(id in partnerMap)))];
    if (!missing.length) return;
    const { data } = await sb.from('crm_partner_details').select('id, partner_name').in('id', missing);
    (data || []).forEach(p => { partnerMap[p.id] = p.partner_name; });
  }

  const [{ data: lds, error: ldErr }, { data: users }] = await Promise.all([
    sb.from('crm_leads').select('*').order('follow_up_date', { ascending: true, nullsFirst: false }),
    sb.from('users').select('id, full_name, email'),
  ]);
  if (ldErr) toast('Failed to load leads: ' + ldErr.message);
  leads = lds || [];
  (users || []).forEach(u => { ownerMap[u.id] = u; });
  await loadPartnerNames(leads.map(l => l.reported_by_partner_id));

  const custName = (l) => l.company || [l.first_name, l.last_name].filter(Boolean).join(' ') || '—';

  function render() {
    const body = document.getElementById('ld-body');
    const q = (document.getElementById('ld-search')?.value || '').toLowerCase();
    let rows = leads;
    if (q) rows = rows.filter(l =>
      custName(l).toLowerCase().includes(q) ||
      (partnerMap[l.reported_by_partner_id] || '').toLowerCase().includes(q) ||
      (l.product_interest || '').toLowerCase().includes(q));

    if (!rows.length) {
      body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">${q ? 'No matching leads' : 'No leads yet'}</div>
        <div class="empty-state-desc">${q ? 'Try another search.' : canAdd ? 'Collect the first lead a partner reports.' : 'Leads will appear here once collected.'}</div>
      </div>`;
      return;
    }

    const t = today();
    const groups = STAGES.map(s => ({ ...s, rows: rows.filter(l => (l.status || 'warm') === s.key) }));
    body.innerHTML = groups.map(g => g.rows.length ? `
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-header" style="display:flex;align-items:center;gap:var(--space-2)">
          <span class="badge badge-${g.badge}">${esc(g.label)}</span>
          <span class="u-sm-muted">${g.rows.length}</span>
        </div>
        <div style="overflow-x:auto"><table class="table" style="width:100%">
          <thead><tr><th>End customer</th><th>Reported by</th><th>Product</th><th>Follow-up</th><th>Last remark</th></tr></thead>
          <tbody>${g.rows.map(l => {
            const overdue = g.key !== 'dropped' && l.follow_up_date && l.follow_up_date < t;
            const last = Array.isArray(l.updates) && l.updates.length ? l.updates[l.updates.length - 1] : null;
            return `<tr style="cursor:pointer" data-id="${l.id}">
              <td style="font-weight:var(--font-weight-medium)">${esc(custName(l))}</td>
              <td class="u-sm-muted">${esc(partnerMap[l.reported_by_partner_id] || '—')}</td>
              <td>${esc(l.product_interest || '—')}</td>
              <td>${l.follow_up_date ? `<span class="badge badge-${overdue ? 'error' : 'neutral'}">${esc(l.follow_up_date)}${overdue ? ' · overdue' : ''}</span>` : (g.key === 'dropped' ? `<span class="u-sm-muted">${esc(l.drop_reason || '—')}</span>` : '<span class="u-sm-muted">—</span>')}</td>
              <td class="u-sm-muted">${last ? esc((last.remarks || '').slice(0, 60)) : esc((l.description || '').slice(0, 60) || '—')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>` : '').join('');

    body.querySelectorAll('tr[data-id]').forEach(row =>
      row.addEventListener('click', () => openLeadForm(leads.find(l => l.id === row.dataset.id))));
  }

  render();
  document.getElementById('ld-search').addEventListener('input', render);
  if (canAdd) document.getElementById('add-lead-btn').addEventListener('click', () => openLeadForm());

  const presetPartnerId = routeParams().partner;
  if (canAdd && presetPartnerId) {
    await loadPartnerNames([presetPartnerId]);
    openLeadForm(null, { id: presetPartnerId, partner_name: partnerMap[presetPartnerId] || '' });
  }

  function openLeadForm(existing, preset) {
    const l = existing || {};
    let partnerId = l.reported_by_partner_id || preset?.id || null;
    let partnerName = partnerMap[partnerId] || preset?.partner_name || '';
    const history = Array.isArray(l.updates) ? l.updates : [];

    const opt = (list, val) => list.map(([v, lab]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${lab}</option>`).join('');
    const form = document.createElement('form');
    form.className = 'u-stack-4';
    form.innerHTML = `
      <div class="form-group">
        <label class="form-label">Reported by partner <span style="color:var(--color-error)">*</span></label>
        <div id="lf-partner"></div>
      </div>

      <div class="form-group"><label class="form-label">End customer / company <span style="color:var(--color-error)">*</span></label>
        <input class="form-input" name="company" value="${esc(l.company || '')}" placeholder="Prospect's business name"></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Contact person</label><input class="form-input" name="first_name" value="${esc(l.first_name || '')}" placeholder="Name"></div>
        <div class="form-group"><label class="form-label">Phone</label><input class="form-input" name="phone" value="${esc(l.phone || '')}"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Product interest</label>
          <select class="form-input" name="product_interest"><option value="">—</option>${PRODUCTS.map(p => `<option ${l.product_interest === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Stage</label>
          <select class="form-input" name="status" id="lf-status">${opt(STAGES.map(s => [s.key, s.label]), l.status || 'warm')}</select></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group" id="lf-followup-wrap"><label class="form-label">Next follow-up</label>
          <input class="form-input" type="date" name="follow_up_date" value="${esc(l.follow_up_date || '')}"></div>
        <div class="form-group hidden" id="lf-dropreason-wrap"><label class="form-label">Reason for dropping</label>
          <input class="form-input" name="drop_reason" value="${esc(l.drop_reason || '')}" placeholder="Why dropped"></div>
      </div>

      <div class="form-group"><label class="form-label">${history.length ? 'Add remark' : 'Remarks'}</label>
        <textarea class="form-input" name="remark" rows="2" placeholder="What the partner said this time"></textarea></div>

      ${history.length ? `<div class="form-group"><label class="form-label">Follow-up history</label>
        <div class="u-stack" style="max-height:180px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-2)">
          ${history.slice().reverse().map(u => `
            <div style="padding:var(--space-1) 0;border-bottom:1px solid var(--color-border)">
              <div>${STAGE[u.status] ? `<span class="badge badge-${STAGE[u.status].badge}">${esc(STAGE[u.status].label)}</span> ` : ''}${esc(u.remarks || '')}</div>
              <div class="u-meta">${esc(u.by_name || '')}${u.at ? ' · ' + esc(timeAgo(u.at)) : ''}${u.follow_up_date ? ' · next ' + esc(u.follow_up_date) : ''}</div>
            </div>`).join('')}
        </div></div>` : ''}

      <div id="ld-err" class="hidden" style="color:var(--color-error);font-size:var(--text-sm)"></div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
        <button type="button" class="btn btn-secondary" id="ld-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="ld-save">${existing ? 'Save update' : 'Collect lead'}</button>
      </div>
    `;
    openModal(existing ? 'Lead — ' + custName(l) : 'Collect lead', form);
    form.querySelector('#ld-cancel').addEventListener('click', closeModal);

    // Stage → toggle follow-up vs drop-reason.
    const statusSel = form.querySelector('#lf-status');
    const toggleStage = () => {
      const dropped = statusSel.value === 'dropped';
      form.querySelector('#lf-dropreason-wrap').classList.toggle('hidden', !dropped);
      form.querySelector('#lf-followup-wrap').classList.toggle('hidden', dropped);
    };
    statusSel.addEventListener('change', toggleStage); toggleStage();

    // Partner picker.
    function renderPartner() {
      const host = form.querySelector('#lf-partner');
      host.innerHTML = partnerId
        ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3)">
             <span style="font-weight:var(--font-weight-medium)">${esc(partnerName || 'Partner')}</span>
             <button type="button" class="btn btn-secondary btn-sm" id="lf-partner-change">Change</button></div>`
        : `<input class="form-input" id="lf-partner-search" placeholder="Search partner by name or Site ID…" autocomplete="off">
           <div id="lf-partner-results" class="u-stack" style="margin-top:var(--space-2)"></div>`;
      const changeBtn = host.querySelector('#lf-partner-change');
      if (changeBtn) { changeBtn.addEventListener('click', () => { partnerId = null; partnerName = ''; renderPartner(); }); return; }
      const search = host.querySelector('#lf-partner-search');
      const results = host.querySelector('#lf-partner-results');
      let t;
      search.addEventListener('input', () => {
        clearTimeout(t);
        const qq = search.value.trim().replace(/[,()%]/g, ' ').trim();
        if (!qq) { results.innerHTML = ''; return; }
        t = setTimeout(async () => {
          const { data } = await sb.from('crm_partner_details').select('id, partner_name, site_id, region')
            .or(`partner_name.ilike.%${qq}%,site_id.ilike.%${qq}%`).order('partner_name').limit(8);
          results.innerHTML = (data || []).map(p => `
            <button type="button" class="btn btn-secondary" data-pid="${esc(p.id)}" data-pname="${esc(p.partner_name || '')}" style="justify-content:flex-start;text-align:left;width:100%">
              <span><strong>${esc(p.partner_name || '—')}</strong> <span class="u-meta">${esc([p.site_id, p.region].filter(Boolean).join(' · '))}</span></span>
            </button>`).join('') || '<div class="u-sm-muted">No matches</div>';
          results.querySelectorAll('[data-pid]').forEach(b => b.addEventListener('click', () => {
            partnerId = b.dataset.pid; partnerName = b.dataset.pname; partnerMap[partnerId] = partnerName; renderPartner();
          }));
        }, 300);
      });
    }
    renderPartner();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('#ld-err');
      const btn = form.querySelector('#ld-save');
      errEl.classList.add('hidden');
      const fd = new FormData(form);
      const company = (fd.get('company') || '').toString().trim();
      const status = (fd.get('status') || 'warm').toString();
      const remark = (fd.get('remark') || '').toString().trim();
      const followUp = (fd.get('follow_up_date') || '').toString() || null;
      const dropReason = (fd.get('drop_reason') || '').toString().trim() || null;
      if (!partnerId) { errEl.textContent = 'Pick the partner who reported this lead.'; errEl.classList.remove('hidden'); return; }
      if (!company) { errEl.textContent = 'End customer / company is required.'; errEl.classList.remove('hidden'); return; }
      if (status === 'dropped' && !dropReason) { errEl.textContent = 'Add a reason for dropping.'; errEl.classList.remove('hidden'); return; }

      const nextUpdates = history.slice();
      if (remark || (existing && existing.status !== status)) {
        nextUpdates.push({ at: new Date().toISOString(), by: user.id, by_name: userName, status, follow_up_date: status === 'dropped' ? null : followUp, remarks: remark || (status === 'dropped' ? 'Dropped: ' + dropReason : 'Stage → ' + (STAGE[status]?.label || status)) });
      }

      const payload = {
        reported_by_partner_id: partnerId,
        company,
        first_name: (fd.get('first_name') || '').toString().trim() || null,
        phone: (fd.get('phone') || '').toString().trim() || null,
        product_interest: (fd.get('product_interest') || '').toString() || null,
        status,
        follow_up_date: status === 'dropped' ? null : followUp,
        drop_reason: status === 'dropped' ? dropReason : null,
        description: remark || l.description || null,
        updates: nextUpdates,
      };
      btn.disabled = true; btn.textContent = 'Saving…';
      let result;
      if (existing) result = await sb.from('crm_leads').update(payload).eq('id', existing.id).select().single();
      else result = await sb.from('crm_leads').insert({ ...payload, org_id: org.id, owner_id: user.id, created_by: user.id }).select().single();

      if (result.error) { btn.disabled = false; btn.textContent = existing ? 'Save update' : 'Collect lead'; errEl.textContent = result.error.message; errEl.classList.remove('hidden'); return; }
      const saved = result.data;
      if (existing) { const i = leads.findIndex(x => x.id === saved.id); if (i !== -1) leads[i] = saved; logAction('crm', 'lead', saved.id, 'updated', existing, saved); publishEvent('crm.lead.updated', { lead_id: saved.id }); }
      else { leads.unshift(saved); logAction('crm', 'lead', saved.id, 'created', null, saved); publishEvent('crm.lead.created', { lead_id: saved.id, partner_id: partnerId }); }
      closeModal();
      toast(existing ? 'Lead updated' : 'Lead collected');
      render();
    });
  }
}
