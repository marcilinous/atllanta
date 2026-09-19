import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, backButton, formatDate } from '../../js/ui.js';
import { openPartnerForm } from './partner-form.js';
import { exportCSV } from '../../js/csv.js';

// CRM › Prospects. Unregistered-partner visits grouped into one row per prospect
// (by owner mobile, else firm name), so repeat visits collapse. "Register" opens
// the partner onboarding form prefilled from the prospect; on save it links every
// unregistered visit for that prospect to the new partner (crm_convert_prospect).

export default async function crmProspects(container) {
  const org = getOrg();
  const user = getUser();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title" style="margin:0">Prospects</h1>
        <p class="page-subtitle" style="margin:0">${esc(org?.name || '')} · unregistered partners visited in the field</p>
      </div>
      ${backButton('crm')}
    </div>
    <div id="pr-body"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
  `;
  if (!org) { document.getElementById('pr-body').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }
  const body = document.getElementById('pr-body');

  async function load() {
    const { data, error } = await sb.from('crm_visits')
      .select('firm_name, owner_name, owner_mobile, region, visited_at')
      .eq('partner_type', 'unregistered')
      .order('visited_at', { ascending: false })
      .limit(5000);
    if (error) { body.innerHTML = `<div class="empty-state"><div class="empty-state-title">Couldn't load prospects</div><div class="empty-state-desc">${esc(error.message)}</div></div>`; return; }

    // Group by mobile (fallback firm name). Keep the most recent visit's details.
    const groups = new Map();
    for (const v of (data || [])) {
      const key = (v.owner_mobile && v.owner_mobile.trim()) || (v.firm_name || '').trim().toLowerCase();
      if (!key) continue;
      let g = groups.get(key);
      if (!g) { g = { firm: v.firm_name || '—', owner: v.owner_name || '', mobile: v.owner_mobile || '', region: v.region || '', visits: 0, last: v.visited_at }; groups.set(key, g); }
      g.visits++;
      if (v.visited_at > g.last) g.last = v.visited_at;
      if (!g.owner && v.owner_name) g.owner = v.owner_name;
      if (!g.region && v.region) g.region = v.region;
    }
    const rows = [...groups.values()].sort((a, b) => b.visits - a.visits);

    if (!rows.length) {
      body.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">No prospects yet</div><div class="empty-state-desc">Unregistered-partner visits appear here as BDEs log them.</div></div>`;
      return;
    }

    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-3)">
        <span class="u-sm-muted">${rows.length} prospect${rows.length === 1 ? '' : 's'} · register one to link its visits to a partner record.</span>
        <button class="btn btn-secondary btn-sm" id="pr-export">Export CSV</button>
      </div>
      <div style="overflow-x:auto"><table class="table">
        <thead><tr><th>Firm</th><th>Owner</th><th>Mobile</th><th>Region</th><th>Visits</th><th>Last visit</th><th></th></tr></thead>
        <tbody>
          ${rows.map((r, i) => `<tr>
            <td><strong>${esc(r.firm)}</strong></td>
            <td>${esc(r.owner || '—')}</td>
            <td>${esc(r.mobile || '—')}</td>
            <td>${esc(r.region || '—')}</td>
            <td>${r.visits}</td>
            <td class="u-sm-muted">${r.last ? esc(formatDate(r.last)) : '—'}</td>
            <td style="text-align:right"><button class="btn btn-primary btn-sm" data-reg="${i}">Register</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;

    document.getElementById('pr-export').addEventListener('click', () => {
      exportCSV(`prospects-${new Date().toISOString().slice(0, 10)}`, rows, [
        { key: 'firm', label: 'Firm' }, { key: 'owner', label: 'Owner' }, { key: 'mobile', label: 'Mobile' },
        { key: 'region', label: 'Region' }, { key: 'visits', label: 'Visits' }, { key: 'last', label: 'Last visit' },
      ]);
      toast(`Exported ${rows.length.toLocaleString('en-IN')} prospects`);
    });

    body.querySelectorAll('[data-reg]').forEach(b => b.addEventListener('click', () => {
      const r = rows[Number(b.dataset.reg)];
      openPartnerForm({
        partner: {
          partner_name: r.firm === '—' ? '' : r.firm,
          contact_person_name: r.owner || '',
          mobile_number: r.mobile || '',
          region: r.region || '',
        },
        org, user,
        onSaved: async (saved) => {
          const { data: n, error } = await sb.rpc('crm_convert_prospect', {
            p_partner_id: saved.id, p_mobile: r.mobile || '', p_firm: r.firm || '',
          });
          if (error) { toast('Registered, but linking visits failed: ' + error.message); }
          else { toast(`Registered · ${n || 0} visit${(n === 1) ? '' : 's'} linked`); }
          load();
        },
      });
    }));
  }

  await load();
}
