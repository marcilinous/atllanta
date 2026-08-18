import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, showError, openModal, closeModal, downloadCsv, loadingSkeleton, parseCsv } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { navigate } from '../../js/router.js';
import { fetchOrgUsers, userOptions, field, ownerName, currentUserId, canSeeOthers, canManageData, defaultScope, scopeFilter, scopeTabs } from './common.js';
import { hasPartnerPack } from '../../js/features.js';

export default async function crmAccounts(container) {
  const org = getOrg();
  const user = getUser();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  // Orgs without the partner vertical get the standard Accounts screen.
  if (!hasPartnerPack()) return genericAccounts(container, org, user);

  let accounts = [];
  let users = [];
  let search = '';
  let fRegion = '', fHub = '', fDistrict = '', fRole = '';
  let scope = defaultScope();
  const showScope = canSeeOthers();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Partners</h1>
        <p class="page-subtitle">Your Tally partner base — filter by region, hub, district and role</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        ${canManageData() ? `<button class="btn btn-secondary" id="import-accounts">Import</button>
        <button class="btn btn-secondary" id="export-accounts">Export</button>` : ''}
        <button class="btn btn-primary" id="add-account">+ Partner</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        ${showScope ? scopeTabs(scope) : ''}
        <input type="text" class="form-input" id="account-search" placeholder="Search name, Site ID, district, hub..." style="max-width:280px;height:34px;flex:1;min-width:180px">
        <select class="form-input" id="f-region" style="height:34px;max-width:150px"></select>
        <select class="form-input" id="f-hub" style="height:34px;max-width:140px"></select>
        <select class="form-input" id="f-district" style="height:34px;max-width:160px"></select>
        <select class="form-input" id="f-role" style="height:34px;max-width:140px"></select>
      </div>
      <div id="account-list">${loadingSkeleton()}</div>
    </div>
  `;

  async function load() {
    if (!users.length) users = await fetchOrgUsers();
    const pageSize = 1000;
    let fromIdx = 0;
    const all = [];
    let firstError = null;
    for (;;) {
      const { data, error } = await sb.from('crm_accounts').select('*').order('name').range(fromIdx, fromIdx + pageSize - 1);
      if (error) { if (fromIdx === 0) firstError = error; break; }
      if (!data || !data.length) break;
      all.push(...data);
      if (data.length < pageSize) break;
      fromIdx += pageSize;
    }
    if (firstError) {
      showError(document.getElementById('account-list'), 'Failed to load partners: ' + firstError.message, load);
      return;
    }
    accounts = all;
    buildFilters();
    render();
  }

  // Populate the dimension filters from the loaded base (RT analyses by
  // Region, Hub, District New and Role).
  function buildFilters() {
    const distinct = (key) => [...new Set(accounts.map(a => (a[key] || '').trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    const fill = (id, label, vals, cur) => {
      const el = container.querySelector(id);
      el.innerHTML = `<option value="">${label}</option>` + vals.map(v => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(v)}</option>`).join('');
    };
    fill('#f-region', 'All regions', distinct('region'), fRegion);
    fill('#f-hub', 'All hubs', distinct('hub'), fHub);
    fill('#f-district', 'All districts', distinct('district_new'), fDistrict);
    fill('#f-role', 'All roles', distinct('tier'), fRole);
  }

  function filtered() {
    return scopeFilter(accounts, scope).filter(a => {
      if (fRegion && (a.region || '') !== fRegion) return false;
      if (fHub && (a.hub || '') !== fHub) return false;
      if (fDistrict && (a.district_new || '') !== fDistrict) return false;
      if (fRole && (a.tier || '') !== fRole) return false;
      if (search) {
        const hay = [a.name, a.external_id, a.district_new, a.district, a.region, a.hub, a.billing_city, a.state, a.telecaller]
          .map(v => (v || '').toLowerCase());
        if (!hay.some(v => v.includes(search))) return false;
      }
      return true;
    });
  }

  function render() {
    const el = document.getElementById('account-list');
    const matched = filtered();

    if (!matched.length) {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">${accounts.length ? 'No partners match' : 'No partners yet'}</div>
        <div class="empty-state-desc">${accounts.length ? 'Try clearing a filter or search.' : 'Import your partner base to get started.'}</div>
      </div>`;
      return;
    }

    const CAP = 250;
    const rows = matched.slice(0, CAP);
    const more = matched.length - rows.length;
    const dash = '<span style="color:var(--color-text-tertiary)">—</span>';

    el.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Site ID</th><th>Partner</th><th>BDE</th><th>Role</th><th>District</th><th>Region</th><th>Hub</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map(a => `
        <tr data-id="${a.id}" style="cursor:pointer">
          <td style="font-family:var(--font-mono);font-size:var(--text-sm)">${a.external_id ? esc(a.external_id) : dash}</td>
          <td style="font-weight:var(--font-weight-medium)">${esc(a.name)}</td>
          <td>${esc(ownerName(users, a.owner_id))}</td>
          <td>${a.tier ? esc(a.tier) : dash}</td>
          <td>${a.district_new ? esc(a.district_new) : dash}</td>
          <td>${a.region ? esc(a.region) : dash}</td>
          <td>${a.hub ? esc(a.hub) : dash}</td>
          <td>${a.partner_status ? esc(a.partner_status) : dash}</td>
          <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-edit="${a.id}" onclick="event.stopPropagation()">Edit</button></td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div style="padding:var(--space-3) var(--space-4);font-size:var(--text-sm);color:var(--color-text-secondary)">
      Showing ${rows.length.toLocaleString('en-IN')} of ${matched.length.toLocaleString('en-IN')}${more ? ` — refine filters to see the rest` : ''}.
    </div>`;

    el.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => navigate(`crm/account?id=${tr.dataset.id}`));
    });
    el.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openForm(accounts.find(a => a.id === btn.dataset.edit)));
    });
  }

  function openForm(existing) {
    const a = existing || {};
    const form = document.createElement('form');
    form.innerHTML = `
      ${field('Partner name *', `<input class="form-input" name="name" required value="${esc(a.name || '')}">`)}
      <div class="crm-cols-2">
        ${field('Site ID', `<input class="form-input" name="external_id" value="${esc(a.external_id || '')}" placeholder="Tally report mapping key">`)}
        ${field('BDE (owner)', `<select class="form-input" name="owner_id">${userOptions(users, existing ? a.owner_id : currentUserId())}</select>`)}
        ${field('Role', `<input class="form-input" name="tier" value="${esc(a.tier || '')}" placeholder="e.g. Retailer, TDP">`)}
        ${field('Role status', `<input class="form-input" name="partner_status" value="${esc(a.partner_status || '')}">`)}
        ${field('Phone', `<input class="form-input" name="phone" value="${esc(a.phone || '')}">`)}
        ${field('Telecaller', `<input class="form-input" name="telecaller" value="${esc(a.telecaller || '')}">`)}
        ${field('City', `<input class="form-input" name="billing_city" value="${esc(a.billing_city || '')}">`)}
        ${field('District', `<input class="form-input" name="district" value="${esc(a.district || '')}">`)}
        ${field('District (New)', `<input class="form-input" name="district_new" value="${esc(a.district_new || '')}">`)}
        ${field('State', `<input class="form-input" name="state" value="${esc(a.state || '')}">`)}
        ${field('Region', `<input class="form-input" name="region" value="${esc(a.region || '')}">`)}
        ${field('Hub', `<input class="form-input" name="hub" value="${esc(a.hub || '')}">`)}
      </div>
      ${field('Notes', `<textarea class="form-input" name="description">${esc(a.description || '')}</textarea>`)}
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-4)">
        <button type="button" class="btn btn-secondary" id="cancel-account">Cancel</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Create partner'}</button>
      </div>
    `;
    form.querySelector('#cancel-account').addEventListener('click', closeModal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const val = (k) => (fd.get(k) || '').trim() || null;
      const payload = {
        name: (fd.get('name') || '').trim(),
        external_id: val('external_id'),
        owner_id: fd.get('owner_id') || null,
        tier: val('tier'),
        partner_status: val('partner_status'),
        phone: val('phone'),
        telecaller: val('telecaller'),
        billing_city: val('billing_city'),
        district: val('district'),
        district_new: val('district_new'),
        state: val('state'),
        region: val('region'),
        hub: val('hub'),
        description: val('description'),
      };
      if (!payload.name) return;

      const siteIdError = (error) => error.code === '23505'
        ? 'That Site ID is already used by another partner'
        : null;

      if (existing) {
        const { error } = await sb.from('crm_accounts').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) return toast(siteIdError(error) || 'Could not save partner');
        await logAction('crm', 'account', existing.id, 'updated', existing, payload);
        toast('Partner updated');
      } else {
        const { data, error } = await sb.from('crm_accounts').insert({ ...payload, org_id: org.id, created_by: user?.id }).select('id').single();
        if (error) return toast(siteIdError(error) || 'Could not create partner');
        await logAction('crm', 'account', data.id, 'created', null, payload);
        await publishEvent('crm.account.created', { account_id: data.id, name: payload.name, org_id: org.id });
        toast('Partner created');
      }
      closeModal();
      load();
    });
    openModal(existing ? 'Edit partner' : 'New partner', form);
  }

  document.getElementById('add-account').addEventListener('click', () => openForm(null));
  document.getElementById('import-accounts')?.addEventListener('click', openImport);

  function pick(row, ...keys) {
    for (const k of keys) { if (row[k]?.trim()) return row[k].trim(); }
    return '';
  }

  function openImport() {
    const exact = {}; const ci = {};
    users.forEach(u => { if (u.full_name) { exact[u.full_name] = u.id; ci[u.full_name.toLowerCase()] = u.id; } });

    const rowToAccount = (r) => {
      const name = pick(r, 'partner name', 'name', 'account', 'account name');
      if (!name) return null;
      const ownerName = pick(r, 'bde', 'owner', 'account owner', 'sales rep');
      const owner_id = exact[ownerName] || ci[ownerName.toLowerCase()] || null;
      const tl = pick(r, 'tl', 'team lead');
      const cm = pick(r, 'cm', 'channel manager');
      return {
        org_id: org.id,
        name,
        owner_id,
        created_by: user?.id || null,
        industry: 'Tally Partner',
        billing_country: 'India',
        billing_city: pick(r, 'city') || null,
        external_id: pick(r, 'site id', 'external id', 'id') || null,
        tier: pick(r, 'role', 'tier', 'partner role') || null,
        partner_status: pick(r, 'role status', 'status') || null,
        state: pick(r, 'state') || null,
        region: pick(r, 'region') || null,
        district: pick(r, 'district') || null,
        district_new: pick(r, 'district new', 'district_new') || pick(r, 'district') || null,
        hub: pick(r, 'hub') || null,
        telecaller: pick(r, 'telecaller') || null,
        description: (tl || cm) ? `TL: ${tl || '—'} · CM: ${cm || '—'}` : null,
        _ownerName: ownerName,
      };
    };

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div style="display:grid;gap:var(--space-3)">
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">
          Upload a partner CSV. Recognised columns: <strong>Partner Name, Site ID, City, District, State, Region, Hub, Role, Role Status, BDE, Telecaller, TL, CM</strong>.
          Each partner is owned by its <strong>BDE</strong> (matched to staff), so territory and manager views work immediately.
        </div>
        <input type="file" accept=".csv,text/csv" class="form-input" id="import-file">
        <div id="import-preview" style="font-size:var(--text-sm);color:var(--color-text-secondary)"></div>
        <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
          <button type="button" class="btn btn-secondary" id="import-cancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="import-go" disabled>Import</button>
        </div>
      </div>`;
    let parsed = [];
    wrap.querySelector('#import-cancel').addEventListener('click', closeModal);
    wrap.querySelector('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      parsed = parseCsv(text).map(rowToAccount).filter(Boolean);
      const preview = wrap.querySelector('#import-preview');
      const go = wrap.querySelector('#import-go');
      if (!parsed.length) {
        preview.innerHTML = `<span style="color:var(--color-error)">No valid rows found. Check your headers.</span>`;
        go.disabled = true;
      } else {
        const matched = parsed.filter(a => a.owner_id).length;
        const unmatched = parsed.length - matched;
        preview.innerHTML = `Ready to import <strong>${parsed.length.toLocaleString('en-IN')}</strong> partners — ${matched.toLocaleString('en-IN')} matched to a BDE${unmatched ? `, <span style="color:var(--color-warning)">${unmatched} unmatched</span>` : ''}.`;
        go.disabled = false;
      }
    });
    wrap.querySelector('#import-go').addEventListener('click', async () => {
      const go = wrap.querySelector('#import-go');
      go.disabled = true;
      const rows = parsed.map(({ _ownerName, ...a }) => a);
      let done = 0, failed = 0;
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        go.textContent = `Importing… ${done.toLocaleString('en-IN')}/${rows.length.toLocaleString('en-IN')}`;
        const { error } = await sb.from('crm_accounts').insert(rows.slice(i, i + CHUNK));
        if (error) failed += Math.min(CHUNK, rows.length - i); else done += Math.min(CHUNK, rows.length - i);
      }
      await logAction('crm', 'account', null, 'imported', null, { count: done });
      toast(`Imported ${done.toLocaleString('en-IN')} partners${failed ? ` · ${failed} failed` : ''}`);
      closeModal();
      load();
    });
    openModal('Import partners', wrap);
  }

  document.getElementById('export-accounts')?.addEventListener('click', () => {
    const rows = filtered().map(a => ({ 'Site ID': a.external_id || '', Partner: a.name, BDE: ownerName(users, a.owner_id), Role: a.tier || '', 'Role Status': a.partner_status || '', City: a.billing_city || '', District: a.district || '', 'District New': a.district_new || '', State: a.state || '', Region: a.region || '', Hub: a.hub || '', Telecaller: a.telecaller || '', Notes: a.description || '' }));
    if (!rows.length) return toast('Nothing to export');
    downloadCsv('partners.csv', rows);
  });

  document.getElementById('account-search').addEventListener('input', (e) => { search = e.target.value.toLowerCase().trim(); render(); });
  container.querySelector('#f-region').addEventListener('change', (e) => { fRegion = e.target.value; render(); });
  container.querySelector('#f-hub').addEventListener('change', (e) => { fHub = e.target.value; render(); });
  container.querySelector('#f-district').addEventListener('change', (e) => { fDistrict = e.target.value; render(); });
  container.querySelector('#f-role').addEventListener('change', (e) => { fRole = e.target.value; render(); });
  container.querySelector('.crm-scope')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    scope = btn.dataset.scope;
    container.querySelectorAll('.crm-scope .tab').forEach(t => t.classList.toggle('active', t === btn));
    render();
  });

  await load();
}

