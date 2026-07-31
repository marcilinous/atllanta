import sb from '../../js/supabase.js';
import { getOrg, getUser } from '../../js/auth.js';
import { esc, toast, openModal, closeModal } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';
import { routeParams } from '../../js/router.js';
import { money, contactName, fetchOrgUsers, userOptions, fetchAccountsLite, accountOptions, field, currentUserId, canSeeOthers, defaultScope, scopeFilter, scopeTabs } from './common.js';

export default async function crmOpportunities(container) {
  const org = getOrg();
  const user = getUser();
  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }

  const params = routeParams();
  let stages = [];
  let opps = [];
  let users = [];
  let accounts = [];
  let contacts = [];
  let scope = defaultScope();
  const showScope = canSeeOthers();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Pipeline</h1>
        <p class="page-subtitle" id="pipeline-sub">Drag deals between stages</p>
      </div>
      <div style="display:flex;gap:var(--space-3);align-items:center">
        ${showScope ? scopeTabs(scope) : ''}
        <button class="btn btn-primary" id="add-deal">+ Deal</button>
      </div>
    </div>
    <div id="board" style="overflow-x:auto"></div>
  `;

  async function load() {
    const [stageRes, oppRes] = await Promise.all([
      sb.from('crm_pipeline_stages').select('*').order('sort_order'),
      sb.from('crm_opportunities').select('*, account:account_id(id, name), contact:primary_contact_id(first_name, last_name)').order('created_at', { ascending: false }),
    ]);
    stages = stageRes.data || [];
    opps = oppRes.data || [];
    if (!users.length) users = await fetchOrgUsers();
    if (!accounts.length) accounts = await fetchAccountsLite();
    const { data: cts } = await sb.from('crm_contacts').select('id, first_name, last_name, account_id').order('first_name');
    contacts = cts || [];
    render();
  }

  function render() {
    const board = document.getElementById('board');
    if (!stages.length) {
      board.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">No pipeline stages</div><div class="empty-state-desc">Default stages should have been created for your org.</div></div>`;
      return;
    }

    const visible = scopeFilter(opps, scope);
    const openOpps = visible.filter(o => o.status === 'open');
    const totalOpen = openOpps.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const weighted = openOpps.reduce((s, o) => {
      const stage = stages.find(st => st.id === o.stage_id);
      const p = (o.probability ?? stage?.probability ?? 0) / 100;
      return s + (Number(o.amount) || 0) * p;
    }, 0);
    document.getElementById('pipeline-sub').textContent =
      `${openOpps.length} open · ${money(totalOpen)} pipeline · ${money(weighted)} weighted`;

    board.innerHTML = `<div class="kanban">${stages.map(stage => {
      const cards = visible.filter(o => o.stage_id === stage.id && (stage.is_won ? o.status === 'won' : stage.is_lost ? o.status === 'lost' : o.status === 'open'));
      const sum = cards.reduce((s, o) => s + (Number(o.amount) || 0), 0);
      const accent = stage.is_won ? 'var(--color-success)' : stage.is_lost ? 'var(--color-error)' : 'var(--color-accent)';
      return `<div class="kanban-col" data-stage="${stage.id}">
        <div class="kanban-col-header" style="border-top:3px solid ${accent}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:var(--font-weight-semibold);font-size:var(--text-sm)">${esc(stage.name)}</span>
            <span class="badge badge-neutral" style="font-size:10px">${cards.length}</span>
          </div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-top:2px">${money(sum)}${!stage.is_won && !stage.is_lost ? ` · ${stage.probability}%` : ''}</div>
        </div>
        <div class="kanban-body" data-drop="${stage.id}">
          ${cards.map(o => cardHtml(o)).join('')}
        </div>
      </div>`;
    }).join('')}</div>`;

    wireDnD();
    board.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('click', () => openForm(opps.find(o => o.id === card.dataset.id)));
    });
  }

  function cardHtml(o) {
    const who = o.account?.name || contactName(o.contact) || '';
    return `<div class="kanban-card" draggable="true" data-id="${o.id}">
      <div style="font-weight:var(--font-weight-medium);font-size:var(--text-sm);margin-bottom:2px">${esc(o.name)}</div>
      ${who ? `<div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(who)}</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:var(--space-2)">
        <span style="font-size:var(--text-sm);font-weight:var(--font-weight-semibold);color:var(--color-accent)">${money(o.amount, o.currency)}</span>
        ${o.close_date ? `<span style="font-size:10px;color:var(--color-text-tertiary)">${new Date(o.close_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>` : ''}
      </div>
    </div>`;
  }

  function wireDnD() {
    let draggedId = null;
    container.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        draggedId = card.dataset.id;
        e.dataTransfer.effectAllowed = 'move';
        card.style.opacity = '0.5';
      });
      card.addEventListener('dragend', () => { card.style.opacity = ''; draggedId = null; });
    });
    container.querySelectorAll('.kanban-body').forEach(zone => {
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', async (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const stageId = zone.dataset.drop;
        if (!draggedId) return;
        await moveOpp(draggedId, stageId);
      });
    });
  }

  async function moveOpp(oppId, stageId) {
    const opp = opps.find(o => o.id === oppId);
    const stage = stages.find(s => s.id === stageId);
    if (!opp || !stage || opp.stage_id === stageId) return;

    const status = stage.is_won ? 'won' : stage.is_lost ? 'lost' : 'open';
    const update = { stage_id: stageId, status, probability: stage.probability, updated_at: new Date().toISOString() };
    // optimistic
    Object.assign(opp, update);
    render();

    const { error } = await sb.from('crm_opportunities').update(update).eq('id', oppId);
    if (error) { toast('Could not move deal'); return load(); }
    await logAction('crm', 'opportunity', oppId, status === 'open' ? 'updated' : status, null, { stage: stage.name });
    if (status === 'won') await publishEvent('crm.opportunity.won', { opportunity_id: oppId, amount: opp.amount, name: opp.name, org_id: org.id });
    else if (status === 'lost') await publishEvent('crm.opportunity.lost', { opportunity_id: oppId, name: opp.name, org_id: org.id });
    else await publishEvent('crm.opportunity.stage_changed', { opportunity_id: oppId, stage: stage.name, org_id: org.id });
  }

  function openForm(existing) {
    const o = existing || {};
    const defaultStage = stages.find(s => !s.is_won && !s.is_lost)?.id;
    const form = document.createElement('form');
    form.innerHTML = `
      ${field('Deal name *', `<input class="form-input" name="name" required value="${esc(o.name || '')}">`)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        ${field('Account', `<select class="form-input" name="account_id">${accountOptions(accounts, o.account_id ?? params.account)}</select>`)}
        ${field('Primary contact', `<select class="form-input" name="primary_contact_id"><option value="">— None —</option>${contacts.map(c => `<option value="${c.id}" ${c.id === o.primary_contact_id ? 'selected' : ''}>${esc(contactName(c))}</option>`).join('')}</select>`)}
        ${field('Stage', `<select class="form-input" name="stage_id">${stages.map(s => `<option value="${s.id}" ${(o.stage_id || defaultStage) === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`)}
        ${field('Amount', `<input class="form-input" type="number" name="amount" value="${o.amount ?? ''}">`)}
        ${field('Close date', `<input class="form-input" type="date" name="close_date" value="${o.close_date || ''}">`)}
        ${field('Owner', `<select class="form-input" name="owner_id">${userOptions(users, existing ? o.owner_id : currentUserId())}</select>`)}
      </div>
      ${field('Source', `<input class="form-input" name="source" value="${esc(o.source || '')}" placeholder="referral, web, event...">`)}
      ${field('Notes', `<textarea class="form-input" name="description">${esc(o.description || '')}</textarea>`)}
      <div style="display:flex;justify-content:${existing ? 'space-between' : 'flex-end'};gap:var(--space-2);margin-top:var(--space-4)">
        ${existing ? `<button type="button" class="btn btn-danger" id="del-deal">Delete</button>` : ''}
        <div style="display:flex;gap:var(--space-2)">
          <button type="button" class="btn btn-secondary" id="cancel-deal">Cancel</button>
          <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Create deal'}</button>
        </div>
      </div>`;
    form.querySelector('#cancel-deal').addEventListener('click', closeModal);
    form.querySelector('#del-deal')?.addEventListener('click', async () => {
      if (!confirm('Delete this deal?')) return;
      const { error } = await sb.from('crm_opportunities').delete().eq('id', existing.id);
      if (error) return toast('Could not delete');
      await logAction('crm', 'opportunity', existing.id, 'deleted', existing, null);
      toast('Deal deleted');
      closeModal();
      load();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const stageId = fd.get('stage_id');
      const stage = stages.find(s => s.id === stageId);
      const status = stage?.is_won ? 'won' : stage?.is_lost ? 'lost' : 'open';
      const payload = {
        name: fd.get('name').trim(),
        account_id: fd.get('account_id') || null,
        primary_contact_id: fd.get('primary_contact_id') || null,
        stage_id: stageId || null,
        amount: fd.get('amount') ? Number(fd.get('amount')) : null,
        close_date: fd.get('close_date') || null,
        owner_id: fd.get('owner_id') || null,
        source: fd.get('source').trim() || null,
        description: fd.get('description').trim() || null,
        probability: stage?.probability ?? null,
        status,
      };
      if (!payload.name) return;

      if (existing) {
        const { error } = await sb.from('crm_opportunities').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) return toast('Could not save deal');
        await logAction('crm', 'opportunity', existing.id, 'updated', existing, payload);
        toast('Deal updated');
      } else {
        const { data, error } = await sb.from('crm_opportunities').insert({ ...payload, org_id: org.id, created_by: user?.id }).select('id').single();
        if (error) return toast('Could not create deal');
        await logAction('crm', 'opportunity', data.id, 'created', null, payload);
        await publishEvent('crm.opportunity.created', { opportunity_id: data.id, name: payload.name, amount: payload.amount, org_id: org.id });
        toast('Deal created');
      }
      closeModal();
      load();
    });
    openModal(existing ? 'Edit deal' : 'New deal', form);
  }

  document.getElementById('add-deal').addEventListener('click', () => openForm(null));
  container.querySelector('.crm-scope')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    scope = btn.dataset.scope;
    container.querySelectorAll('.crm-scope .tab').forEach(t => t.classList.toggle('active', t === btn));
    render();
  });
  await load();

  // If arriving from an account with ?account=, open the new-deal form pre-filled.
  if (params.account) openForm(null);
}
