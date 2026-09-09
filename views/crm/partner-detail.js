import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast, initials, avColor } from '../../js/ui.js';
import { routeParams, navigate } from '../../js/router.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { openPartnerForm } from './partner-form.js';

// CRM › Partner detail. Full partner-master card. Any member can edit;
// managers/admins/owners can delete.
const SECTIONS = [
  ['Contact', [
    ['contact_person_name', 'Contact Person'], ['email_address', 'Email'],
    ['mobile_number', 'Mobile'], ['alternative_mobile_no', 'Alt. Mobile'],
  ]],
  ['Location', [
    ['address', 'Address'], ['city', 'City'], ['pincode', 'Pincode'],
    ['district', 'District'], ['state', 'State'], ['region', 'Region'],
    ['hub', 'Hub'], ['coordinates', 'Co-ordinates'],
  ]],
  ['Tally & Tax', [
    ['tally_serial_no', 'Tally Serial No.'], ['pan_no', 'PAN No'], ['gstin', 'GSTIN'],
  ]],
  ['Assignment', [
    ['bde_name', 'BDE'], ['telecaller_name', 'Telecaller'],
  ]],
  ['Finance', [
    ['credit_limit', 'Credit Limit'], ['account_number', 'Account Number'],
    ['bank_name', 'Bank Name'], ['ifsc_code', 'IFSC Code'], ['upi_id', 'UPI ID'],
  ]],
  ['AP-CP Taalmel', [
    ['ap_cp_taalmel', 'AP-CP Taalmel'], ['ap_cp_taalmel_partner', 'AP-CP Taalmel Partner'],
  ]],
];

export default async function crmPartnerDetail(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const role = membership?.role || 'member';
  const canDelete = ['owner', 'admin', 'manager'].includes(role);
  const { id } = routeParams();

  container.innerHTML = `<div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>`;
  if (!id) { navigate('crm/partners'); return; }

  async function load() {
    const { data: p, error } = await sb.from('crm_partner_details').select('*').eq('id', id).single();
    if (error || !p) {
      container.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">Partner not found</div>
        <div class="empty-state-desc">It may have been removed, or you don't have access.</div>
        <a href="#/crm/partners" class="btn btn-secondary" style="margin-top:var(--space-3)">Back to partners</a>
      </div>`;
      return;
    }

    const sub = [p.role, p.role_status, p.site_id && 'Site ' + p.site_id].filter(Boolean).join(' · ');
    container.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
        <div class="u-row-3" style="display:flex;gap:var(--space-3);align-items:center">
          <div style="width:44px;height:44px;border-radius:var(--radius-lg);background:${avColor(p.partner_name || 'P')};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold)">${initials(p.partner_name || '—')}</div>
          <div>
            <h1 class="page-title" style="margin:0">${esc(p.partner_name || '—')}</h1>
            <p class="page-subtitle" style="margin:0">${esc(sub || 'Partner')}${p.top_25_list ? ` · <span class="badge badge-info">Top 25: ${esc(p.top_25_list)}</span>` : ''}</p>
          </div>
        </div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          <a href="#/crm/partners" class="btn btn-secondary" data-back>← Back</a>
          <a href="#/crm/log-visit?id=${esc(id)}" class="btn btn-secondary">Log visit</a>
          <button class="btn btn-primary" id="pd-edit">Edit</button>
          ${canDelete ? '<button class="btn btn-secondary" id="pd-delete" style="color:var(--color-error)">Delete</button>' : ''}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:var(--space-4);align-items:start">
        ${SECTIONS.map(([title, fields]) => {
          const shown = fields.filter(([k]) => p[k] !== null && p[k] !== undefined && p[k] !== '');
          return `<div class="card">
            <div class="card-header" style="font-weight:var(--font-weight-semibold)">${esc(title)}</div>
            <div class="card-body u-stack">
              ${shown.length ? shown.map(([k, label]) => `
                <div style="display:flex;justify-content:space-between;gap:var(--space-3)">
                  <span class="u-sm-muted">${esc(label)}</span>
                  <span style="text-align:right;font-weight:var(--font-weight-medium);word-break:break-word">${esc(k === 'credit_limit' ? Number(p[k]).toLocaleString('en-IN') : String(p[k]))}</span>
                </div>`).join('') : '<div class="u-sm-muted">—</div>'}
            </div>
          </div>`;
        }).join('')}
      </div>
    `;

    document.getElementById('pd-edit').addEventListener('click', () => {
      openPartnerForm({ partner: p, org, user, onSaved: () => { toast('Saved'); load(); } });
    });

    if (canDelete) {
      document.getElementById('pd-delete').addEventListener('click', async () => {
        if (!confirm(`Delete partner "${p.partner_name || ''}"? This cannot be undone.`)) return;
        const { error: delErr } = await sb.from('crm_partner_details').delete().eq('id', id);
        if (delErr) { toast('Delete failed: ' + delErr.message); return; }
        logAction('crm', 'partner_detail', id, 'deleted', p, null);
        publishEvent('crm.partner.deleted', { partner_id: id, partner_name: p.partner_name });
        toast('Partner deleted');
        navigate('crm/partners');
      });
    }
  }

  await load();
}
