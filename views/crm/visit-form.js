import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';
import { routeParams, navigate } from '../../js/router.js';
import { publishEvent } from '../../js/events.js';

// CRM › Log visit. Field-visit capture for BDEs. Two modes: a Registered partner
// (picked from crm_partner_details, links account_id) or an Unregistered prospect
// (a shop not yet onboarded — captured with structured region/owner fields so the
// data stays analysable). Writes crm_visits (RLS: member logs their own) and
// uploads the selfie to the org-scoped visit-selfies bucket. Reachable standalone
// (crm/log-visit) or deep-linked with ?id=<partner> from a partner page.

const VISIT_STATUS = ['Met owner', 'Met resource', 'Not able to meet', 'Shop closed', 'Business closed'];
// Tally serial status is DB-constrained; label the on-site check plainly.
const TALLY_STATUS = [['', '—'], ['shared', 'Serial shared'], ['not_shared', 'Not shared'], ['no_licence', 'No licence']];
const FALLBACK_REGIONS = ['Bengaluru', 'Chennai', 'Rest of Karnataka', 'Rest of Tamilnadu', 'TSAP-TS', 'TSAP-AP'];

export default async function crmVisitForm(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const userName = membership?.full_name || user?.user_metadata?.full_name || user?.email || 'BDE';
  const { id: preId } = routeParams();

  let mode = 'registered';   // 'registered' | 'unregistered'
  let partner = null;        // selected crm_partner_details row (registered)
  let regions = FALLBACK_REGIONS;
  let geo = null;            // { lat, lng }
  let selfieFile = null;

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title" style="margin:0">Log a visit</h1>
        <p class="page-subtitle" style="margin:0">${esc(org?.name || 'Field')} · record a partner visit</p>
      </div>
      <a href="#/crm/field-sales" class="btn btn-secondary" data-back>← Back</a>
    </div>
    <div id="vf-body" style="max-width:640px"><div class="skeleton skeleton-text"></div></div>
  `;
  if (!org) { document.getElementById('vf-body').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  const body = document.getElementById('vf-body');

  // Region list for the unregistered form (fall back to the known set).
  const { data: regRows } = await sb.from('crm_partner_details').select('region').not('region', 'is', null).limit(2000);
  if (regRows && regRows.length) {
    const set = [...new Set(regRows.map(r => (r.region || '').trim()).filter(Boolean))].sort();
    if (set.length) regions = set;
  }

  if (preId) {
    const { data } = await sb.from('crm_partner_details').select('*').eq('id', preId).single();
    if (data) { partner = data; mode = 'registered'; }
  }

  function modeToggle() {
    const btn = (m, label) => `<button type="button" class="btn btn-sm ${mode === m ? 'btn-primary' : 'btn-secondary'}" data-mode="${m}">${label}</button>`;
    return `<div style="display:flex;gap:var(--space-1);margin-bottom:var(--space-2)">
      ${btn('registered', 'Registered partner')}${btn('unregistered', 'New / unregistered')}
    </div>`;
  }

  function partnerBlock() {
    if (mode === 'unregistered') {
      return `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <div class="form-group" style="grid-column:1 / -1"><label class="form-label">Shop / firm name <span style="color:var(--color-error)">*</span></label>
            <input class="form-input" name="u_firm" placeholder="Partner / shop name"></div>
          <div class="form-group"><label class="form-label">Owner name</label>
            <input class="form-input" name="u_owner"></div>
          <div class="form-group"><label class="form-label">Owner mobile</label>
            <input class="form-input" name="u_mobile" inputmode="tel" placeholder="10-digit"></div>
          <div class="form-group"><label class="form-label">Region <span style="color:var(--color-error)">*</span></label>
            <select class="form-input" name="u_region"><option value="">Select region</option>${regions.map(r => `<option>${esc(r)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">City / town</label>
            <input class="form-input" name="u_state"></div>
        </div>`;
    }
    if (partner) {
      return `<div class="card"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3)">
        <div>
          <div style="font-weight:var(--font-weight-semibold)">${esc(partner.partner_name || '—')}</div>
          <div class="u-meta">${esc([partner.site_id && 'Site ' + partner.site_id, partner.region, partner.hub].filter(Boolean).join(' · '))}</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="vf-change">Change</button>
      </div></div>`;
    }
    return `
      <input class="form-input" id="vf-search" placeholder="Search partner by name or Site ID…" autocomplete="off">
      <div id="vf-results" class="u-stack" style="margin-top:var(--space-2)"></div>`;
  }

  function render() {
    body.innerHTML = `
      <form id="vf-form" class="u-stack-4">
        <div class="form-group">
          <label class="form-label">Partner <span style="color:var(--color-error)">*</span></label>
          ${modeToggle()}
          <div id="vf-partner">${partnerBlock()}</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <div class="form-group"><label class="form-label">Visited at</label>
            <input class="form-input" type="datetime-local" name="visited_at" value="${localNow()}"></div>
          <div class="form-group"><label class="form-label">Visit status</label>
            <select class="form-input" name="visit_status">${VISIT_STATUS.map(s => `<option>${s}</option>`).join('')}</select></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <div class="form-group"><label class="form-label">Tally serial</label>
            <input class="form-input" name="tally_serial" value="${esc(partner?.tally_serial_no || '')}" placeholder="7xxxxxxxxx"></div>
          <div class="form-group"><label class="form-label">Tally serial status</label>
            <select class="form-input" name="tally_serial_status">${TALLY_STATUS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div>
        </div>

        <div class="form-group"><label class="form-label">Outcome / next step</label>
          <input class="form-input" name="call_outcome" placeholder="e.g. Renewal due next month"></div>
        <div class="form-group"><label class="form-label">Remarks</label>
          <textarea class="form-input" name="remarks" rows="3" placeholder="What happened on the visit"></textarea></div>

        <div class="form-group">
          <label class="form-label">Location</label>
          <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
            <button type="button" class="btn btn-secondary btn-sm" id="vf-geo">📍 Capture location</button>
            <span id="vf-geo-txt" class="u-meta"></span>
          </div>
          <input class="form-input" name="location_text" placeholder="Address / landmark (optional)" style="margin-top:var(--space-2)">
        </div>

        <div class="form-group">
          <label class="form-label">Selfie (optional)</label>
          <input class="form-input" type="file" id="vf-selfie" accept="image/*" capture="environment">
          <div id="vf-selfie-preview" style="margin-top:var(--space-2)"></div>
        </div>

        <div id="vf-err" class="hidden" style="color:var(--color-error);font-size:var(--text-sm)"></div>
        <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
          <button type="submit" class="btn btn-primary" id="vf-save">Save visit</button>
        </div>
      </form>`;

    wireMode();
    wirePartner();
    wireExtras();
    body.querySelector('#vf-form').addEventListener('submit', submit);
  }

  function wireMode() {
    body.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      if (mode === b.dataset.mode) return;
      mode = b.dataset.mode;
      if (mode === 'unregistered') partner = null;
      render();
    }));
  }

  function wirePartner() {
    if (mode === 'unregistered') return;
    const changeBtn = body.querySelector('#vf-change');
    if (changeBtn) { changeBtn.addEventListener('click', () => { partner = null; render(); }); return; }
    const search = body.querySelector('#vf-search');
    const results = body.querySelector('#vf-results');
    if (!search) return;
    let t;
    search.addEventListener('input', () => {
      clearTimeout(t);
      const q = search.value.trim().replace(/[,()%]/g, ' ').trim();
      if (!q) { results.innerHTML = ''; return; }
      t = setTimeout(async () => {
        const { data } = await sb.from('crm_partner_details')
          .select('id, partner_name, site_id, region, hub, tally_serial_no')
          .or(`partner_name.ilike.%${q}%,site_id.ilike.%${q}%`)
          .order('partner_name').limit(8);
        results.innerHTML = (data || []).map(p => `
          <button type="button" class="btn btn-secondary" data-pid="${esc(p.id)}" style="justify-content:flex-start;text-align:left;width:100%">
            <span><strong>${esc(p.partner_name || '—')}</strong> <span class="u-meta">${esc([p.site_id, p.region].filter(Boolean).join(' · '))}</span></span>
          </button>`).join('') || '<div class="u-sm-muted">No matches</div>';
        results.querySelectorAll('[data-pid]').forEach(b => b.addEventListener('click', async () => {
          const { data: full } = await sb.from('crm_partner_details').select('*').eq('id', b.dataset.pid).single();
          partner = full; render();
        }));
      }, 300);
    });
  }

  function wireExtras() {
    const geoBtn = body.querySelector('#vf-geo');
    const geoTxt = body.querySelector('#vf-geo-txt');
    geoBtn.addEventListener('click', () => {
      if (!navigator.geolocation) { geoTxt.textContent = 'Geolocation unavailable'; return; }
      geoBtn.disabled = true; geoTxt.textContent = 'Locating…';
      navigator.geolocation.getCurrentPosition(
        (pos) => { geo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          geoTxt.textContent = `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`; geoBtn.disabled = false; },
        (err) => { geoTxt.textContent = 'Location denied'; geoBtn.disabled = false; },
        { enableHighAccuracy: true, timeout: 10000 });
    });

    const selfie = body.querySelector('#vf-selfie');
    const preview = body.querySelector('#vf-selfie-preview');
    selfie.addEventListener('change', () => {
      selfieFile = selfie.files && selfie.files[0] ? selfie.files[0] : null;
      if (!selfieFile) { preview.innerHTML = ''; return; }
      const url = URL.createObjectURL(selfieFile);
      preview.innerHTML = `<img src="${url}" alt="selfie" style="max-height:140px;border-radius:var(--radius-md)">`;
    });
  }

  async function submit(e) {
    e.preventDefault();
    const form = e.target;
    const errEl = form.querySelector('#vf-err');
    const btn = form.querySelector('#vf-save');
    errEl.classList.add('hidden');
    const fd = new FormData(form);

    // Resolve the partner side of the payload from the active mode.
    let account_id = null, site_id = null, firm_name = null, region = null, state = null, owner_name = null, owner_mobile = null;
    if (mode === 'registered') {
      if (!partner) { showErr(errEl, 'Pick a partner first.'); return; }
      account_id = partner.id; site_id = partner.site_id || null; firm_name = partner.partner_name || null;
      region = partner.region || null; state = partner.state || null;
    } else {
      firm_name = (fd.get('u_firm') || '').toString().trim();
      region = (fd.get('u_region') || '').toString().trim();
      if (!firm_name) { showErr(errEl, 'Enter the shop / firm name.'); return; }
      if (!region) { showErr(errEl, 'Pick a region.'); return; }
      owner_name = (fd.get('u_owner') || '').toString().trim() || null;
      owner_mobile = (fd.get('u_mobile') || '').toString().trim() || null;
      state = (fd.get('u_state') || '').toString().trim() || null;
    }

    btn.disabled = true; btn.textContent = 'Saving…';

    // Upload selfie first (non-blocking on failure).
    let selfie_path = null;
    if (selfieFile) {
      const ext = (selfieFile.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${org.id}/${user.id}/${Date.now()}.${ext}`;
      const up = await sb.storage.from('visit-selfies').upload(path, selfieFile, { upsert: false, contentType: selfieFile.type });
      if (up.error) { toast('Selfie upload failed: ' + up.error.message); } else { selfie_path = up.data.path; }
    }

    const visitedAtRaw = (fd.get('visited_at') || '').toString();
    const payload = {
      org_id: org.id,
      account_id,
      partner_type: mode,
      site_id,
      firm_name,
      region,
      state,
      owner_name,
      owner_mobile,
      visited_by: user.id,
      visited_by_name: userName,
      visited_at: visitedAtRaw ? new Date(visitedAtRaw).toISOString() : new Date().toISOString(),
      visit_status: (fd.get('visit_status') || '').toString(),
      call_outcome: (fd.get('call_outcome') || '').toString().trim() || null,
      remarks: (fd.get('remarks') || '').toString().trim() || null,
      tally_serial: (fd.get('tally_serial') || '').toString().trim() || null,
      tally_serial_status: (fd.get('tally_serial_status') || '').toString() || null,
      location_text: (fd.get('location_text') || '').toString().trim() || null,
      lat: geo ? geo.lat : null,
      lng: geo ? geo.lng : null,
      selfie_path,
      source: 'app',
    };

    const { data, error } = await sb.from('crm_visits').insert(payload).select().single();
    if (error) {
      btn.disabled = false; btn.textContent = 'Save visit';
      showErr(errEl, error.message); return;
    }
    publishEvent('crm.visit.logged', { account_id, visit_id: data.id, partner_type: mode });
    toast('Visit logged');
    navigate(account_id ? 'crm/partner?id=' + account_id : 'crm/field-sales');
  }

  function showErr(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }

  render();
}

function localNow() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
