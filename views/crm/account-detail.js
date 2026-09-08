import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast, initials, avColor, formatDate } from '../../js/ui.js';
import { routeParams, navigate } from '../../js/router.js';
import { openAccountForm } from './account-form.js';

// CRM › Account detail. Read view of one account plus its related contacts,
// opportunities, and activity timeline. Editing reuses the shared account form.
export default async function crmAccountDetail(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const canEdit = ['owner', 'admin', 'manager'].includes(membership?.role || 'member');
  const { id } = routeParams();

  container.innerHTML = `<div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>`;

  if (!id) { navigate('crm/accounts'); return; }

  async function load() {
    const [{ data: account, error }, { data: contacts }, { data: opps }, { data: acts }, { data: users }] = await Promise.all([
      sb.from('crm_accounts').select('*').eq('id', id).single(),
      sb.from('crm_contacts').select('*').eq('account_id', id).order('created_at', { ascending: false }),
      sb.from('crm_opportunities').select('*').eq('account_id', id).order('created_at', { ascending: false }),
      sb.from('crm_activities').select('*').eq('related_type', 'account').eq('related_id', id).order('created_at', { ascending: false }).limit(20),
      sb.from('users').select('id, full_name, email'),
    ]);

    if (error || !account) {
      container.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">Account not found</div>
        <div class="empty-state-desc">It may have been removed, or you don't have access.</div>
        <a href="#/crm/accounts" class="btn btn-secondary" style="margin-top:var(--space-3)">Back to accounts</a>
      </div>`;
      return;
    }

    const ownerMap = {};
    (users || []).forEach(u => { ownerMap[u.id] = u; });
    const owner = ownerMap[account.owner_id];

    const infoRows = [
      ['Industry', account.industry],
      ['Website', account.website],
      ['Phone', account.phone],
      ['Tier', account.tier],
      ['Region', [account.region, account.district].filter(Boolean).join(' · ')],
      ['Location', [account.billing_city, account.billing_country].filter(Boolean).join(', ')],
      ['Owner', owner ? (owner.full_name || owner.email) : null],
      ['Customers', account.customer_count],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '');

    container.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
        <div class="u-row-3">
          <div style="width:44px;height:44px;border-radius:var(--radius-lg);background:${avColor(account.name || 'A')};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold)">${initials(account.name || '—')}</div>
          <div>
            <h1 class="page-title" style="margin:0">${esc(account.name || '—')}</h1>
            <p class="page-subtitle" style="margin:0">${esc([account.industry, account.tier && account.tier + ' tier'].filter(Boolean).join(' · ') || 'Account')}</p>
          </div>
        </div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          <a href="#/crm/accounts" class="btn btn-secondary">← Accounts</a>
          ${canEdit ? '<button class="btn btn-primary" id="edit-account-btn">Edit</button>' : ''}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:minmax(260px,1fr) 2fr;gap:var(--space-4);align-items:start">
        <div class="card"><div class="card-header" style="font-weight:var(--font-weight-semibold)">Details</div>
          <div class="card-body u-stack">
            ${infoRows.length ? infoRows.map(([k, v]) => `
              <div style="display:flex;justify-content:space-between;gap:var(--space-3)">
                <span class="u-sm-muted">${esc(k)}</span>
                <span style="text-align:right;font-weight:var(--font-weight-medium)">${esc(String(v))}</span>
              </div>`).join('') : '<div class="u-sm-muted">No additional details.</div>'}
            ${account.description ? `<div style="padding-top:var(--space-2);border-top:1px solid var(--color-border)"><div class="u-sm-muted" style="margin-bottom:var(--space-1)">Description</div>${esc(account.description)}</div>` : ''}
          </div>
        </div>

        <div class="u-stack-4">
          ${relatedCard('Contacts', contacts, c => `${esc([c.first_name, c.last_name].filter(Boolean).join(' ') || '—')}${c.title ? ` · <span class="u-sm-muted">${esc(c.title)}</span>` : ''}`, 'No contacts linked yet.')}
          ${relatedCard('Opportunities', opps, o => `${esc(o.name || '—')}${o.amount != null ? ` · <span class="u-sm-muted">${esc(String(o.amount))} ${esc(o.currency || '')}</span>` : ''}`, 'No opportunities yet.')}
          ${relatedCard('Recent activity', acts, act => `<span class="badge badge-neutral">${esc(act.type || 'note')}</span> ${esc(act.subject || '')} <span class="u-sm-muted">· ${act.created_at ? formatDate(act.created_at) : ''}</span>`, 'No activity logged yet.')}
        </div>
      </div>
    `;

    if (canEdit) {
      const btn = document.getElementById('edit-account-btn');
      if (btn) btn.addEventListener('click', () => {
        openAccountForm({ account, org, user, onSaved: () => { toast('Saved'); load(); } });
      });
    }
  }

  function relatedCard(title, rows, rowHtml, emptyText) {
    return `<div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:var(--font-weight-semibold)">${esc(title)}</span>
        <span class="badge badge-neutral">${(rows || []).length}</span>
      </div>
      <div class="card-body">
        ${(rows && rows.length) ? `<div class="u-stack">${rows.map(r => `<div style="padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)">${rowHtml(r)}</div>`).join('')}</div>` : `<div class="u-sm-muted">${esc(emptyText)}</div>`}
      </div>
    </div>`;
  }

  await load();
}
