import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, closeModal } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';

// Admin screen: the places employees may check in / out from. With at least
// one active location, attendance is geofenced to those places; with none,
// attendance is open anywhere.
export default async function attendanceLocations(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }
  if (!isAdmin) {
    container.innerHTML = `<div style="margin-bottom:var(--space-4)"><a href="#/attendance" class="btn btn-ghost btn-sm">← Attendance</a></div>
      <div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">Admins only</div>
      <div class="empty-state-desc">Only owners and admins can manage work locations.</div></div>`;
    return;
  }

  let locations = [];
  let draft = null; // { lat, lng, acc } captured for the add form

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><a href="#/attendance" class="btn btn-ghost btn-sm">← Attendance</a></div>
    <div class="page-header">
      <h1 class="page-title">Work locations</h1>
      <p class="page-subtitle">Places staff can mark attendance from. Add one or more and check-in/out is locked to within their radius. Add none and attendance stays open anywhere.</p>
    </div>
    <div class="crm-cols-2" style="align-items:start;gap:var(--space-5)">
      <div class="card">
        <div class="card-header"><span class="card-title">Add a location</span></div>
        <div class="card-body">
          <div style="display:grid;gap:var(--space-4)">
            <div class="form-group" style="margin:0">
              <label class="form-label">Name *</label>
              <input class="form-input" id="wl-name" placeholder="e.g. Head Office, Vizag Branch">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Coordinates *</label>
              <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
                <button type="button" class="btn btn-secondary btn-sm" id="wl-here">Use my current location</button>
                <span id="wl-coords" style="font-size:var(--text-sm);color:var(--color-text-secondary)">Not set</span>
              </div>
              <div class="crm-cols-2" style="gap:var(--space-2);margin-top:var(--space-2)">
                <input class="form-input" id="wl-lat" placeholder="Latitude" inputmode="decimal">
                <input class="form-input" id="wl-lng" placeholder="Longitude" inputmode="decimal">
              </div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:2px">Stand at the workplace and tap "Use my current location", or paste coordinates from Google Maps.</div>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Allowed radius (metres)</label>
              <input class="form-input" id="wl-radius" type="number" value="150" min="20" max="5000" style="max-width:140px">
            </div>
            <div style="display:flex;justify-content:flex-end">
              <button class="btn btn-primary" id="wl-save">Add location</button>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Allotted locations</span></div>
        <div id="wl-list"></div>
      </div>
    </div>
  `;

  const nameEl = container.querySelector('#wl-name');
  const latEl = container.querySelector('#wl-lat');
  const lngEl = container.querySelector('#wl-lng');
  const radiusEl = container.querySelector('#wl-radius');
  const coordsEl = container.querySelector('#wl-coords');

  container.querySelector('#wl-here').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location not supported on this device');
    coordsEl.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = +pos.coords.latitude.toFixed(7), lng = +pos.coords.longitude.toFixed(7);
        latEl.value = lat; lngEl.value = lng;
        coordsEl.innerHTML = `${lat}, ${lng} <span style="color:var(--color-text-tertiary)">(±${Math.round(pos.coords.accuracy)}m)</span>`;
      },
      () => { coordsEl.textContent = 'Could not get location — enter it manually'; },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

  container.querySelector('#wl-save').addEventListener('click', async () => {
    const name = nameEl.value.trim();
    const lat = parseFloat(latEl.value), lng = parseFloat(lngEl.value);
    const radius = Math.max(20, Math.min(5000, parseInt(radiusEl.value, 10) || 150));
    if (!name) return toast('Give the location a name');
    if (!isFinite(lat) || !isFinite(lng)) return toast('Set the coordinates');

    const btn = container.querySelector('#wl-save');
    btn.disabled = true; btn.textContent = 'Adding…';
    const { data, error } = await sb.from('work_locations').insert({
      org_id: org.id, name, lat, lng, radius_m: radius, is_active: true, created_by: user.id,
    }).select('id').single();
    btn.disabled = false; btn.textContent = 'Add location';
    if (error) return toast('Could not add: ' + error.message);
    await logAction('attendance', 'work_location', data.id, 'created', null, { name, lat, lng, radius_m: radius });
    toast('Location added');
    nameEl.value = ''; latEl.value = ''; lngEl.value = ''; radiusEl.value = '150'; coordsEl.textContent = 'Not set';
    load();
  });

  async function load() {
    const { data } = await sb.from('work_locations').select('*').eq('org_id', org.id).order('created_at', { ascending: true });
    locations = data || [];
    renderList();
  }

  function renderList() {
    const el = container.querySelector('#wl-list');
    if (!locations.length) {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-6)">
        <div class="empty-state-title">No locations yet</div>
        <div class="empty-state-desc">Attendance is currently open from anywhere. Add a location to lock it down.</div></div>`;
      return;
    }
    const activeCount = locations.filter(l => l.is_active).length;
    el.innerHTML = `
      <div style="padding:var(--space-2) var(--space-4);font-size:var(--text-xs);color:var(--color-text-secondary);border-bottom:1px solid var(--color-border-light)">
        ${activeCount ? `Geofence <strong style="color:var(--color-success)">ON</strong> — staff must be within an active location.` : `Geofence <strong>OFF</strong> — no active locations, attendance is open.`}
      </div>
      ${locations.map(l => `
        <div style="display:flex;gap:var(--space-3);align-items:center;padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border-light);opacity:${l.is_active ? '1' : '0.55'}">
          <div style="flex:1;min-width:0">
            <div style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(l.name)}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">
              <a href="https://maps.google.com/?q=${l.lat},${l.lng}" target="_blank" rel="noopener" style="color:var(--color-accent)">${l.lat}, ${l.lng}</a>
              · within ${l.radius_m}m
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:var(--text-xs);color:var(--color-text-secondary)">
            <input type="checkbox" data-toggle="${l.id}" ${l.is_active ? 'checked' : ''}> Active
          </label>
          <button class="btn btn-ghost btn-sm" data-del="${l.id}" style="color:var(--color-error)" title="Delete">&times;</button>
        </div>`).join('')}`;

    el.querySelectorAll('[data-toggle]').forEach(cb => cb.addEventListener('change', async () => {
      const id = cb.dataset.toggle;
      const { error } = await sb.from('work_locations').update({ is_active: cb.checked }).eq('id', id);
      if (error) { toast('Could not update'); cb.checked = !cb.checked; return; }
      await logAction('attendance', 'work_location', id, cb.checked ? 'activated' : 'deactivated', null, null);
      load();
    }));
    el.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Delete this location?')) return;
      const id = btn.dataset.del;
      const { error } = await sb.from('work_locations').delete().eq('id', id);
      if (error) return toast('Could not delete: ' + error.message);
      await logAction('attendance', 'work_location', id, 'deleted', null, null);
      toast('Location deleted');
      load();
    }));
  }

  await load();
}
