// Atllanta founder sales-leads tracker — platform-operator-only pipeline for
// selling Atllanta itself. Backed by public.atllanta_leads (super_admin RLS).
import sb from '../../js/supabase.js';
import { getMembership } from '../../js/auth.js';
import { esc, toast, showError, openModal, closeModal, formatDate, downloadCsv } from '../../js/ui.js';

const STAGES = [
  { key: 'new',       label: 'New',       color: 'neutral' },
  { key: 'contacted', label: 'Contacted', color: 'info' },
  { key: 'demo',      label: 'Demo',      color: 'info' },
  { key: 'trial',     label: 'Trial',     color: 'warning' },
  { key: 'won',       label: 'Won',       color: 'success' },
  { key: 'lost',      label: 'Lost',      color: 'error' },
];
const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.key, s.label]));
const STAGE_COLOR = Object.fromEntries(STAGES.map(s => [s.key, s.color]));
const OPEN = new Set(['new', 'contacted', 'demo', 'trial']);
const SOURCES = ['inbound', 'referral', 'outbound', 'event', 'linkedin', 'other'];
const PLANS = ['free', 'pilot', 'paid'];

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const today = () => new Date().toISOString().slice(0, 10);

export default async function salesLeads(container) {
  // Founder-only. Non-super-admins never see this in nav, but guard the route too.
  if (getMembership()?.raw_role !== 'super_admin') {
    container.innerHTML = `<div class="empty-state" style="padding:var(--space-16)">
      <div class="empty-state-title">Not available</div>
      <div class="empty-state-desc">This tracker is only available to platform operators.</div>
    </div>`;
    return;
  }

  let leads = [];
  let stageFilter = 'all';

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Atllanta Sales</h1>
        <p class="page-subtitle">Your pipeline for selling Atllanta — prospects, stages and follow-ups.</p>
      </div>
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-secondary" id="sl-export">Export</button>
        <button class="btn btn-primary" id="sl-add">+ Add lead</button>
      </div>
    </div>

    <div id="sl-kpi" class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--space-3);margin-bottom:var(--space-5)"></div>

    <div class="tabs" id="sl-tabs" style="margin-bottom:var(--space-3)">
      <button class="tab active" data-stage="all">All</button>
      ${STAGES.map(s => `<button class="tab" data-stage="${s.key}">${s.label}</button>`).join('')}
    </div>

    <div class="card"><div id="sl-list">${loadingRows()}</div></div>
  `;

  container.querySelector('#sl-add').addEventListener('click', () => openForm(null));
  container.querySelector('#sl-export').addEventListener('click', exportCsv);
  container.querySelector('#sl-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#sl-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    stageFilter = tab.dataset.stage;
    render();
  });

  async function load() {
    const { data, error } = await sb.from('atllanta_leads')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      showError(container.querySelector('#sl-list'), 'Failed to load leads: ' + error.message, load);
      return;
    }
    leads = data || [];
    renderKpi();
    render();
  }

  function renderKpi() {
    const open = leads.filter(l => OPEN.has(l.stage));
    const won = leads.filter(l => l.stage === 'won');
    const pipeline = open.reduce((s, l) => s + Number(l.deal_value || 0), 0);
    const wonValue = won.reduce((s, l) => s + Number(l.deal_value || 0), 0);
    const overdue = open.filter(l => l.next_follow_up && l.next_follow_up < today()).length;
    const card = (label, value, color) =>
      `<div class="stat-card"><div class="stat-value"${color ? ` style="color:${color}"` : ''}>${value}</div><div class="stat-label">${label}</div></div>`;
    container.querySelector('#sl-kpi').innerHTML =
      card('Open leads', open.length) +
      card('Pipeline', inr(pipeline), 'var(--color-accent)') +
      card('Won', `${won.length} · ${inr(wonValue)}`, 'var(--color-success)') +
      card('Overdue follow-ups', overdue, overdue ? 'var(--color-error)' : '');
  }

  function render() {
    const el = container.querySelector('#sl-list');
    const rows = stageFilter === 'all' ? leads : leads.filter(l => l.stage === stageFilter);

    if (!rows.length) {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
        <div class="empty-state-title">${leads.length ? 'Nothing in this stage' : 'No leads yet'}</div>
        <div class="empty-state-desc">${leads.length ? 'Try another stage.' : 'Add your first prospect to start selling Atllanta.'}</div>
      </div>`;
      return;
    }

    const dash = '<span style="color:var(--color-text-tertiary)">—</span>';
    el.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Company</th><th>Contact</th><th>Stage</th><th style="text-align:right">Value</th><th>Next follow-up</th><th>Source</th><th></th></tr></thead>
      <tbody>${rows.map(l => {
        const overdue = OPEN.has(l.stage) && l.next_follow_up && l.next_follow_up < today();
        return `<tr>
          <td style="font-weight:var(--font-weight-medium)">${esc(l.company)}${l.plan_interest ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(l.plan_interest)} plan</div>` : ''}</td>
          <td>${l.contact_name ? esc(l.contact_name) : dash}${l.phone || l.email ? `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(l.phone || l.email)}</div>` : ''}</td>
          <td>${stageSelect(l)}</td>
          <td style="text-align:right">${l.deal_value ? inr(l.deal_value) : dash}</td>
          <td>${l.next_follow_up ? `<span style="${overdue ? 'color:var(--color-error);font-weight:var(--font-weight-medium)' : ''}">${formatDate(l.next_follow_up)}</span>` : dash}</td>
          <td>${l.source ? `<span class="badge badge-neutral">${esc(l.source)}</span>` : dash}</td>
          <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-edit="${l.id}">Edit</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    el.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => openForm(leads.find(l => l.id === b.dataset.edit))));
    el.querySelectorAll('select[data-stage-for]').forEach(sel =>
      sel.addEventListener('change', () => changeStage(sel.dataset.stageFor, sel.value)));
  }

  function stageSelect(l) {
    return `<select class="form-input" data-stage-for="${l.id}" style="height:30px;padding:2px 8px;font-size:var(--text-xs);max-width:130px"
      title="Change stage">
      ${STAGES.map(s => `<option value="${s.key}"${s.key === l.stage ? ' selected' : ''}>${s.label}</option>`).join('')}
    </select>`;
  }

  async function changeStage(id, stage) {
    const { error } = await sb.from('atllanta_leads')
      .update({ stage, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast('Could not update stage'); return; }
    const l = leads.find(x => x.id === id);
    if (l) l.stage = stage;
    renderKpi();
    toast('Stage updated to ' + STAGE_LABEL[stage]);
  }

  function openForm(existing) {
    const l = existing || {};
    const form = document.createElement('form');
    const field = (label, input) =>
      `<label style="display:block;font-size:var(--text-sm);font-weight:var(--font-weight-medium);margin-bottom:var(--space-1)">${label}</label>${input}`;
    form.innerHTML = `
      <div style="display:grid;gap:var(--space-3)">
        ${field('Company *', `<input class="form-input" name="company" required value="${esc(l.company || '')}" placeholder="Prospect company">`)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          ${field('Contact name', `<input class="form-input" name="contact_name" value="${esc(l.contact_name || '')}">`)}
          ${field('Phone', `<input class="form-input" name="phone" value="${esc(l.phone || '')}">`)}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          ${field('Email', `<input class="form-input" type="email" name="email" value="${esc(l.email || '')}">`)}
          ${field('Source', `<select class="form-input" name="source"><option value="">—</option>${SOURCES.map(s => `<option value="${s}"${l.source === s ? ' selected' : ''}>${s}</option>`).join('')}</select>`)}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-3)">
          ${field('Stage', `<select class="form-input" name="stage">${STAGES.map(s => `<option value="${s.key}"${(l.stage || 'new') === s.key ? ' selected' : ''}>${s.label}</option>`).join('')}</select>`)}
          ${field('Plan interest', `<select class="form-input" name="plan_interest"><option value="">—</option>${PLANS.map(p => `<option value="${p}"${l.plan_interest === p ? ' selected' : ''}>${p}</option>`).join('')}</select>`)}
          ${field('Deal value (₹)', `<input class="form-input" type="number" min="0" step="1" name="deal_value" value="${l.deal_value ?? ''}">`)}
        </div>
        ${field('Next follow-up', `<input class="form-input" type="date" name="next_follow_up" value="${l.next_follow_up || ''}">`)}
        ${field('Notes', `<textarea class="form-input" name="notes" rows="3">${esc(l.notes || '')}</textarea>`)}
        <div style="display:flex;justify-content:${existing ? 'space-between' : 'flex-end'};gap:var(--space-2);margin-top:var(--space-2)">
          ${existing ? `<button type="button" class="btn btn-ghost btn-sm" id="sl-del" style="color:var(--color-error)">Delete</button>` : ''}
          <div style="display:flex;gap:var(--space-2)">
            <button type="button" class="btn btn-secondary" id="sl-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Add lead'}</button>
          </div>
        </div>
      </div>`;

    form.querySelector('#sl-cancel').addEventListener('click', closeModal);
    if (existing) {
      form.querySelector('#sl-del').addEventListener('click', async () => {
        if (!confirm(`Delete lead “${l.company}”?`)) return;
        const { error } = await sb.from('atllanta_leads').delete().eq('id', l.id);
        if (error) { toast('Could not delete'); return; }
        closeModal(); toast('Lead deleted'); load();
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        company: fd.get('company').trim(),
        contact_name: fd.get('contact_name').trim() || null,
        phone: fd.get('phone').trim() || null,
        email: fd.get('email').trim() || null,
        source: fd.get('source') || null,
        plan_interest: fd.get('plan_interest') || null,
        deal_value: fd.get('deal_value') ? Number(fd.get('deal_value')) : null,
        stage: fd.get('stage') || 'new',
        next_follow_up: fd.get('next_follow_up') || null,
        notes: fd.get('notes').trim() || null,
      };
      if (!payload.company) return toast('Company is required');

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      if (existing) {
        const { error } = await sb.from('atllanta_leads')
          .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', l.id);
        if (error) { toast('Could not save: ' + error.message); btn.disabled = false; return; }
        toast('Lead updated');
      } else {
        const { error } = await sb.from('atllanta_leads').insert(payload);
        if (error) { toast('Could not add: ' + error.message); btn.disabled = false; return; }
        toast('Lead added');
      }
      closeModal();
      load();
    });

    openModal(existing ? 'Edit lead' : 'New lead', form);
  }

  function exportCsv() {
    if (!leads.length) { toast('Nothing to export'); return; }
    downloadCsv('atllanta-leads.csv', leads.map(l => ({
      company: l.company, contact: l.contact_name || '', phone: l.phone || '', email: l.email || '',
      source: l.source || '', plan_interest: l.plan_interest || '', deal_value: l.deal_value ?? '',
      stage: l.stage, next_follow_up: l.next_follow_up || '', notes: l.notes || '',
      created_at: l.created_at,
    })));
  }

  await load();
}

function loadingRows() {
  return `<div style="padding:var(--space-4)">${Array.from({ length: 5 }, () =>
    `<div class="skeleton skeleton-text" style="margin-bottom:var(--space-3)"></div>`).join('')}</div>`;
}
