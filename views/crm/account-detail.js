import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, loadingSkeleton } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { navigate, routeParams } from '../../js/router.js';
import { money, contactName, field, ownerName, fetchOrgUsers } from './common.js';
import { renderTimeline, openActivityModal } from './activities.js';

const VISIT_BUCKET = 'visit-selfies';
const vThumb = (p) => p ? p.replace(/\.jpg$/, '_thumb.jpg') : p;

// Fiscal year (Apr–Mar) bounds for CFY / LFY, as ISO strings.
function fyBounds(d = new Date()) {
  const y = d.getFullYear(), mo = d.getMonth() + 1;
  const s = mo >= 4 ? y : y - 1;
  return { cfyStart: `${s}-04-01`, cfyEnd: `${s + 1}-03-31`, lfyStart: `${s - 1}-04-01`, lfyEnd: `${s}-03-31` };
}

export default async function crmAccountDetail(container) {
  const org = getOrg();
  const user = getUser();
  const { id } = routeParams();
  if (!org || !id) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Account not found</div></div>`; return; }

  container.innerHTML = loadingSkeleton(8);

  const { data: account, error } = await sb
    .from('crm_accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !account) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Account not found</div>
      <button class="btn btn-secondary" id="back">Back to accounts</button></div>`;
    container.querySelector('#back')?.addEventListener('click', () => navigate('crm/accounts'));
    return;
  }

  const [{ data: contacts }, { data: opps }, users, { data: salesData }, { data: visitData }] = await Promise.all([
    sb.from('crm_contacts').select('*').eq('account_id', id).order('created_at', { ascending: false }),
    sb.from('crm_opportunities').select('*, stage:stage_id(name, is_won, is_lost)').eq('account_id', id).order('created_at', { ascending: false }),
    fetchOrgUsers(),
    sb.from('crm_report_rows').select('data').eq('account_id', id).ilike('report_type', 'Sales').limit(3000),
    sb.from('crm_visits').select('id, visited_at, visited_by_name, visit_status, call_outcome, remarks, selfie_path').eq('account_id', id).order('visited_at', { ascending: false }).limit(12),
  ]);
  const ownerLabel = account.owner_id ? ownerName(users, account.owner_id) : null;
  const visits = visitData || [];

  // Business summary from this partner's Sales (activation) rows: TP (New),
  // TSS and activation revenue, current fiscal year vs last.
  const fy = fyBounds();
  let tpC = 0, tpL = 0, tssC = 0, tssL = 0, revC = 0, revL = 0;
  for (const row of (salesData || [])) {
    const d = String(row.data?.['activation date'] || '').slice(0, 10);
    const t = row.data?.['activation type'];
    const v = parseFloat(row.data?.['sum of activation value']) || 0;
    if (d >= fy.cfyStart && d <= fy.cfyEnd) { revC += v; if (t === 'New') tpC++; else if (t === 'TSS') tssC++; }
    else if (d >= fy.lfyStart && d <= fy.lfyEnd) { revL += v; if (t === 'New') tpL++; else if (t === 'TSS') tssL++; }
  }
  const bizTile = (label, cfy, lfy, isMoney) => {
    const fmt = (n) => isMoney ? money(n) : n.toLocaleString('en-IN');
    const up = cfy > lfy, flat = cfy === lfy;
    const col = flat ? 'var(--color-text-secondary)' : (up ? 'var(--color-success)' : 'var(--color-error)');
    return `<div class="card" style="padding:var(--space-4)">
      <div style="font-size:var(--text-xs);color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.03em">${esc(label)}</div>
      <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold)">${fmt(cfy)}</div>
      <div style="font-size:var(--text-xs);color:${col}">LFY ${fmt(lfy)}</div>
    </div>`;
  };
  const hasSales = (salesData || []).length > 0;

  const infoRow = (label, val) => val ? `<div style="display:flex;justify-content:space-between;gap:var(--space-4);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
    <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(label)}</span>
    <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);text-align:right">${val}</span></div>` : '';

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)">
      <button class="btn btn-ghost btn-sm" id="back">← Accounts</button>
    </div>
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">${esc(account.name)}</h1>
        <p class="page-subtitle">${esc([account.tier, account.region].filter(Boolean).join(' · ') || 'Partner')}${ownerLabel && ownerLabel !== '—' ? ' · BDE: ' + esc(ownerLabel) : ''}</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-secondary" id="log-visit">Log visit</button>
        <button class="btn btn-secondary" id="log-activity">Log activity</button>
        <button class="btn btn-primary" id="new-deal">+ Deal</button>
      </div>
    </div>

    ${hasSales ? `<div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3);margin-bottom:var(--space-4)">
      ${bizTile('TP (Tally Prime)', tpC, tpL, false)}
      ${bizTile('TSS renewals', tssC, tssL, false)}
      ${bizTile('Activation revenue', revC, revL, true)}
    </div>` : ''}

    <div class="crm-detail-cols">
      <div class="card">
        <div class="card-header"><span class="card-title">Details</span></div>
        <div class="card-body">
          ${infoRow('Site ID', account.external_id ? `<span style="font-family:var(--font-mono)">${esc(account.external_id)}</span>` : '')}
          ${infoRow('Role', account.tier ? esc(account.tier) : '')}
          ${infoRow('Status', account.partner_status ? esc(account.partner_status) : '')}
          ${infoRow('Telecaller', account.telecaller ? esc(account.telecaller) : '')}
          ${infoRow('Website', account.website ? `<a href="${esc(account.website.startsWith('http') ? account.website : 'https://' + account.website)}" target="_blank" rel="noopener" style="color:var(--color-accent)">${esc(account.website)}</a>` : '')}
          ${infoRow('Phone', account.phone ? esc(account.phone) : '')}
          ${infoRow('Employees', account.employees_count ? esc(String(account.employees_count)) : '')}
          ${infoRow('Annual revenue', account.annual_revenue ? money(account.annual_revenue) : '')}
          ${infoRow('City', account.billing_city ? esc(account.billing_city) : '')}
          ${infoRow('District', account.district ? esc(account.district) : '')}
          ${infoRow('District (New)', account.district_new ? esc(account.district_new) : '')}
          ${infoRow('State', account.state ? esc(account.state) : '')}
          ${infoRow('Region', account.region ? esc(account.region) : '')}
          ${infoRow('Hub', account.hub ? esc(account.hub) : '')}
          ${account.description ? `<div style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(account.description)}</div>` : ''}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="card">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
            <span class="card-title" id="contacts-count">Contacts (${(contacts || []).length})</span>
            <button class="btn btn-ghost btn-sm" id="add-contact">+ Add</button>
          </div>
          <div id="contacts-body">${renderContacts(contacts || [])}</div>
        </div>

        <div class="card">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
            <span class="card-title">Visits (${visits.length})</span>
            <button class="btn btn-ghost btn-sm" id="log-visit-2">+ Log</button>
          </div>
          <div id="visits-body">${renderVisits(visits)}</div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Opportunities (${(opps || []).length})</span></div>
          <div>${renderOpps(opps || [])}</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4)">
      <div class="card-header"><span class="card-title">Activity</span></div>
      <div id="activity-timeline"></div>
    </div>
  `;

  container.querySelector('#back').addEventListener('click', () => navigate('crm/accounts'));
  container.querySelector('#new-deal').addEventListener('click', () => navigate(`crm/opportunities?account=${id}`));
  container.querySelector('#log-visit')?.addEventListener('click', () => navigate(`crm/visits?account=${id}`));
  container.querySelector('#log-visit-2')?.addEventListener('click', () => navigate(`crm/visits?account=${id}`));

  // Sign visit-selfie thumbnails and wire full-image open.
  (async () => {
    const paths = visits.filter(v => v.selfie_path).map(v => vThumb(v.selfie_path));
    if (paths.length) {
      const { data: urls } = await sb.storage.from(VISIT_BUCKET).createSignedUrls(paths, 3600);
      const sig = {}; (urls || []).forEach(u => { if (u.signedUrl) sig[u.path] = u.signedUrl; });
      container.querySelectorAll('#visits-body [data-vthumb]').forEach(img => {
        const url = sig[img.dataset.vthumb];
        if (url) img.src = url; else img.style.display = 'none';
      });
    }
    container.querySelectorAll('#visits-body [data-vfull]').forEach(img => img.addEventListener('click', async () => {
      const { data } = await sb.storage.from(VISIT_BUCKET).createSignedUrl(img.dataset.vfull, 3600);
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
    }));
  })();
  container.querySelector('#log-activity').addEventListener('click', () => openActivityModal('account', id, refreshTimeline));
  container.querySelector('#add-contact').addEventListener('click', openContactForm);

  wireContactRows();
  container.querySelectorAll('[data-opp]').forEach(row => {
    row.addEventListener('click', () => navigate(`crm/opportunity?id=${row.dataset.opp}`));
  });

  function wireContactRows() {
    container.querySelectorAll('#contacts-body [data-contact]').forEach(row => {
      row.addEventListener('click', () => navigate(`crm/contact?id=${row.dataset.contact}`));
    });
  }

  async function reloadContacts() {
    const { data: fresh } = await sb.from('crm_contacts').select('*').eq('account_id', id).order('created_at', { ascending: false });
    container.querySelector('#contacts-body').innerHTML = renderContacts(fresh || []);
    container.querySelector('#contacts-count').textContent = `Contacts (${(fresh || []).length})`;
    wireContactRows();
  }

  const timelineEl = container.querySelector('#activity-timeline');
  function refreshTimeline() { renderTimeline(timelineEl, 'account', id); }
  refreshTimeline();

  function renderContacts(list) {
    if (!list.length) return `<div style="padding:var(--space-5);text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm)">No contacts yet.</div>`;
    return `<div>${list.map(c => `
      <div data-contact="${c.id}" style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border-light);cursor:pointer">
        <div>
          <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(contactName(c))}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc([c.title, c.email].filter(Boolean).join(' · ') || '—')}</div>
        </div>
        ${c.phone ? `<span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(c.phone)}</span>` : ''}
      </div>`).join('')}</div>`;
  }

  function renderVisits(list) {
    if (!list.length) return `<div style="padding:var(--space-5);text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm)">No visits logged yet.</div>`;
    const STATUS_BADGE = { 'Met Owner': 'success', 'Met Resource': 'info', 'Not able to meet Owner': 'warning', 'Shop Closed': 'neutral', 'Business Closed': 'error' };
    return `<div>${list.map(v => {
      const when = v.visited_at ? new Date(v.visited_at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      const badge = STATUS_BADGE[v.visit_status] || 'neutral';
      return `<div style="display:flex;gap:var(--space-3);align-items:center;padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border-light)">
        ${v.selfie_path
          ? `<img data-vthumb="${esc(vThumb(v.selfie_path))}" data-vfull="${esc(v.selfie_path)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:var(--radius-md);cursor:pointer;flex-shrink:0;background:var(--color-bg-tertiary)">`
          : `<div style="width:40px;height:40px;border-radius:var(--radius-md);background:var(--color-bg-tertiary);flex-shrink:0"></div>`}
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;gap:var(--space-2)">
            <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(v.visited_by_name || 'BDE')}</span>
            <span class="badge badge-${badge}" style="font-size:10px;flex-shrink:0">${esc(v.visit_status || '')}</span>
          </div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(when)}${v.call_outcome ? ' · ' + esc(v.call_outcome) : ''}</div>
          ${v.remarks ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.remarks)}</div>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  function renderOpps(list) {
    if (!list.length) return `<div style="padding:var(--space-5);text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm)">No deals yet.</div>`;
    return `<div>${list.map(o => {
      const badge = o.status === 'won' ? 'success' : o.status === 'lost' ? 'error' : 'info';
      return `<div data-opp="${o.id}" style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border-light);cursor:pointer">
        <div>
          <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(o.name)}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(o.stage?.name || '—')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${money(o.amount, o.currency)}</div>
          <span class="badge badge-${badge}" style="font-size:10px">${esc(o.status)}</span>
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  function openContactForm() {
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="crm-cols-2">
        ${field('First name', `<input class="form-input" name="first_name">`)}
        ${field('Last name', `<input class="form-input" name="last_name">`)}
        ${field('Title', `<input class="form-input" name="title">`)}
        ${field('Email', `<input class="form-input" type="email" name="email">`)}
        ${field('Phone', `<input class="form-input" name="phone">`)}
      </div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-4)">
        <button type="button" class="btn btn-secondary" id="cancel-c">Cancel</button>
        <button type="submit" class="btn btn-primary">Add contact</button>
      </div>`;
    form.querySelector('#cancel-c').addEventListener('click', closeModal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        org_id: org.id, account_id: id,
        first_name: fd.get('first_name').trim() || null,
        last_name: fd.get('last_name').trim() || null,
        title: fd.get('title').trim() || null,
        email: fd.get('email').trim() || null,
        phone: fd.get('phone').trim() || null,
        created_by: user?.id, owner_id: user?.id,
      };
      if (!payload.first_name && !payload.last_name && !payload.email) return toast('Enter a name or email');
      const { data, error } = await sb.from('crm_contacts').insert(payload).select('id').single();
      if (error) return toast('Could not add contact');
      await logAction('crm', 'contact', data.id, 'created', null, payload);
      await publishEvent('crm.contact.created', { contact_id: data.id, account_id: id, org_id: org.id });
      toast('Contact added');
      closeModal();
      reloadContacts();
    });
    openModal('Add contact', form);
  }
}
