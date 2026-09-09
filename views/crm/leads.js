import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { navigate } from '../../js/router.js';

const STATUSES = ['New', 'Working', 'Qualified', 'Unqualified', 'Converted'];
const STATUS_BADGE = { New: 'info', Working: 'warning', Qualified: 'success', Unqualified: 'neutral', Converted: 'success' };

// CRM › Leads. Unqualified prospects, with Salesforce-style conversion into an
// account + contact + opportunity. CRUD over crm_leads (anon+RLS).
export default async function crmLeads(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const canEdit = ['owner', 'admin', 'manager'].includes(membership?.role || 'member');

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Leads</h1>
        <p class="page-subtitle">Prospects to qualify and convert</p>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        <a href="#/crm" class="btn btn-secondary">← CRM</a>
        ${canEdit ? '<button class="btn btn-primary" id="add-lead-btn">+ New Lead</button>' : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        <input type="text" class="form-input" id="ld-search" placeholder="Search name, company, email..." style="max-width:300px;height:34px;flex:1">
        <select class="form-input" id="ld-status-filter" style="max-width:170px;height:34px">
          <option value="">All statuses</option>${STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <div id="ld-table-wrap"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
    </div>
  `;

  if (!org) { document.getElementById('ld-table-wrap').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  let leads = [];
  let stages = [];
  const ownerMap = {};

  const [{ data: lds, error: ldErr }, { data: users }, { data: stg }] = await Promise.all([
    sb.from('crm_leads').select('*').order('created_at', { ascending: false }),
    sb.from('users').select('id, full_name, email'),
    sb.from('crm_pipeline_stages').select('*').order('sort_order'),
  ]);
  if (ldErr) toast('Failed to load leads: ' + ldErr.message);
  leads = lds || [];
  stages = stg || [];
  (users || []).forEach(u => { ownerMap[u.id] = u; });

  const firstStage = stages.find(s => !s.is_lost) || stages[0] || null;
  const statusFilter = document.getElementById('ld-status-filter');

  function fullName(l) { return [l.first_name, l.last_name].filter(Boolean).join(' ') || '—'; }

  function renderTable() {
    const wrap = document.getElementById('ld-table-wrap');
    const q = (document.getElementById('ld-search')?.value || '').toLowerCase();
    const st = statusFilter.value || '';
    let rows = leads;
    if (q) rows = rows.filter(l => fullName(l).toLowerCase().includes(q) || (l.company || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q));
    if (st) rows = rows.filter(l => (l.status || 'New') === st);

    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg></div>
        <div class="empty-state-title">${q || st ? 'No matching leads' : 'No leads yet'}</div>
        <div class="empty-state-desc">${q || st ? 'Try adjusting your filters.' : canEdit ? 'Add your first lead.' : 'Leads will appear here once added.'}</div>
      </div>`;
      return;
    }

    wrap.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Company</th><th>Status</th><th>Source</th><th>Owner</th></tr></thead>
      <tbody>${rows.map(l => {
        const owner = ownerMap[l.owner_id];
        const status = l.status || 'New';
        return `<tr${canEdit ? ' style="cursor:pointer"' : ''} data-id="${l.id}">
          <td style="font-weight:var(--font-weight-medium)">${esc(fullName(l))}${l.title ? ` <span class="u-sm-muted">· ${esc(l.title)}</span>` : ''}</td>
          <td>${esc(l.company || '—')}</td>
          <td><span class="badge badge-${STATUS_BADGE[status] || 'neutral'}">${esc(status)}</span></td>
          <td>${esc(l.source || '—')}</td>
          <td>${owner ? esc(owner.full_name || owner.email || '—') : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    if (canEdit) wrap.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', () => openLeadForm(leads.find(l => l.id === row.dataset.id)));
    });
  }

  renderTable();
  document.getElementById('ld-search').addEventListener('input', renderTable);
  statusFilter.addEventListener('change', renderTable);
  if (canEdit) document.getElementById('add-lead-btn').addEventListener('click', () => openLeadForm());

  function openLeadForm(existing) {
    const l = existing || {};
    const converted = !!(existing && existing.converted_at);
    const form = document.createElement('form');
    form.className = 'u-stack-4';
    form.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">First name</label><input class="form-input" name="first_name" value="${esc(l.first_name || '')}" ${converted ? 'disabled' : ''}></div>
        <div class="form-group"><label class="form-label">Last name</label><input class="form-input" name="last_name" value="${esc(l.last_name || '')}" ${converted ? 'disabled' : ''}></div>
      </div>
      <div class="form-group"><label class="form-label">Company</label><input class="form-input" name="company" value="${esc(l.company || '')}" ${converted ? 'disabled' : ''}></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Email</label><input class="form-input" type="email" name="email" value="${esc(l.email || '')}" ${converted ? 'disabled' : ''}></div>
        <div class="form-group"><label class="form-label">Phone</label><input class="form-input" name="phone" value="${esc(l.phone || '')}" ${converted ? 'disabled' : ''}></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Status</label>
          <select class="form-input" name="status" ${converted ? 'disabled' : ''}>${STATUSES.map(s => `<option value="${s}" ${(l.status || 'New') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label class="form-label">Source</label><input class="form-input" name="source" value="${esc(l.source || '')}" ${converted ? 'disabled' : ''}></div>
      </div>
      <div id="ld-err" class="hidden" style="color:var(--color-error);font-size:var(--text-sm)"></div>
      <div style="display:flex;justify-content:space-between;gap:var(--space-2);align-items:center">
        <div>${existing && !converted ? '<button type="button" class="btn btn-secondary" id="ld-convert">Convert →</button>' : ''}${converted ? '<span class="badge badge-success">Converted</span>' : ''}</div>
        <div style="display:flex;gap:var(--space-2)">
          <button type="button" class="btn btn-secondary" id="ld-cancel">Cancel</button>
          ${converted ? '' : `<button type="submit" class="btn btn-primary" id="ld-save">${existing ? 'Save changes' : 'Create lead'}</button>`}
        </div>
      </div>
    `;
    openModal(existing ? (converted ? 'Lead (converted)' : 'Edit lead') : 'New lead', form);
    form.querySelector('#ld-cancel').addEventListener('click', closeModal);

    const convertBtn = form.querySelector('#ld-convert');
    if (convertBtn) convertBtn.addEventListener('click', () => convertLead(existing));

    if (!converted) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('#ld-err');
      const btn = form.querySelector('#ld-save');
      errEl.classList.add('hidden');
      const fd = new FormData(form);
      const first = (fd.get('first_name') || '').toString().trim();
      const last = (fd.get('last_name') || '').toString().trim();
      const company = (fd.get('company') || '').toString().trim();
      if (!first && !last && !company) { errEl.textContent = 'Enter a name or company.'; errEl.classList.remove('hidden'); return; }

      const payload = {
        first_name: first || null, last_name: last || null, company: company || null,
        email: (fd.get('email') || '').toString().trim() || null,
        phone: (fd.get('phone') || '').toString().trim() || null,
        status: (fd.get('status') || 'New').toString(),
        source: (fd.get('source') || '').toString().trim() || null,
      };
      btn.disabled = true; btn.textContent = existing ? 'Saving...' : 'Creating...';
      let result;
      if (existing) result = await sb.from('crm_leads').update(payload).eq('id', existing.id).select().single();
      else result = await sb.from('crm_leads').insert({ ...payload, org_id: org.id, owner_id: user.id, created_by: user.id }).select().single();

      if (result.error) { btn.disabled = false; btn.textContent = existing ? 'Save changes' : 'Create lead'; errEl.textContent = result.error.message; errEl.classList.remove('hidden'); return; }
      const saved = result.data;
      if (existing) { const i = leads.findIndex(x => x.id === saved.id); if (i !== -1) leads[i] = saved; logAction('crm', 'lead', saved.id, 'updated', existing, saved); publishEvent('crm.lead.updated', { lead_id: saved.id }); }
      else { leads.unshift(saved); logAction('crm', 'lead', saved.id, 'created', null, saved); publishEvent('crm.lead.created', { lead_id: saved.id }); }
      closeModal();
      toast(existing ? 'Lead updated' : 'Lead created');
      renderTable();
    });
  }

  // Salesforce-style convert: lead → account + contact + opportunity, then mark
  // the lead converted with links back to the created records.
  async function convertLead(lead) {
    const errEl = document.getElementById('ld-err');
    const btn = document.getElementById('ld-convert');
    if (btn) { btn.disabled = true; btn.textContent = 'Converting...'; }

    const fail = (msg) => {
      if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
      if (btn) { btn.disabled = false; btn.textContent = 'Convert →'; }
    };

    const { data: account, error: aErr } = await sb.from('crm_accounts')
      .insert({ org_id: org.id, name: lead.company || `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'New account', phone: lead.phone || null, owner_id: user.id, created_by: user.id })
      .select().single();
    if (aErr) return fail('Account: ' + aErr.message);

    const { data: contact, error: cErr } = await sb.from('crm_contacts')
      .insert({ org_id: org.id, account_id: account.id, first_name: lead.first_name || null, last_name: lead.last_name || null, email: lead.email || null, phone: lead.phone || null, title: lead.title || null, owner_id: user.id, created_by: user.id })
      .select().single();
    if (cErr) return fail('Contact: ' + cErr.message);

    const { data: opp, error: oErr } = await sb.from('crm_opportunities')
      .insert({ org_id: org.id, name: `${account.name} — Opportunity`, account_id: account.id, primary_contact_id: contact.id, stage_id: firstStage?.id || null, status: 'open', source: lead.source || null, owner_id: user.id, created_by: user.id })
      .select().single();
    if (oErr) return fail('Opportunity: ' + oErr.message);

    const { data: saved, error: lErr } = await sb.from('crm_leads')
      .update({ status: 'Converted', converted_at: new Date().toISOString(), converted_account_id: account.id, converted_contact_id: contact.id, converted_opportunity_id: opp.id })
      .eq('id', lead.id).select().single();
    if (lErr) return fail('Lead: ' + lErr.message);

    const i = leads.findIndex(x => x.id === saved.id);
    if (i !== -1) leads[i] = saved;
    logAction('crm', 'lead', saved.id, 'converted', lead, saved);
    publishEvent('crm.lead.converted', { lead_id: saved.id, account_id: account.id, contact_id: contact.id, opportunity_id: opp.id });
    closeModal();
    toast('Lead converted');
    renderTable();
    navigate(`crm/account?id=${account.id}`);
  }
}