// ============================================================
// Generic Accounts screen — for organizations without the partner pack.
// Standard CRM: companies you do business with.
// ============================================================
async function genericAccounts(container, org, user) {
  let accounts = [];
  let users = [];
  let search = '';
  let scope = defaultScope();
  const showScope = canSeeOthers();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Accounts</h1>
        <p class="page-subtitle">Companies you do business with</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        ${canManageData() ? `<button class="btn btn-secondary" id="export-accounts">Export</button>` : ''}
        <button class="btn btn-primary" id="add-account">+ Account</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
        ${showScope ? scopeTabs(scope) : ''}
        <input type="text" class="form-input" id="account-search" placeholder="Search name, industry, city..." style="max-width:320px;height:34px">
      </div>
      <div id="account-list">${loadingSkeleton()}</div>
    </div>
  `;

  async function load() {
    if (!users.length) users = await fetchOrgUsers();
    const pageSize = 1000; let from = 0; const all = [];
    for (;;) {
      const { data, error } = await sb.from('crm_accounts').select('*').order('name').range(from, from + pageSize - 1);
      if (error || !data || !data.length) break;
      all.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    accounts = all;
    render();
  }

  function filtered() {
    return scopeFilter(accounts, scope).filter(a => !search
      || (a.name || '').toLowerCase().includes(search)
      || (a.industry || '').toLowerCase().includes(search)
      || (a.billing_city || '').toLowerCase().includes(search));
  }

  function render() {
    const el = document.getElementById('account-list');
    const matched = filtered();
    if (!matched.length) {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">${accounts.length ? 'No matches' : 'No accounts yet'}</div>
        <div class="empty-state-desc">${accounts.length ? 'Try a different search.' : 'Add your first company to start tracking deals.'}</div></div>`;
      return;
    }
    const rows = matched.slice(0, 250);
    const dash = '<span style="color:var(--color-text-tertiary)">—</span>';
    el.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Owner</th><th>Industry</th><th>City</th><th>Phone</th><th></th></tr></thead>
      <tbody>${rows.map(a => `<tr data-id="${a.id}" style="cursor:pointer">
        <td style="font-weight:var(--font-weight-medium)">${esc(a.name)}</td>
        <td>${esc(ownerName(users, a.owner_id))}</td>
        <td>${a.industry ? esc(a.industry) : dash}</td>
        <td>${a.billing_city ? esc(a.billing_city) : dash}</td>
        <td>${a.phone ? esc(a.phone) : dash}</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-edit="${a.id}" onclick="event.stopPropagation()">Edit</button></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div style="padding:var(--space-3) var(--space-4);font-size:var(--text-sm);color:var(--color-text-secondary)">Showing ${rows.length.toLocaleString('en-IN')} of ${matched.length.toLocaleString('en-IN')}.</div>`;
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => navigate(`crm/account?id=${tr.dataset.id}`)));
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(accounts.find(a => a.id === b.dataset.edit))));
  }

  function openForm(existing) {
    const a = existing || {};
    const form = document.createElement('form');
    form.innerHTML = `
      ${field('Company name *', `<input class="form-input" name="name" required value="${esc(a.name || '')}">`)}
      <div class="crm-cols-2">
        ${field('Industry', `<input class="form-input" name="industry" value="${esc(a.industry || '')}">`)}
        ${field('Owner', `<select class="form-input" name="owner_id">${userOptions(users, existing ? a.owner_id : currentUserId())}</select>`)}
        ${field('Website', `<input class="form-input" name="website" value="${esc(a.website || '')}">`)}
        ${field('Phone', `<input class="form-input" name="phone" value="${esc(a.phone || '')}">`)}
        ${field('Employees', `<input class="form-input" type="number" name="employees_count" value="${a.employees_count ?? ''}">`)}
        ${field('Annual revenue', `<input class="form-input" type="number" name="annual_revenue" value="${a.annual_revenue ?? ''}">`)}
        ${field('City', `<input class="form-input" name="billing_city" value="${esc(a.billing_city || '')}">`)}
        ${field('Country', `<input class="form-input" name="billing_country" value="${esc(a.billing_country || '')}">`)}
      </div>
      ${field('Notes', `<textarea class="form-input" name="description">${esc(a.description || '')}</textarea>`)}
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-4)">
        <button type="button" class="btn btn-secondary" id="cancel-account">Cancel</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Create account'}</button>
      </div>`;
    form.querySelector('#cancel-account').addEventListener('click', closeModal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const val = (k) => (fd.get(k) || '').trim() || null;
      const payload = {
        name: (fd.get('name') || '').trim(),
        industry: val('industry'),
        website: val('website'),
        phone: val('phone'),
        employees_count: fd.get('employees_count') ? parseInt(fd.get('employees_count')) : null,
        annual_revenue: fd.get('annual_revenue') ? Number(fd.get('annual_revenue')) : null,
        owner_id: fd.get('owner_id') || null,
        billing_city: val('billing_city'),
        billing_country: val('billing_country'),
        description: val('description'),
      };
      if (!payload.name) return;
      if (existing) {
        const { error } = await sb.from('crm_accounts').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) return toast('Could not save account');
        await logAction('crm', 'account', existing.id, 'updated', existing, payload);
        toast('Account updated');
      } else {
        const { data, error } = await sb.from('crm_accounts').insert({ ...payload, org_id: org.id, created_by: user?.id }).select('id').single();
        if (error) return toast('Could not create account');
        await logAction('crm', 'account', data.id, 'created', null, payload);
        await publishEvent('crm.account.created', { account_id: data.id, name: payload.name, org_id: org.id });
        toast('Account created');
      }
      closeModal();
      load();
    });
    openModal(existing ? 'Edit account' : 'New account', form);
  }

  document.getElementById('add-account').addEventListener('click', () => openForm(null));
  document.getElementById('export-accounts')?.addEventListener('click', () => {
    const rows = filtered().map(a => ({ Name: a.name, Owner: ownerName(users, a.owner_id), Industry: a.industry || '', City: a.billing_city || '', Phone: a.phone || '', Website: a.website || '', Notes: a.description || '' }));
    if (!rows.length) return toast('Nothing to export');
    downloadCsv('accounts.csv', rows);
  });
  document.getElementById('account-search').addEventListener('input', (e) => { search = e.target.value.toLowerCase().trim(); render(); });
  container.querySelector('.crm-scope')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    scope = btn.dataset.scope;
    container.querySelectorAll('.crm-scope .tab').forEach(t => t.classList.toggle('active', t === btn));
    render();
  });

  await load();
}
