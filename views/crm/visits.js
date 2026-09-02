import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, loadingSkeleton, formatDate } from '../../js/ui.js';
import { navigate, routeParams } from '../../js/router.js';
import { publishEvent } from '../../js/events.js';
import { logAction } from '../../js/audit.js';
import { makeRenditions, formatBytes } from '../../js/image.js';
import { enqueue } from '../../js/outbox.js';

const uuid = () => (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(16).slice(2));
// A Supabase write failed for want of a network (offline / unreachable), not a
// real rejection. Those get queued to the offline outbox.
function isNetworkError(error) {
  if (!navigator.onLine) return true;
  const m = String((error && error.message) || '').toLowerCase();
  return /failed to fetch|network|load failed|timeout|offline/.test(m);
}

// Field values taken straight from the "TL/BDE Visits" dump so app-logged
// visits and the imported dump share one vocabulary.
const VISIT_STATUS = ['Met Owner', 'Met Resource', 'Not able to meet Owner', 'Shop Closed', 'Business Closed'];
const CALL_OUTCOME = ['Customer Interaction', 'TP Lead Followup', 'TSS Lead Followup', 'TP Closure', 'TSS Closure', 'Branding'];
const STATUS_BADGE = { 'Met Owner': 'success', 'Met Resource': 'info', 'Not able to meet Owner': 'warning', 'Shop Closed': 'neutral', 'Business Closed': 'error' };
const BUCKET = 'visit-selfies';

const thumbPath = (full) => full ? full.replace(/\.jpg$/, '_thumb.jpg') : full;

