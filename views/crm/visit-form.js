import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';
import { routeParams, navigate } from '../../js/router.js';
import { publishEvent } from '../../js/events.js';

// CRM › Log visit. Full field-visit collection form for BDEs: pick the partner,
// record the outcome, verify the Tally serial, capture GPS + a selfie. Writes
// crm_visits (RLS: member logs their own) and uploads the selfie to the
// org-scoped visit-selfies bucket. Reachable standalone (crm/log-visit) or
// deep-linked with ?id=<partner> from a partner page.

const VISIT_STATUS = ['Met owner', 'Met resource', 'Not able to meet', 'Shop closed', 'Business closed'];
// Tally serial status is DB-constrained; label the on-site check plainly.
const TALLY_STATUS = [['', '—'], ['shared', 'Serial shared'], ['not_shared', 'Not shared'], ['no_licence', 'No licence']];

export default async function crmVisitForm(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const userName = membership?.full_name || user?.user_metadata?.full_name || user?.email || 'BDE';
  const { id: preId } = routeParams();

  let partner = null;   // selected crm_partner_details row
  let geo = null;       // { lat, lng }
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

  if (preId) {
    const { data } = await sb.from('crm_partner_details').select('*').eq('id', preId).single();
    if (data) partner = data;
  }

  function partnerPicker() {
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
          <div id="vf-partner">${partnerPicker()}</div>
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

    wirePartner();
    wireExtras();
    body.querySelector('#vf-form').addEventListener('submit', submit);
  }

  function wirePartner() {
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
    if (!partner) { errEl.textContent = 'Pick a partner first.'; errEl.classList.remove('hidden'); return; }
    const fd = new FormData(form);
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
      account_id: partner.id,
      site_id: partner.site_id || null,
      firm_name: partner.partner_name || null,
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
      errEl.textContent = error.message; errEl.classList.remove('hidden');
      return;
    }
    publishEvent('crm.visit.logged', { account_id: partner.id, visit_id: data.id });
    toast('Visit logged');
    navigate('crm/partner?id=' + partner.id);
  }

  render();
}

function localNow() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
