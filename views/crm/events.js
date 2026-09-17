import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, backButton, formatDate } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

// CRM › Events. Digital / physical / partner events, planned then executed, with
// partner attendance captured per event. Digital events can be run for everyone
// or scoped to a region or a district. CRUD over crm_events + crm_event_attendees
// (anon+RLS); any member plans and records attendance.

const TYPES = [['digital', 'Digital'], ['physical', 'Physical'], ['partner', 'Partner']];
const TYPE_LABEL = Object.fromEntries(TYPES);
const TYPE_BADGE = { digital: 'info', physical: 'success', partner: 'warning' };

export default async function crmEvents(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const canEdit = !!membership;
  let tab = 'planned';

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Events</h1>
        <p class="page-subtitle">Digital, physical and partner events with attendance</p>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        ${backButton('crm')}
        ${canEdit ? '<button class="btn btn-primary" id="ev-plan">+ Plan event</button>' : ''}
      </div>
    </div>
    <div style="display:flex;gap:var(--space-1);margin-bottom:var(--space-4)">
      <button class="btn btn-sm btn-primary" id="tab-planned" data-tab="planned">Planned</button>
      <button class="btn btn-sm btn-secondary" id="tab-executed" data-tab="executed">Executed</button>
    </div>
    <div id="ev-body"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
  `;
  if (!org) { document.getElementById('ev-body').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  const body = document.getElementById('ev-body');
  let events = [];
  const countByEvent = {};
  const hostMap = {};
  let regions = [], districts = [];

  async function loadAll() {
    const [{ data: evs, error }, { data: att }, { data: users }, { data: geo }] = await Promise.all([
      sb.from('crm_events').select('*').order('event_date', { ascending: false, nullsFirst: false }),
      sb.from('crm_event_attendees').select('event_id'),
      sb.from('users').select('id, full_name, email'),
      sb.from('crm_partner_details').select('region, district'),
    ]);
    if (error) { body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">Couldn't load events</div><div class="empty-state-desc">${esc(error.message)}</div></div>`; return; }
    events = evs || [];
    Object.keys(countByEvent).forEach(k => delete countByEvent[k]);
    (att || []).forEach(a => { countByEvent[a.event_id] = (countByEvent[a.event_id] || 0) + 1; });
    (users || []).forEach(u => { hostMap[u.id] = u; });
    regions = [...new Set((geo || []).map(g => g.region).filter(Boolean))].sort();
    districts = [...new Set((geo || []).map(g => g.district).filter(Boolean))].sort();
    render();
  }

  function scopeText(e) {
    if (e.event_type !== 'digital') return e.venue || (e.event_type === 'partner' ? 'Partner event' : '');
    if (e.scope_type === 'region') return 'Region · ' + (e.scope_value || '—');
    if (e.scope_type === 'district') return 'District · ' + (e.scope_value || '—');
    return 'All';
  }

  function render() {
    document.getElementById('tab-planned').className = 'btn btn-sm ' + (tab === 'planned' ? 'btn-primary' : 'btn-secondary');
    document.getElementById('tab-executed').className = 'btn btn-sm ' + (tab === 'executed' ? 'btn-primary' : 'btn-secondary');
    const rows = events.filter(e => e.status === tab);
    if (!rows.length) {
      body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">No ${tab} events</div>
        <div class="empty-state-desc">${tab === 'planned' && canEdit ? 'Plan your first event.' : 'Nothing here yet.'}</div>
      </div>`;
      return;
    }
    body.innerHTML = `<div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
      ${rows.map(e => `
        <div class="card" style="cursor:pointer" data-id="${e.id}">
          <div class="card-body u-stack">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-2)">
              <span style="font-weight:var(--font-weight-semibold)">${esc(e.title)}</span>
              <span class="badge badge-${TYPE_BADGE[e.event_type] || 'neutral'}">${esc(TYPE_LABEL[e.event_type] || e.event_type)}</span>
            </div>
            <div class="u-sm-muted">${esc(scopeText(e))}${e.event_date ? ' · ' + esc(formatDate(e.event_date)) : ''}</div>
            <div class="u-meta">${(countByEvent[e.id] || 0)} partner${(countByEvent[e.id] || 0) === 1 ? '' : 's'} ${tab === 'planned' ? 'expected' + (e.expected_partners ? ' (target ' + e.expected_partners + ')' : '') : 'attended'}</div>
          </div>
        </div>`).join('')}
    </div>`;
    body.querySelectorAll('[data-id]').forEach(c => c.addEventListener('click', () => openDetail(events.find(e => e.id === c.dataset.id))));
  }

  document.getElementById('tab-planned').addEventListener('click', () => { tab = 'planned'; render(); });
  document.getElementById('tab-executed').addEventListener('click', () => { tab = 'executed'; render(); });
  if (canEdit) document.getElementById('ev-plan').addEventListener('click', () => openEventForm());

  // ---- Plan / edit event ----
  function openEventForm(existing) {
    const e = existing || {};
    const form = document.createElement('form');
    form.className = 'u-stack-4';
    form.innerHTML = `
      <div class="form-group"><label class="form-label">Title <span style="color:var(--color-error)">*</span></label>
        <input class="form-input" name="title" value="${esc(e.title || '')}" placeholder="e.g. TallyPrime 5.0 webinar"></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Type</label>
          <select class="form-input" name="event_type" id="ef-type">${TYPES.map(([v, l]) => `<option value="${v}" ${(e.event_type || 'digital') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Date</label>
          <input class="form-input" type="date" name="event_date" value="${esc(e.event_date || '')}"></div>
      </div>

      <div id="ef-scope"></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Target partners</label>
          <input class="form-input" type="number" name="expected_partners" value="${e.expected_partners != null ? esc(String(e.expected_partners)) : ''}"></div>
      </div>

      <div class="form-group"><label class="form-label">Description</label>
        <textarea class="form-input" name="description" rows="2">${esc(e.description || '')}</textarea></div>

      <div id="ef-err" class="hidden" style="color:var(--color-error);font-size:var(--text-sm)"></div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
        <button type="button" class="btn btn-secondary" id="ef-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="ef-save">${existing ? 'Save' : 'Plan event'}</button>
      </div>`;
    openModal(existing ? 'Edit event' : 'Plan event', form);
    form.querySelector('#ef-cancel').addEventListener('click', closeModal);

    const typeSel = form.querySelector('#ef-type');
    const scopeHost = form.querySelector('#ef-scope');
    function renderScope() {
      const t = typeSel.value;
      if (t === 'digital') {
        const st = e.scope_type || 'all';
        scopeHost.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            <div class="form-group"><label class="form-label">Scope</label>
              <select class="form-input" name="scope_type" id="ef-scopetype">
                <option value="all" ${st === 'all' ? 'selected' : ''}>All</option>
                <option value="region" ${st === 'region' ? 'selected' : ''}>Region-wise</option>
                <option value="district" ${st === 'district' ? 'selected' : ''}>District-wise</option>
              </select></div>
            <div class="form-group" id="ef-scopeval-wrap"></div>
          </div>`;
        const scopeTypeSel = scopeHost.querySelector('#ef-scopetype');
        const valWrap = scopeHost.querySelector('#ef-scopeval-wrap');
        const renderVal = () => {
          const s = scopeTypeSel.value;
          if (s === 'all') { valWrap.innerHTML = ''; return; }
          const list = s === 'region' ? regions : districts;
          valWrap.innerHTML = `<label class="form-label">${s === 'region' ? 'Region' : 'District'}</label>
            <select class="form-input" name="scope_value"><option value="">—</option>${list.map(v => `<option ${e.scope_value === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
        };
        scopeTypeSel.addEventListener('change', renderVal); renderVal();
      } else if (t === 'physical') {
        scopeHost.innerHTML = `<div class="form-group"><label class="form-label">Venue</label>
          <input class="form-input" name="venue" value="${esc(e.venue || '')}" placeholder="Venue / city"></div>`;
      } else {
        scopeHost.innerHTML = '';
      }
    }
    typeSel.addEventListener('change', renderScope); renderScope();

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const errEl = form.querySelector('#ef-err');
      const btn = form.querySelector('#ef-save');
      errEl.classList.add('hidden');
      const fd = new FormData(form);
      const title = (fd.get('title') || '').toString().trim();
      if (!title) { errEl.textContent = 'Title is required.'; errEl.classList.remove('hidden'); return; }
      const type = (fd.get('event_type') || 'digital').toString();
      const ep = (fd.get('expected_partners') || '').toString().trim();
      const payload = {
        title, event_type: type,
        scope_type: type === 'digital' ? (fd.get('scope_type') || 'all').toString() : null,
        scope_value: type === 'digital' && (fd.get('scope_type') || 'all') !== 'all' ? ((fd.get('scope_value') || '').toString() || null) : null,
        venue: type === 'physical' ? ((fd.get('venue') || '').toString().trim() || null) : null,
        event_date: (fd.get('event_date') || '').toString() || null,
        expected_partners: ep === '' ? null : (Number.isFinite(Number(ep)) ? Number(ep) : null),
        description: (fd.get('description') || '').toString().trim() || null,
      };
      btn.disabled = true; btn.textContent = 'Saving…';
      let result;
      if (existing) result = await sb.from('crm_events').update(payload).eq('id', existing.id).select().single();
      else result = await sb.from('crm_events').insert({ ...payload, org_id: org.id, status: 'planned', host_id: user.id, created_by: user.id }).select().single();
      if (result.error) { btn.disabled = false; btn.textContent = existing ? 'Save' : 'Plan event'; errEl.textContent = result.error.message; errEl.classList.remove('hidden'); return; }
      publishEvent(existing ? 'crm.event.updated' : 'crm.event.created', { event_id: result.data.id });
      closeModal(); toast(existing ? 'Event saved' : 'Event planned');
      await loadAll();
    });
  }

  // ---- Event detail: attendees + mark executed ----
  async function openDetail(e) {
    let attendees = [];
    const { data } = await sb.from('crm_event_attendees').select('*').eq('event_id', e.id).order('created_at', { ascending: true });
    attendees = data || [];

    const wrap = document.createElement('div');
    wrap.className = 'u-stack-4';
    const host = hostMap[e.host_id];

    function paint() {
      wrap.innerHTML = `
        <div class="u-stack" style="padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)">
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center">
            <span class="badge badge-${TYPE_BADGE[e.event_type]}">${esc(TYPE_LABEL[e.event_type])}</span>
            <span class="badge badge-${e.status === 'executed' ? 'success' : 'info'}">${e.status}</span>
            <span class="u-sm-muted">${esc(scopeText(e))}${e.event_date ? ' · ' + esc(formatDate(e.event_date)) : ''}</span>
          </div>
          ${e.description ? `<div class="u-sm-muted">${esc(e.description)}</div>` : ''}
          ${host ? `<div class="u-meta">Organiser: ${esc(host.full_name || host.email)}</div>` : ''}
          ${e.outcome ? `<div class="u-sm-muted"><strong>Outcome:</strong> ${esc(e.outcome)}</div>` : ''}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>Partners attended · ${attendees.length}</strong>
          ${canEdit ? '<button class="btn btn-secondary btn-sm" id="ev-add-att">+ Add partner</button>' : ''}
        </div>
        <div id="ev-att-list">
          ${attendees.length ? `<div style="overflow-x:auto"><table class="table" style="width:100%">
            <thead><tr><th>Partner</th><th>Contact</th><th>Phone</th><th>Remarks</th>${canEdit ? '<th></th>' : ''}</tr></thead>
            <tbody>${attendees.map(a => `<tr>
              <td>${esc(a.partner_name || '—')}</td><td>${esc(a.contact_person || '—')}</td>
              <td>${esc(a.phone || '—')}</td><td class="u-sm-muted">${esc(a.remarks || '—')}</td>
              ${canEdit ? `<td><button class="btn btn-secondary btn-sm" data-del="${a.id}" style="color:var(--color-error)">×</button></td>` : ''}
            </tr>`).join('')}</tbody></table></div>` : '<div class="u-sm-muted">No attendees recorded yet.</div>'}
        </div>

        <div style="display:flex;justify-content:space-between;gap:var(--space-2);flex-wrap:wrap;padding-top:var(--space-2);border-top:1px solid var(--color-border)">
          <div style="display:flex;gap:var(--space-2)">
            ${canEdit ? `<button class="btn btn-secondary" id="ev-edit">Edit event</button>` : ''}
          </div>
          <div style="display:flex;gap:var(--space-2)">
            ${canEdit && e.status === 'planned' ? `<button class="btn btn-primary" id="ev-execute">Mark executed</button>` : ''}
          </div>
        </div>`;

      const addBtn = wrap.querySelector('#ev-add-att');
      if (addBtn) addBtn.addEventListener('click', () => openAttendeeForm(e, (row) => { attendees.push(row); countByEvent[e.id] = (countByEvent[e.id] || 0) + 1; paint(); }));
      wrap.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const { error } = await sb.from('crm_event_attendees').delete().eq('id', b.dataset.del);
        if (error) { toast('Delete failed: ' + error.message); return; }
        attendees = attendees.filter(a => a.id !== b.dataset.del);
        countByEvent[e.id] = Math.max(0, (countByEvent[e.id] || 1) - 1);
        paint();
      }));
      const editBtn = wrap.querySelector('#ev-edit');
      if (editBtn) editBtn.addEventListener('click', () => { closeModal(); openEventForm(e); });
      const execBtn = wrap.querySelector('#ev-execute');
      if (execBtn) execBtn.addEventListener('click', () => markExecuted(e));
    }
    paint();
    openModal(e.title, wrap);
  }

  function openAttendeeForm(e, onAdded) {
    let partnerId = null, partnerName = '';
    const form = document.createElement('form');
    form.className = 'u-stack-4';
    form.innerHTML = `
      <div class="form-group"><label class="form-label">Partner</label>
        <div id="at-partner">
          <input class="form-input" id="at-search" placeholder="Search partner by name or Site ID…" autocomplete="off">
          <div id="at-results" class="u-stack" style="margin-top:var(--space-2)"></div>
        </div>
        <input class="form-input" name="partner_name" id="at-name" placeholder="Or type a name" value="" style="margin-top:var(--space-2)">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Contact person</label><input class="form-input" name="contact_person"></div>
        <div class="form-group"><label class="form-label">Phone</label><input class="form-input" name="phone"></div>
      </div>
      <div class="form-group"><label class="form-label">Remarks</label><input class="form-input" name="remarks"></div>
      <div id="at-err" class="hidden" style="color:var(--color-error);font-size:var(--text-sm)"></div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
        <button type="button" class="btn btn-secondary" id="at-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="at-save">Add</button>
      </div>`;
    openModal('Add partner — ' + e.title, form);
    form.querySelector('#at-cancel').addEventListener('click', () => { closeModal(); openDetail(e); });

    const search = form.querySelector('#at-search');
    const results = form.querySelector('#at-results');
    const nameInput = form.querySelector('#at-name');
    let t;
    search.addEventListener('input', () => {
      clearTimeout(t);
      const q = search.value.trim().replace(/[,()%]/g, ' ').trim();
      if (!q) { results.innerHTML = ''; return; }
      t = setTimeout(async () => {
        const { data } = await sb.from('crm_partner_details').select('id, partner_name, site_id, mobile_number, contact_person_name')
          .or(`partner_name.ilike.%${q}%,site_id.ilike.%${q}%`).order('partner_name').limit(8);
        results.innerHTML = (data || []).map(p => `<button type="button" class="btn btn-secondary" data-pid="${esc(p.id)}" data-pname="${esc(p.partner_name || '')}" data-phone="${esc(p.mobile_number || '')}" data-contact="${esc(p.contact_person_name || '')}" style="justify-content:flex-start;text-align:left;width:100%">${esc(p.partner_name || '—')} <span class="u-meta">${esc(p.site_id || '')}</span></button>`).join('') || '<div class="u-sm-muted">No matches</div>';
        results.querySelectorAll('[data-pid]').forEach(b => b.addEventListener('click', () => {
          partnerId = b.dataset.pid; partnerName = b.dataset.pname;
          nameInput.value = partnerName; results.innerHTML = ''; search.value = partnerName;
          if (!form.querySelector('[name=phone]').value) form.querySelector('[name=phone]').value = b.dataset.phone || '';
          if (!form.querySelector('[name=contact_person]').value) form.querySelector('[name=contact_person]').value = b.dataset.contact || '';
        }));
      }, 300);
    });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const errEl = form.querySelector('#at-err');
      const btn = form.querySelector('#at-save');
      const fd = new FormData(form);
      const pname = (fd.get('partner_name') || '').toString().trim() || partnerName;
      if (!pname) { errEl.textContent = 'Pick or name a partner.'; errEl.classList.remove('hidden'); return; }
      btn.disabled = true; btn.textContent = 'Adding…';
      const { data, error } = await sb.from('crm_event_attendees').insert({
        org_id: org.id, event_id: e.id, partner_id: partnerId, partner_name: pname,
        contact_person: (fd.get('contact_person') || '').toString().trim() || null,
        phone: (fd.get('phone') || '').toString().trim() || null,
        remarks: (fd.get('remarks') || '').toString().trim() || null, created_by: user.id,
      }).select().single();
      if (error) { btn.disabled = false; btn.textContent = 'Add'; errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
      closeModal(); openDetail(e); onAdded && onAdded(data);
    });
  }

  async function markExecuted(e) {
    const form = document.createElement('form');
    form.className = 'u-stack-4';
    form.innerHTML = `
      <div class="form-group"><label class="form-label">Outcome / summary</label>
        <textarea class="form-input" name="outcome" rows="3" placeholder="How it went, leads generated…">${esc(e.outcome || '')}</textarea></div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
        <button type="button" class="btn btn-secondary" id="mx-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Mark executed</button>
      </div>`;
    openModal('Mark executed — ' + e.title, form);
    form.querySelector('#mx-cancel').addEventListener('click', () => { closeModal(); openDetail(e); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const { error } = await sb.from('crm_events').update({ status: 'executed', outcome: (fd.get('outcome') || '').toString().trim() || null, updated_at: new Date().toISOString() }).eq('id', e.id);
      if (error) { toast('Failed: ' + error.message); return; }
      publishEvent('crm.event.executed', { event_id: e.id });
      e.status = 'executed'; e.outcome = (fd.get('outcome') || '').toString().trim() || null;
      closeModal(); toast('Event marked executed'); tab = 'executed'; await loadAll();
    });
  }

  await loadAll();
}
