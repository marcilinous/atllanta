import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';
import { navigate } from '../../js/router.js';
import { openPartnerForm } from './partner-form.js';

// CRM › Partners. Directory over crm_partner_details: search + filter the 6k
// RTcompu partners, onboard a new one, click through to the detail card.
const PAGE = 100;

export default async function crmPartners(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const canOnboard = !!membership; // any signed-in org member (BDEs included)

  let q = '';
  let region = '';
  let hub = '';
  let role = '';

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title" style="margin:0">Partners</h1>
        <p class="page-subtitle" style="margin:0">${esc(org?.name || 'Region')} · partner master directory</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <a href="#/crm" class="btn btn-secondary">← CRM</a>
        ${canOnboard ? '<button class="btn btn-primary" id="pt-onboard">+ Onboard partner</button>' : ''}
      </div>
    </div>
    <div id="pt-filters" style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3)"></div>
    <div id="pt-body"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
  `;

  if (!org) { document.getElementById('pt-body').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  const body = document.getElementById('pt-body');
  const filters = document.getElementById('pt-filters');

  const onboardBtn = document.getElementById('pt-onboard');
  if (onboardBtn) onboardBtn.addEventListener('click', () => {
    openPartnerForm({ org, user, onSaved: () => { toast('Partner onboarded'); load(); } });
  });

  // Filter option lists: one lightweight pull of the four filterable columns.
  const { data: opts } = await sb.from('crm_partner_details').select('region, hub, role');
  const uniq = (k) => [...new Set((opts || []).map(o => o[k]).filter(Boolean))].sort();
  const regions = uniq('region'), hubs = uniq('hub'), roles = uniq('role');

  function paintFilters() {
    const sel = (id, val, list, label) => `
      <select class="form-input" id="${id}" style="max-width:180px">
        <option value="">${esc(label)}</option>
        ${list.map(v => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(v)}</option>`).join('')}
      </select>`;
    filters.innerHTML = `
      <input class="form-input" id="pt-q" placeholder="Search name, Site ID, BDE…" value="${esc(q)}" style="max-width:280px">
      ${sel('pt-region', region, regions, 'All regions')}
      ${sel('pt-hub', hub, hubs, 'All hubs')}
      ${sel('pt-role', role, roles, 'All roles')}
    `;
    const qi = filters.querySelector('#pt-q');
    let t;
    qi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = qi.value.trim(); load(); }, 300); });
    filters.querySelector('#pt-region').addEventListener('change', e => { region = e.target.value; load(); });
    filters.querySelector('#pt-hub').addEventListener('change', e => { hub = e.target.value; load(); });
    filters.querySelector('#pt-role').addEventListener('change', e => { role = e.target.value; load(); });
  }

  async function load() {
    body.innerHTML = `<div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>`;
    let query = sb.from('crm_partner_details').select('*', { count: 'exact' })
      .order('partner_name', { ascending: true }).limit(PAGE);
    if (region) query = query.eq('region', region);
    if (hub) query = query.eq('hub', hub);
    if (role) query = query.eq('role', role);
    if (q) {
      const s = q.replace(/[,()%]/g, ' ').trim();
      if (s) query = query.or(`partner_name.ilike.%${s}%,site_id.ilike.%${s}%,bde_name.ilike.%${s}%,telecaller_name.ilike.%${s}%`);
    }
    const { data, error, count } = await query;
    if (error) {
      body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">Couldn't load partners</div><div class="empty-state-desc">${esc(error.message)}</div></div>`;
      toast('Partners: ' + error.message);
      return;
    }
    paint(data || [], count || 0);
  }

  function paint(rows, count) {
    if (!rows.length) {
      body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">No partners match</div><div class="empty-state-desc">Adjust the search or filters.</div></div>`;
      return;
    }
    const shown = rows.length < count ? `Showing ${rows.length} of ${count.toLocaleString('en-IN')}` : `${count.toLocaleString('en-IN')} partner${count === 1 ? '' : 's'}`;
    const statusBadge = (s) => {
      const t = (s || '').toLowerCase() === 'active' ? 'success' : (s ? 'neutral' : 'neutral');
      return s ? `<span class="badge badge-${t}">${esc(s)}</span>` : '';
    };
    body.innerHTML = `
      <div class="u-sm-muted" style="margin-bottom:var(--space-2)">${shown}${rows.length < count ? ' · refine to narrow' : ''}</div>
      <div class="card"><div style="overflow-x:auto">
        <table class="table" style="width:100%">
          <thead><tr>
            <th>Partner</th><th>Site ID</th><th>Role</th><th>Region · Hub</th><th>BDE</th><th>Telecaller</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr data-id="${esc(r.id)}" style="cursor:pointer">
                <td><span style="font-weight:var(--font-weight-medium)">${esc(r.partner_name || '—')}</span> ${statusBadge(r.role_status)}</td>
                <td class="u-sm-muted">${esc(r.site_id || '—')}</td>
                <td>${esc(r.role || '—')}</td>
                <td class="u-sm-muted">${esc([r.region, r.hub].filter(Boolean).join(' · ') || '—')}</td>
                <td class="u-sm-muted">${esc(r.bde_name || '—')}</td>
                <td class="u-sm-muted">${esc(r.telecaller_name || '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div></div>
    `;
    body.querySelectorAll('tr[data-id]').forEach(tr =>
      tr.addEventListener('click', () => navigate('crm/partner?id=' + tr.dataset.id)));
  }

  paintFilters();
  await load();
}
