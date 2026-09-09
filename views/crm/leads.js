import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, backButton } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { routeParams } from '../../js/router.js';

// CRM › Leads (distribution). A lead is what a PARTNER reports to RTcompu — a
// prospective end customer the partner is working. RTcompu sells through the
// channel and does not track the end user, so the partner's information is final
// (recorded as-is, not verified). Each lead links to the reporting partner; there
// is no end-user account conversion. CRUD over crm_leads (anon+RLS).

// DB-constrained status values, labelled for the channel. Rating: hot/warm/cold.
const STATUS = [
  ['new', 'New'], ['working', 'Working'], ['qualified', 'Qualified'],
  ['unqualified', 'Dropped'], ['converted', 'Won'],
];
const STATUS_LABEL = Object.fromEntries(STATUS);
const STATUS_BADGE = { new: 'info', working: 'warning', qualified: 'success', unqualified: 'neutral', converted: 'success' };
const RATING = [['', '—'], ['hot', 'Hot'], ['warm', 'Warm'], ['cold', 'Cold']];

function inr(n) {
  n = Number(n) || 0;
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + 'Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + 'L';
  if (n >= 1e3) return '₹' + Math.round(n / 1e3) + 'K';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export default async function crmLeads(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const canAdd = !!membership; // any org member (BDEs collect leads); RLS enforces

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Leads</h1>
        <p class="page-subtitle">Prospects your partners report — recorded as the partner tells you</p>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        ${backButton('crm')}
        ${canAdd ? '<button class="btn btn-primary" id="add-lead-btn">+ Collect lead</button>' : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        <input type="text" class="form-input" id="ld-search" placeholder="Search customer, partner, product…" style="max-width:320px;height:34px;flex:1">
        <select class="form-input" id="ld-status-filter" style="max-width:170px;height:34px">
          <option value="">All statuses</option>${STATUS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </div>
      <div id="ld-table-wrap"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
    </div>
  `;

  if (!org) { document.getElementById('ld-table-wrap').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  let leads = [];
  const ownerMap = {};
  const partnerMap = {}; // reporting partner id -> name

  async function loadPartnerNames(ids) {
    const missing = [...new Set(ids.filter(id => id && !(id in partnerMap)))];
    if (!missing.length) return;
    const { data } = await sb.from('crm_partner_details').select('id, partner_name').in('id', missing);
    (data || []).forEach(p => { partnerMap[p.id] = p.partner_name; });
  }

  const [{ data: lds, error: ldErr }, { data: users }] = await Promise.all([
    sb.from('crm_leads').select('*').order('created_at', { ascending: false }),
    sb.from('users').select('id, full_name, email'),
  ]);
  if (ldErr) toast('Failed to load leads: ' + ldErr.message);
  leads = lds || [];
  (users || []).forEach(u => { ownerMap[u.id] = u; });
  await loadPartnerNames(leads.map(l => l.reported_by_partner_id));

  const statusFilter = document.getElementById('ld-status-filter');
  const custName = (l) => l.company || [l.first_name, l.last_name].filter(Boolean).join(' ') || '—';

  function renderTable() {
    const wrap = document.getElementById('ld-table-wrap');
    const q = (document.getElementById('ld-search')?.value || '').toLowerCase();
    const st = statusFilter.value || '';
    let rows = leads;
    if (q) rows = rows.filter(l =>
      custName(l).toLowerCase().includes(q) ||
      (partnerMap[l.reported_by_partner_id] || '').toLowerCase().includes(q) ||
      (l.product_interest || '').toLowerCase().includes(q));
    if (st) rows = rows.filter(l => (l.status || 'new') === st);

    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg></div>
        <div class="empty-state-title">${q || st ? 'No matching leads' : 'No leads yet'}</div>
        <div class="empty-state-desc">${q || st ? 'Try adjusting your filters.' : canAdd ? 'Collect the first lead a partner reports.' : 'Leads will appear here once collected.'}</div>
      </div>`;
      return;
    }

    wrap.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>End customer</th><th>Reported by</th><th>Product</th><th>Status</th><th>Value</th><th>Owner</th></tr></thead>
      <tbody>${rows.map(l => {
        const owner = ownerMap[l.owner_id];
        const status = l.status || 'new';
        return `<tr style="cursor:pointer" data-id="${l.id}">
          <td style="font-weight:var(--font-weight-medium)">${esc(custName(l))}${l.rating ? ` <span class="badge badge-${l.rating === 'hot' ? 'error' : l.rating === 'warm' ? 'warning' : 'neutral'}">${esc(l.rating)}</span>` : ''}</td>
          <td>${esc(partnerMap[l.reported_by_partner_id] || '—')}</td>
          <td>${esc(l.product_interest || '—')}</td>
          <td><span class="badge badge-${STATUS_BADGE[status] || 'neutral'}">${esc(STATUS_LABEL[status] || status)}</span></td>
          <td>${l.expected_value != null ? inr(l.expected_value) : '—'}</td>
          <td>${owner ? esc(owner.full_name || owner.email || '—') : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    wrap.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', () => openLeadForm(leads.find(l => l.id === row.dataset.id)));
    });
  }

  renderTable();
  document.getElementById('ld-search').addEventListener('input', renderTable);
  statusFilter.addEventListener('change', renderTable);
  if (canAdd) document.getElementById('add-lead-btn').addEventListener('click', () => openLeadForm());

  // Deep link from a partner page (?partner=<id>) → open the collect form with
  // that partner preset as the reporter (e.g. a BDE logging a lead on a visit).
  const presetPartnerId = routeParams().partner;
  if (canAdd && presetPartnerId) {
    await loadPartnerNames([presetPartnerId]);
    openLeadForm(null, { id: presetPartnerId, partner_name: partnerMap[presetPartnerId] || '' });
  }

  function openLeadForm(existing, preset) {
    const l = existing || {};
    let partnerId = l.reported_by_partner_id || preset?.id || null;
    let partnerName = partnerMap[partnerId] || preset?.partner_name || '';

    const form = document.createElement('form');
    form.className = 'u-stack-4';
    form.innerHTML = `
      <div style="background:var(--color-accent-light);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);font-size:var(--text-sm);color:var(--color-text-secondary)">
        Recorded as the partner reports it — RTcompu sells through the channel and doesn't verify the end customer.
      </div>

      <div class="form-group">
        <label class="form-label">Reported by partner <span style="color:var(--color-error)">*</span></label>
        <div id="lf-partner">
          ${partnerId
            ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3)">
                 <span style="font-weight:var(--font-weight-medium)">${esc(partnerName || 'Partner')}</span>
                 <button type="button" class="btn btn-secondary btn-sm" id="lf-partner-change">Change</button></div>`
            : `<input class="form-input" id="lf-partner-search" placeholder="Search partner by name or Site ID…" autocomplete="off">
               <div id="lf-partner-results" class="u-stack" style="margin-top:var(--space-2)"></div>`}
        </div>
      </div>

      <div class="form-group"><label class="form-label">End customer / company <span style="color:var(--color-error)">*</span></label>
        <input class="form-input" name="company" value="${esc(l.company || '')}" placeholder="Prospect's business name"></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Contact person</label><input class="form-input" name="first_name" value="${esc(l.first_name || '')}" placeholder="Name (as told)"></div>
        <div class="form-group"><label class="form-label">Phone</label><input class="form-input" name="phone" value="${esc(l.phone || '')}"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Product interest</label><input class="form-input" name="product_interest" value="${esc(l.product_interest || '')}" placeholder="e.g. Tally Prime, TSS renewal"></div>
        <div class="form-group"><label class="form-label">Expected value (₹)</label><input class="form-input" type="number" step="any" name="expected_value" value="${l.expected_value != null ? esc(String(l.expected_value)) : ''}"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Status</label>
          <select class="form-input" name="status">${STATUS.map(([v, lab]) => `<option value="${v}" ${(l.status || 'new') === v ? 'selected' : ''}>${lab}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Rating</label>
          <select class="form-input" name="rating">${RATING.map(([v, lab]) => `<option value="${v}" ${(l.rating || '') === v ? 'selected' : ''}>${lab}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">How sourced</label><input class="form-input" name="source" value="${esc(l.source || '')}" placeholder="Walk-in, reference…"></div>
      </div>

      <div class="form-group"><label class="form-label">Notes (partner's words)</label>
        <textarea class="form-input" name="description" rows="3">${esc(l.description || '')}</textarea></div>

      <div id="ld-err" class="hidden" style="color:var(--color-error);font-size:var(--text-sm)"></div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
        <button type="button" class="btn btn-secondary" id="ld-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="ld-save">${existing ? 'Save changes' : 'Collect lead'}</button>
      </div>
    `;
    openModal(existing ? 'Lead' : 'Collect lead', form);
    form.querySelector('#ld-cancel').addEventListener('click', closeModal);

    function wirePartner() {
      const changeBtn = form.querySelector('#lf-partner-change');
      if (changeBtn) { changeBtn.addEventListener('click', () => { partnerId = null; partnerName = ''; rerenderPartner(); }); return; }
      const search = form.querySelector('#lf-partner-search');
      const results = form.querySelector('#lf-partner-results');
      if (!search) return;
      let t;
      search.addEventListener('input', () => {
        clearTimeout(t);
        const q = search.value.trim().replace(/[,()%]/g, ' ').trim();
        if (!q) { results.innerHTML = ''; return; }
        t = setTimeout(async () => {
          const { data } = await sb.from('crm_partner_details')
            .select('id, partner_name, site_id, region')
            .or(`partner_name.ilike.%${q}%,site_id.ilike.%${q}%`)
            .order('partner_name').limit(8);
          results.innerHTML = (data || []).map(p => `
            <button type="button" class="btn btn-secondary" data-pid="${esc(p.id)}" data-pname="${esc(p.partner_name || '')}" style="justify-content:flex-start;text-align:left;width:100%">
              <span><strong>${esc(p.partner_name || '—')}</strong> <span class="u-meta">${esc([p.site_id, p.region].filter(Boolean).join(' · '))}</span></span>
            </button>`).join('') || '<div class="u-sm-muted">No matches</div>';
          results.querySelectorAll('[data-pid]').forEach(b => b.addEventListener('click', () => {
            partnerId = b.dataset.pid; partnerName = b.dataset.pname;
            partnerMap[partnerId] = partnerName; rerenderPartner();
          }));
        }, 300);
      });
    }
    function rerenderPartner() {
      const host = form.querySelector('#lf-partner');
      host.innerHTML = partnerId
        ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3)">
             <span style="font-weight:var(--font-weight-medium)">${esc(partnerName || 'Partner')}</span>
             <button type="button" class="btn btn-secondary btn-sm" id="lf-partner-change">Change</button></div>`
        : `<input class="form-input" id="lf-partner-search" placeholder="Search partner by name or Site ID…" autocomplete="off">
           <div id="lf-partner-results" class="u-stack" style="margin-top:var(--space-2)"></div>`;
      wirePartner();
    }
    wirePartner();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('#ld-err');
      const btn = form.querySelector('#ld-save');
      errEl.classList.add('hidden');
      const fd = new FormData(form);
      const company = (fd.get('company') || '').toString().trim();
      if (!partnerId) { errEl.textContent = 'Pick the partner who reported this lead.'; errEl.classList.remove('hidden'); return; }
      if (!company) { errEl.textContent = 'End customer / company is required.'; errEl.classList.remove('hidden'); return; }
      const ev = (fd.get('expected_value') || '').toString().trim();

      const payload = {
        reported_by_partner_id: partnerId,
        company,
        first_name: (fd.get('first_name') || '').toString().trim() || null,
        phone: (fd.get('phone') || '').toString().trim() || null,
        product_interest: (fd.get('product_interest') || '').toString().trim() || null,
        expected_value: ev === '' ? null : (Number.isFinite(Number(ev)) ? Number(ev) : null),
        status: (fd.get('status') || 'new').toString(),
        rating: (fd.get('rating') || '').toString() || null,
        source: (fd.get('source') || '').toString().trim() || null,
        description: (fd.get('description') || '').toString().trim() || null,
      };
      btn.disabled = true; btn.textContent = existing ? 'Saving…' : 'Saving…';
      let result;
      if (existing) result = await sb.from('crm_leads').update(payload).eq('id', existing.id).select().single();
      else result = await sb.from('crm_leads').insert({ ...payload, org_id: org.id, owner_id: user.id, created_by: user.id }).select().single();

      if (result.error) { btn.disabled = false; btn.textContent = existing ? 'Save changes' : 'Collect lead'; errEl.textContent = result.error.message; errEl.classList.remove('hidden'); return; }
      const saved = result.data;
      if (existing) { const i = leads.findIndex(x => x.id === saved.id); if (i !== -1) leads[i] = saved; logAction('crm', 'lead', saved.id, 'updated', existing, saved); publishEvent('crm.lead.updated', { lead_id: saved.id }); }
      else { leads.unshift(saved); logAction('crm', 'lead', saved.id, 'created', null, saved); publishEvent('crm.lead.created', { lead_id: saved.id, partner_id: partnerId }); }
      closeModal();
      toast(existing ? 'Lead updated' : 'Lead collected');
      renderTable();
    });
  }
}