export default async function crmVisits(container) {
  const org = getOrg();
  const user = getUser();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><button class="btn btn-ghost btn-sm" id="back">← CRM</button></div>
    <div class="page-header">
      <h1 class="page-title">Log a visit</h1>
      <p class="page-subtitle">Record a partner field visit with a GPS location and a selfie. Counts toward your coverage the moment you save.</p>
    </div>
    <div class="crm-cols-2" style="align-items:start;gap:var(--space-5)">
      <div class="card">
        <div class="card-header"><span class="card-title">New visit</span></div>
        <div class="card-body" id="visit-form">${loadingSkeleton(5)}</div>
      </div>
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="card-title">My recent visits</span>
          <input type="text" class="form-input" id="visit-search" placeholder="Search partner" style="max-width:180px;height:30px">
        </div>
        <div id="visit-recent">${loadingSkeleton(4)}</div>
      </div>
    </div>
  `;
  container.querySelector('#back').addEventListener('click', () => navigate('crm'));

  // Accounts the user can see (RLS-scoped). id/name plus a few fields to
  // prefill the snapshot columns on the visit.
  let accounts = [];
  {
    const pageSize = 1000; let from = 0;
    for (;;) {
      const { data, error } = await sb.from('crm_accounts')
        .select('id, name, external_id, district_new, region')
        .order('name').range(from, from + pageSize - 1);
      if (error || !data || !data.length) break;
      accounts.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
  }

  // --- Form state ---
  const prefillId = routeParams().account || '';
  let picked = accounts.find(a => a.id === prefillId) || null;
  let coords = null;          // { lat, lng, acc }
  let renditions = null;      // { full: Blob, thumb: Blob }
  let originalSize = 0;

  const formEl = container.querySelector('#visit-form');
  formEl.innerHTML = `
    <div style="display:grid;gap:var(--space-4)">
      <div class="form-group" style="margin:0;position:relative">
        <label class="form-label">Partner *</label>
        <input type="text" class="form-input" id="v-partner" autocomplete="off" placeholder="Type a partner name or Site ID" value="${picked ? esc(picked.name) : ''}">
        <div id="v-partner-menu" style="display:none;position:absolute;z-index:20;left:0;right:0;top:100%;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);max-height:240px;overflow:auto"></div>
        <div id="v-partner-meta" style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:2px">${picked ? partnerMeta(picked) : `${accounts.length.toLocaleString('en-IN')} partners you can log against`}</div>
      </div>

      <div class="crm-cols-2" style="gap:var(--space-3)">
        <div class="form-group" style="margin:0">
          <label class="form-label">Visit status *</label>
          <select class="form-input" id="v-status">${VISIT_STATUS.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Primary call outcome</label>
          <select class="form-input" id="v-outcome"><option value="">— Select —</option>${CALL_OUTCOME.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
        </div>
      </div>

      <div class="form-group" style="margin:0">
        <label class="form-label">Location</label>
        <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
          <button type="button" class="btn btn-secondary btn-sm" id="v-loc-btn">Use my location</button>
          <span id="v-loc-text" style="font-size:var(--text-sm);color:var(--color-text-secondary)">Not captured yet</span>
        </div>
      </div>

      <div class="form-group" style="margin:0">
        <label class="form-label">Selfie at the shop *</label>
        <input type="file" accept="image/*" capture="user" id="v-selfie" style="display:none">
        <div id="v-selfie-drop" style="border:1.5px dashed var(--color-border);border-radius:var(--radius-md);padding:var(--space-4);text-align:center;cursor:pointer">
          <div id="v-selfie-empty" style="color:var(--color-text-secondary);font-size:var(--text-sm)">Tap to take a photo — it's compressed on your phone before upload.</div>
          <div id="v-selfie-preview" style="display:none;align-items:center;gap:var(--space-3);justify-content:center"></div>
        </div>
      </div>

      <div class="form-group" style="margin:0">
        <label class="form-label">Tally serial number</label>
        <select class="form-input" id="v-tally-status">
          <option value="shared">Shared — enter the number</option>
          <option value="not_shared">Not shared by partner</option>
          <option value="no_licence">Licence not purchased</option>
        </select>
        <input type="text" inputmode="numeric" autocomplete="off" class="form-input" id="v-tally-serial" placeholder="e.g. 700012345" style="margin-top:var(--space-2)">
      </div>

      <div class="form-group" style="margin:0">
        <label class="form-label">Remarks</label>
        <textarea class="form-input" id="v-remarks" rows="2" placeholder="What happened on this visit"></textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
        <button type="button" class="btn btn-primary" id="v-save">Save visit</button>
      </div>
    </div>`;

  function partnerMeta(a) {
    return [a.external_id ? 'Site ' + a.external_id : null, a.district_new || a.region || null].filter(Boolean).join(' · ') || 'No Site ID on file';
  }

  // --- Partner typeahead ---
  const partnerInput = formEl.querySelector('#v-partner');
  const menu = formEl.querySelector('#v-partner-menu');
  const meta = formEl.querySelector('#v-partner-meta');

  function renderMenu(q) {
    const term = q.trim().toLowerCase();
    if (!term) { menu.style.display = 'none'; return; }
    const hits = accounts.filter(a =>
      (a.name || '').toLowerCase().includes(term) || String(a.external_id || '').includes(term)
    ).slice(0, 8);
    if (!hits.length) { menu.innerHTML = `<div style="padding:var(--space-3);color:var(--color-text-tertiary);font-size:var(--text-sm)">No match</div>`; menu.style.display = 'block'; return; }
    menu.innerHTML = hits.map(a => `<div class="v-opt" data-id="${a.id}" style="padding:var(--space-2) var(--space-3);cursor:pointer;border-bottom:1px solid var(--color-border-light)">
      <div style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(a.name)}</div>
      <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(partnerMeta(a))}</div>
    </div>`).join('');
    menu.style.display = 'block';
    menu.querySelectorAll('.v-opt').forEach(el => el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      picked = accounts.find(a => a.id === el.dataset.id);
      partnerInput.value = picked.name;
      meta.textContent = partnerMeta(picked);
      menu.style.display = 'none';
    }));
  }
  partnerInput.addEventListener('input', () => { picked = null; renderMenu(partnerInput.value); });
  partnerInput.addEventListener('blur', () => setTimeout(() => { menu.style.display = 'none'; }, 150));

  // --- Geolocation ---
  const locBtn = formEl.querySelector('#v-loc-btn');
  const locText = formEl.querySelector('#v-loc-text');
  function captureLocation() {
    if (!navigator.geolocation) { locText.textContent = 'Location not supported on this device'; return; }
    locText.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coords = { lat: +pos.coords.latitude.toFixed(7), lng: +pos.coords.longitude.toFixed(7), acc: Math.round(pos.coords.accuracy) };
        locText.innerHTML = `${coords.lat}, ${coords.lng} <span style="color:var(--color-text-tertiary)">(±${coords.acc}m)</span>`;
      },
      () => { locText.textContent = 'Could not get location — you can still save'; },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }
  locBtn.addEventListener('click', captureLocation);
  captureLocation(); // try on open

  // --- Selfie capture + compression ---
  const fileInput = formEl.querySelector('#v-selfie');
  const drop = formEl.querySelector('#v-selfie-drop');
  const emptyEl = formEl.querySelector('#v-selfie-empty');
  const previewEl = formEl.querySelector('#v-selfie-preview');
  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    originalSize = file.size;
    emptyEl.style.display = 'none';
    previewEl.style.display = 'flex';
    previewEl.innerHTML = `<span style="font-size:var(--text-sm);color:var(--color-text-secondary)">Compressing…</span>`;
    try {
      renditions = await makeRenditions(file);
      const url = URL.createObjectURL(renditions.thumb);
      previewEl.innerHTML = `
        <img src="${url}" alt="selfie" style="width:64px;height:64px;object-fit:cover;border-radius:var(--radius-md)">
        <div style="text-align:left;font-size:var(--text-xs);color:var(--color-text-secondary)">
          <div>${formatBytes(originalSize)} → <strong>${formatBytes(renditions.full.size)}</strong></div>
          <div style="color:var(--color-accent);cursor:pointer" id="v-selfie-redo">Retake</div>
        </div>`;
      previewEl.querySelector('#v-selfie-redo').addEventListener('click', (ev) => { ev.stopPropagation(); fileInput.value = ''; fileInput.click(); });
    } catch (err) {
      renditions = null;
      previewEl.style.display = 'none';
      emptyEl.style.display = 'block';
      toast('Could not process that photo — try again');
    }
  });

  // --- Tally serial ---
  // Collected at the shop. If the partner won't share it or hasn't bought a
  // licence, the reason is captured instead of a blank. Digits only.
  const tallyStatusEl = formEl.querySelector('#v-tally-status');
  const tallySerialEl = formEl.querySelector('#v-tally-serial');
  function syncTally() {
    const shared = tallyStatusEl.value === 'shared';
    tallySerialEl.style.display = shared ? '' : 'none';
    if (!shared) tallySerialEl.value = '';
  }
  tallyStatusEl.addEventListener('change', syncTally);
  tallySerialEl.addEventListener('input', () => { tallySerialEl.value = tallySerialEl.value.replace(/\D/g, ''); });
  syncTally();

  // --- Save ---
  const saveBtn = formEl.querySelector('#v-save');
  saveBtn.addEventListener('click', async () => {
    if (!picked) return toast('Pick a partner from the list');
    if (!renditions) return toast('Take a selfie at the shop');
    const status = formEl.querySelector('#v-status').value;
    const outcome = formEl.querySelector('#v-outcome').value || null;
    const remarks = formEl.querySelector('#v-remarks').value.trim() || null;
    const tallyStatus = tallyStatusEl.value;
    const tallySerial = tallySerialEl.value.trim();
    if (tallyStatus === 'shared' && !tallySerial) return toast('Enter the Tally serial number, or pick why it is not available');

    saveBtn.disabled = true;
    const label = saveBtn.textContent;
    saveBtn.textContent = 'Saving…';

    // Client-generated id so an offline visit upserts (never duplicates) on
    // replay, and the queued selfie can be keyed to the same row.
    const row = {
      id: uuid(),
      org_id: org.id,
      account_id: picked.id,
      site_id: picked.external_id || null,
      firm_name: picked.name,
      visited_by: user.id,
      visited_by_name: user.user_metadata?.full_name || user.email || null,
      visited_at: new Date().toISOString(),
      visit_status: status,
      call_outcome: outcome,
      remarks,
      tally_serial: tallyStatus === 'shared' ? tallySerial : null,
      tally_serial_status: tallyStatus,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      location_text: coords ? `${coords.lat}, ${coords.lng}` : null,
      source: 'app',
    };
    const rends = renditions; // capture before the form resets

    // Save the visit + selfie to the offline queue and reset optimistically.
    const queueVisit = async () => {
      await enqueue('crm.visit.logged', { row }, rends ? { full: rends.full, thumb: rends.thumb } : null);
      toast('Saved offline — will sync when you\'re back online');
      resetForm();
    };
    // Shared reset used by both the online success path and the offline queue.
    function resetForm() {
      picked = null; renditions = null; originalSize = 0;
      partnerInput.value = ''; meta.textContent = `${accounts.length.toLocaleString('en-IN')} partners you can log against`;
      formEl.querySelector('#v-outcome').value = '';
      formEl.querySelector('#v-remarks').value = '';
      tallyStatusEl.value = 'shared'; syncTally();
      previewEl.style.display = 'none'; emptyEl.style.display = 'block'; fileInput.value = '';
    }

    if (!navigator.onLine) {
      try { await queueVisit(); } finally { saveBtn.disabled = false; saveBtn.textContent = label; }
      return;
    }

    try {
      const { data: visit, error } = await sb.from('crm_visits').insert(row).select('id').single();
      if (error || !visit) {
        if (isNetworkError(error)) { await queueVisit(); return; }
        throw new Error(error?.message || 'Could not save visit');
      }

      const base = `${org.id}/${visit.id}`;
      const fullPath = `${base}.jpg`;
      const up1 = await sb.storage.from(BUCKET).upload(fullPath, renditions.full, { contentType: 'image/jpeg', upsert: true });
      const up2 = await sb.storage.from(BUCKET).upload(thumbPath(fullPath), renditions.thumb, { contentType: 'image/jpeg', upsert: true });
      if (up1.error || up2.error) {
        // Visit saved but photo failed — keep the row, surface the issue.
        toast('Visit saved, but the photo upload failed');
      } else {
        await sb.from('crm_visits').update({ selfie_path: fullPath }).eq('id', visit.id);
      }

      await logAction('crm', 'visit', visit.id, 'logged', null, { account_id: picked.id, status });
      await publishEvent('crm.visit.logged', { visit_id: visit.id, account_id: picked.id, status });

      toast('Visit logged');
      resetForm(); // keep location for the next entry
      loadRecent();
    } catch (err) {
      if (isNetworkError(err)) { await queueVisit(); return; }
      toast(err.message || 'Could not save visit');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = label;
    }
  });

  // --- Recent visits ---
  const recentEl = container.querySelector('#visit-recent');
  const searchEl = container.querySelector('#visit-search');
  let recent = [];

  async function loadRecent() {
    const { data } = await sb.from('crm_visits')
      .select('id, firm_name, site_id, visit_status, call_outcome, remarks, visited_at, lat, lng, selfie_path, visited_by_name')
      .order('visited_at', { ascending: false }).limit(40);
    recent = data || [];

    // Batch-sign thumbnails (list uses the small rendition — "decompress as
    // per use case"); full images are signed on demand when opened.
    const thumbs = recent.filter(v => v.selfie_path).map(v => thumbPath(v.selfie_path));
    let signed = {};
    if (thumbs.length) {
      const { data: urls } = await sb.storage.from(BUCKET).createSignedUrls(thumbs, 3600);
      (urls || []).forEach(u => { if (u.signedUrl) signed[u.path] = u.signedUrl; });
    }
    renderRecent(signed);
  }

  function renderRecent(signed) {
    const term = (searchEl.value || '').toLowerCase().trim();
    const list = term ? recent.filter(v => (v.firm_name || '').toLowerCase().includes(term) || String(v.site_id || '').includes(term)) : recent;
    if (!list.length) {
      recentEl.innerHTML = `<div class="empty-state" style="padding:var(--space-6)"><div class="empty-state-title">No visits yet</div><div class="empty-state-desc">Your logged visits appear here.</div></div>`;
      return;
    }
    recentEl.innerHTML = `<div style="max-height:64vh;overflow:auto">${list.map(v => {
      const turl = v.selfie_path ? signed[thumbPath(v.selfie_path)] : null;
      const badge = STATUS_BADGE[v.visit_status] || 'neutral';
      return `<div style="display:flex;gap:var(--space-3);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border-light)">
        ${turl
          ? `<img src="${turl}" data-full="${esc(v.selfie_path)}" class="v-thumb" style="width:48px;height:48px;object-fit:cover;border-radius:var(--radius-md);cursor:pointer;flex-shrink:0">`
          : `<div style="width:48px;height:48px;border-radius:var(--radius-md);background:var(--color-bg-tertiary);flex-shrink:0"></div>`}
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;gap:var(--space-2)">
            <span style="font-weight:var(--font-weight-medium);font-size:var(--text-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.firm_name || '—')}</span>
            <span class="badge badge-${badge}" style="font-size:10px;flex-shrink:0">${esc(v.visit_status || '')}</span>
          </div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${v.call_outcome ? esc(v.call_outcome) + ' · ' : ''}${formatDate(v.visited_at)}${v.lat ? ` · <a href="https://maps.google.com/?q=${v.lat},${v.lng}" target="_blank" rel="noopener" style="color:var(--color-accent)">map</a>` : ''}</div>
          ${v.remarks ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.remarks)}</div>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;

    recentEl.querySelectorAll('.v-thumb').forEach(img => img.addEventListener('click', async () => {
      const path = img.dataset.full;
      const body = document.createElement('div');
      body.innerHTML = `<div style="text-align:center;color:var(--color-text-secondary)">Loading…</div>`;
      openModal('Visit selfie', body);
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
      body.innerHTML = data?.signedUrl
        ? `<img src="${data.signedUrl}" style="max-width:100%;border-radius:var(--radius-md)">`
        : `<div class="empty-state"><div class="empty-state-desc">Could not load the photo.</div></div>`;
    }));
  }

  searchEl.addEventListener('input', () => renderRecent(collectSignedFromDom()));
  // Re-searching shouldn't re-sign; reuse already-rendered thumb URLs.
  function collectSignedFromDom() {
    const map = {};
    recentEl.querySelectorAll('.v-thumb').forEach(img => { map[thumbPath(img.dataset.full)] = img.src; });
    return map;
  }

  await loadRecent();
}
