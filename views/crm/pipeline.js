import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, initials, avColor } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

// CRM › Pipeline. Opportunity kanban across crm_pipeline_stages. Drag a card to
// another stage to move it (won/lost stages set the opportunity status). CRUD via
// the anon+RLS client.
export default async function crmPipeline(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const canEdit = ['owner', 'admin', 'manager'].includes(membership?.role || 'member');

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Pipeline</h1>
        <p class="page-subtitle">Opportunities across your sales stages</p>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        <a href="#/crm" class="btn btn-secondary">← CRM</a>
        ${canEdit ? '<button class="btn btn-primary" id="add-opp-btn">+ New Opportunity</button>' : ''}
      </div>
    </div>
    <div id="pipe-wrap"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
  `;

  if (!org) { document.getElementById('pipe-wrap').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  let stages = [];
  let opps = [];
  const accountMap = {};
  const ownerMap = {};
  let accounts = [];

  const [{ data: stg, error: stgErr }, { data: ops, error: opErr }, { data: accs }, { data: users }] = await Promise.all([
    sb.from('crm_pipeline_stages').select('*').order('sort_order'),
    sb.from('crm_opportunities').select('*').order('created_at', { ascending: false }),
    sb.from('crm_accounts').select('id, name').order('name'),
    sb.from('users').select('id, full_name, email'),
  ]);
  if (stgErr) toast('Failed to load stages: ' + stgErr.message);
  if (opErr) toast('Failed to load opportunities: ' + opErr.message);
  stages = stg || [];
  opps = ops || [];
  accounts = accs || [];
  accounts.forEach(a => { accountMap[a.id] = a.name; });
  (users || []).forEach(u => { ownerMap[u.id] = u.full_name || u.email; });

  if (!stages.length) {
    document.getElementById('pipe-wrap').innerHTML = `<div class="empty-state" style="padding:var(--space-8)">
      <div class="empty-state-title">No pipeline stages</div>
      <div class="empty-state-desc">Ask an admin to set up the sales pipeline stages first.</div>
    </div>`;
    return;
  }

  const money = (amt, cur) => amt == null ? '' : `${cur ? cur + ' ' : ''}${Number(amt).toLocaleString()}`;

  function renderBoard() {
    const wrap = document.getElementById('pipe-wrap');
    const byStage = {};
    stages.forEach(s => { byStage[s.id] = []; });
    const noStage = [];
    opps.forEach(o => { (byStage[o.stage_id] ? byStage[o.stage_id] : noStage).push(o); });

    wrap.innerHTML = `
      <div style="display:flex;gap:var(--space-3);overflow-x:auto;padding-bottom:var(--space-3);align-items:flex-start">
        ${stages.map(s => {
          const list = byStage[s.id] || [];
          const total = list.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
          const accent = s.is_won ? 'var(--color-success)' : s.is_lost ? 'var(--color-error)' : 'var(--color-accent)';
          return `<div class="pipe-col" data-stage="${s.id}" style="flex:0 0 280px;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);display:flex;flex-direction:column;max-height:calc(100vh - 220px)">
            <div style="padding:var(--space-3);border-bottom:1px solid var(--color-border);position:sticky;top:0">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-2)">
                <span style="display:flex;align-items:center;gap:var(--space-2);font-weight:var(--font-weight-semibold)"><span style="width:8px;height:8px;border-radius:var(--radius-full);background:${accent}"></span>${esc(s.name)}</span>
                <span class="badge badge-neutral">${list.length}</span>
              </div>
              ${total ? `<div class="u-meta" style="margin-top:var(--space-1)">${esc(money(total, list[0]?.currency))}</div>` : ''}
            </div>
            <div class="pipe-body" data-stage="${s.id}" style="padding:var(--space-2);display:flex;flex-direction:column;gap:var(--space-2);overflow-y:auto;flex:1;min-height:60px">
              ${list.map(o => cardHtml(o)).join('') || `<div class="u-meta" style="padding:var(--space-3);text-align:center">Drop here</div>`}
            </div>
          </div>`;
        }).join('')}
      </div>
      ${noStage.length ? `<div class="u-sm-muted" style="margin-top:var(--space-3)">${noStage.length} opportunit${noStage.length === 1 ? 'y' : 'ies'} with no stage — open to assign one.</div>${noStage.map(o => `<div style="margin-top:var(--space-2)">${cardHtml(o)}</div>`).join('')}` : ''}
    `;

    wrap.querySelectorAll('.opp-card').forEach(card => {
      card.addEventListener('click', () => openOppForm(opps.find(o => o.id === card.dataset.id)));
      if (canEdit) {
        card.setAttribute('draggable', 'true');
        card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', card.dataset.id); card.style.opacity = '0.5'; });
        card.addEventListener('dragend', () => { card.style.opacity = ''; });
      }
    });

    if (canEdit) wrap.querySelectorAll('.pipe-body').forEach(col => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.style.background = 'var(--color-accent-light)'; });
      col.addEventListener('dragleave', () => { col.style.background = ''; });
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.style.background = '';
        const id = e.dataTransfer.getData('text/plain');
        const targetStage = col.dataset.stage;
        const opp = opps.find(o => o.id === id);
        if (!opp || opp.stage_id === targetStage) return;
        await moveOpp(opp, targetStage);
      });
    });
  }

  function cardHtml(o) {
    const owner = ownerMap[o.owner_id];
    const statusBadge = o.status === 'won' ? '<span class="badge badge-success">Won</span>' : o.status === 'lost' ? '<span class="badge badge-error">Lost</span>' : '';
    return `<div class="opp-card card" data-id="${o.id}" style="cursor:pointer;padding:var(--space-3);gap:var(--space-2);display:flex;flex-direction:column">
      <div style="font-weight:var(--font-weight-medium);font-size:var(--text-sm)">${esc(o.name || '—')} ${statusBadge}</div>
      <div class="u-meta">${esc(accountMap[o.account_id] || '—')}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-2)">
        <span style="font-weight:var(--font-weight-semibold);font-size:var(--text-sm)">${esc(money(o.amount, o.currency)) || '—'}</span>
        ${owner ? `<span title="${esc(owner)}" style="width:24px;height:24px;border-radius:var(--radius-full);background:${avColor(owner)};display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:var(--font-weight-semibold)">${initials(owner)}</span>` : ''}
      </div>
    </div>`;
  }

  async function moveOpp(opp, stageId) {
    const stage = stages.find(s => s.id === stageId);
    const patch = { stage_id: stageId, status: stage?.is_won ? 'won' : stage?.is_lost ? 'lost' : 'open' };
    if (stage && stage.probability != null) patch.probability = stage.probability;
    const { data, error } = await sb.from('crm_opportunities').update(patch).eq('id', opp.id).select().single();
    if (error) { toast('Move failed: ' + error.message); return; }
    Object.assign(opp, data);
    logAction('crm', 'opportunity', opp.id, 'stage_changed', { stage_id: opp.stage_id }, data);
    publishEvent('crm.opportunity.stage_changed', { opportunity_id: opp.id, stage_id: stageId, status: patch.status });
    renderBoard();
  }

  renderBoard();
  if (canEdit) document.getElementById('add-opp-btn').addEventListener('click', () => openOppForm());

  function openOppForm(existing) {
    const o = existing || {};
    const form = document.createElement('form');
    form.className = 'u-stack-4';
    form.innerHTML = `
      <div class="form-group"><label class="form-label">Name <span style="color:var(--color-error)">*</span></label>
        <input class="form-input" name="name" required value="${esc(o.name || '')}" placeholder="Acme — annual license"></div>
      <div class="form-group"><label class="form-label">Account</label>
        <select class="form-input" name="account_id"><option value="">— None —</option>${accounts.map(a => `<option value="${a.id}" ${o.account_id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Amount</label><input class="form-input" type="number" step="any" name="amount" value="${o.amount ?? ''}"></div>
        <div class="form-group"><label class="form-label">Currency</label><input class="form-input" name="currency" value="${esc(o.currency || '')}" placeholder="INR"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Stage</label>
          <select class="form-input" name="stage_id">${stages.map(s => `<option value="${s.id}" ${o.stage_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Close date</label><input class="form-input" type="date" name="close_date" value="${o.close_date || ''}"></div>
      </div>
      <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" name="description" rows="2">${esc(o.description || '')}</textarea></div>
      <div id="opp-err" class="hidden" style="color:var(--color-error);font-size:var(--text-sm)"></div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
        <button type="button" class="btn btn-secondary" id="opp-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="opp-save">${existing ? 'Save changes' : 'Create opportunity'}</button>
      </div>
    `;
    openModal(existing ? 'Edit opportunity' : 'New opportunity', form);
    form.querySelector('#opp-cancel').addEventListener('click', closeModal);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('#opp-err');
      const btn = form.querySelector('#opp-save');
      errEl.classList.add('hidden');
      const fd = new FormData(form);
      const name = (fd.get('name') || '').toString().trim();
      if (!name) { errEl.textContent = 'Name is required.'; errEl.classList.remove('hidden'); return; }
      const stageId = (fd.get('stage_id') || '').toString() || null;
      const stage = stages.find(s => s.id === stageId);
      const amountRaw = (fd.get('amount') || '').toString().trim();

      const payload = {
        name,
        account_id: (fd.get('account_id') || '').toString() || null,
        amount: amountRaw === '' ? null : Number(amountRaw),
        currency: (fd.get('currency') || '').toString().trim() || null,
        stage_id: stageId,
        close_date: (fd.get('close_date') || '').toString() || null,
        description: (fd.get('description') || '').toString().trim() || null,
        status: stage?.is_won ? 'won' : stage?.is_lost ? 'lost' : 'open',
      };

      btn.disabled = true; btn.textContent = existing ? 'Saving...' : 'Creating...';
      let result;
      if (existing) result = await sb.from('crm_opportunities').update(payload).eq('id', existing.id).select().single();
      else result = await sb.from('crm_opportunities').insert({ ...payload, org_id: org.id, owner_id: user.id, created_by: user.id }).select().single();

      if (result.error) { btn.disabled = false; btn.textContent = existing ? 'Save changes' : 'Create opportunity'; errEl.textContent = result.error.message; errEl.classList.remove('hidden'); return; }
      const saved = result.data;
      if (existing) { const i = opps.findIndex(x => x.id === saved.id); if (i !== -1) opps[i] = saved; logAction('crm', 'opportunity', saved.id, 'updated', existing, saved); publishEvent('crm.opportunity.updated', { opportunity_id: saved.id }); }
      else { opps.unshift(saved); logAction('crm', 'opportunity', saved.id, 'created', null, saved); publishEvent('crm.opportunity.created', { opportunity_id: saved.id, account_id: saved.account_id }); }
      closeModal();
      toast(existing ? 'Opportunity updated' : 'Opportunity created');
      renderBoard();
    });
  }
}
