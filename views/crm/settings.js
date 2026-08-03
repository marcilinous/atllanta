import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { navigate } from '../../js/router.js';

export default async function crmSettings(container) {
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`; return; }
  if (!isAdmin) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Access denied</div><div class="empty-state-desc">Only admins can edit the pipeline.</div></div>`;
    return;
  }

  let stages = [];

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><button class="btn btn-ghost btn-sm" id="back">← Pipeline</button></div>
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Pipeline stages</h1>
        <p class="page-subtitle">Define the stages deals move through, their win probability, and which close the deal</p>
      </div>
      <button class="btn btn-primary" id="add-stage">+ Stage</button>
    </div>
    <div class="card"><div id="stage-list"></div></div>
    <p style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-3)">Changes save automatically. A "Won" or "Lost" stage closes a deal when a card is dropped into it.</p>
  `;

  container.querySelector('#back').addEventListener('click', () => navigate('crm/opportunities'));
  container.querySelector('#add-stage').addEventListener('click', addStage);

  async function load() {
    const { data } = await sb.from('crm_pipeline_stages').select('*').eq('org_id', org.id).order('sort_order');
    stages = data || [];
    render();
  }

  function stageType(s) { return s.is_won ? 'won' : s.is_lost ? 'lost' : 'open'; }

  function render() {
    const el = container.querySelector('#stage-list');
    if (!stages.length) {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">No stages</div><div class="empty-state-desc">Add your first pipeline stage.</div></div>`;
      return;
    }

    el.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th style="width:40px">Order</th><th>Stage name</th><th style="width:120px">Probability</th><th style="width:130px">Type</th><th style="width:110px"></th></tr></thead>
      <tbody>${stages.map((s, i) => `
        <tr>
          <td style="white-space:nowrap">
            <button class="btn btn-ghost btn-sm" data-up="${s.id}" ${i === 0 ? 'disabled' : ''} title="Move up" style="padding:2px 6px">↑</button>
            <button class="btn btn-ghost btn-sm" data-down="${s.id}" ${i === stages.length - 1 ? 'disabled' : ''} title="Move down" style="padding:2px 6px">↓</button>
          </td>
          <td><input class="form-input" data-name="${s.id}" value="${esc(s.name)}" style="height:32px"></td>
          <td><input class="form-input" type="number" min="0" max="100" data-prob="${s.id}" value="${s.probability}" style="height:32px;width:90px"></td>
          <td>
            <select class="form-input" data-type="${s.id}" style="height:32px">
              <option value="open" ${stageType(s) === 'open' ? 'selected' : ''}>Open</option>
              <option value="won" ${stageType(s) === 'won' ? 'selected' : ''}>Won</option>
              <option value="lost" ${stageType(s) === 'lost' ? 'selected' : ''}>Lost</option>
            </select>
          </td>
          <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-del="${s.id}" style="color:var(--color-error)">Delete</button></td>
        </tr>`).join('')}</tbody>
    </table></div>`;

    el.querySelectorAll('[data-name]').forEach(inp => inp.addEventListener('change', () => saveField(inp.dataset.name, { name: inp.value.trim() || 'Untitled' })));
    el.querySelectorAll('[data-prob]').forEach(inp => inp.addEventListener('change', () => {
      let p = parseInt(inp.value);
      if (isNaN(p)) p = 0;
      p = Math.max(0, Math.min(100, p));
      inp.value = p;
      saveField(inp.dataset.prob, { probability: p });
    }));
    el.querySelectorAll('[data-type]').forEach(sel => sel.addEventListener('change', () => {
      const t = sel.value;
      const update = { is_won: t === 'won', is_lost: t === 'lost' };
      if (t === 'won') update.probability = 100;
      if (t === 'lost') update.probability = 0;
      saveField(sel.dataset.type, update);
    }));
    el.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => move(b.dataset.up, -1)));
    el.querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => move(b.dataset.down, 1)));
    el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => delStage(b.dataset.del)));
  }

  async function saveField(id, update) {
    const { error } = await sb.from('crm_pipeline_stages').update(update).eq('id', id);
    if (error) { toast('Could not save'); return load(); }
    await logAction('crm', 'pipeline_stage', id, 'updated', null, update);
    toast('Saved');
    if ('is_won' in update || 'probability' in update) load();
  }

  async function move(id, dir) {
    const idx = stages.findIndex(s => s.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= stages.length) return;
    const a = stages[idx], b = stages[swapIdx];
    const [r1, r2] = await Promise.all([
      sb.from('crm_pipeline_stages').update({ sort_order: b.sort_order }).eq('id', a.id),
      sb.from('crm_pipeline_stages').update({ sort_order: a.sort_order }).eq('id', b.id),
    ]);
    if (r1.error || r2.error) toast('Could not reorder');
    load();
  }

  async function addStage() {
    const maxOrder = stages.reduce((m, s) => Math.max(m, s.sort_order || 0), 0);
    const { data, error } = await sb.from('crm_pipeline_stages')
      .insert({ org_id: org.id, name: 'New stage', sort_order: maxOrder + 1, probability: 50, is_won: false, is_lost: false })
      .select('id').single();
    if (error) return toast('Could not add stage');
    await logAction('crm', 'pipeline_stage', data.id, 'created', null, { name: 'New stage' });
    load();
  }

  async function delStage(id) {
    const stage = stages.find(s => s.id === id);
    const { count } = await sb.from('crm_opportunities').select('*', { count: 'exact', head: true }).eq('stage_id', id);

    if (count > 0) {
      const fallback = stages.find(s => s.id !== id && !s.is_won && !s.is_lost) || stages.find(s => s.id !== id);
      if (!fallback) return toast('Add another stage before deleting this one');
      if (!confirm(`"${stage.name}" has ${count} deal${count !== 1 ? 's' : ''}. Move them to "${fallback.name}" and delete this stage?`)) return;
      const { error: mvErr } = await sb.from('crm_opportunities').update({ stage_id: fallback.id }).eq('stage_id', id);
      if (mvErr) return toast('Could not move deals: ' + mvErr.message);
    } else if (!confirm(`Delete "${stage.name}"?`)) {
      return;
    }

    const { error } = await sb.from('crm_pipeline_stages').delete().eq('id', id);
    if (error) return toast('Could not delete stage: ' + error.message);
    await logAction('crm', 'pipeline_stage', id, 'deleted', { name: stage.name }, null);
    toast('Stage deleted');
    load();
  }

  await load();
}
