import sb from '../../js/supabase.js';
import { esc, toast, openModal, closeModal, timeAgo } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

// CRM field capture: quick "just log an update" for a partner.
//  - Visit  → crm_visits  (BDE logs a field visit)
//  - Call   → crm_calls   (BDE or telecaller logs a call)
// Available to any signed-in user; RLS records it under the caller. Mounts a
// combined recent-activity feed with the two log buttons on a partner page.

const VISIT_STATUS = ['Met', 'Not available', 'Follow-up', 'Order placed', 'Closed'];
const CALL_STATUS = ['Connected', 'No answer', 'Busy', 'Switched off', 'Follow-up'];

export async function renderFieldLog(el, { account, org, user, userName } = {}) {
  let visits = [];
  let calls = [];

  async function load() {
    const [{ data: v }, { data: c }] = await Promise.all([
      sb.from('crm_visits').select('*').eq('account_id', account.id).order('visited_at', { ascending: false }).limit(20),
      sb.from('crm_calls').select('*').eq('account_id', account.id).order('called_at', { ascending: false }).limit(20),
    ]);
    visits = v || [];
    calls = c || [];
    paint();
  }

  function paint() {
    const items = [
      ...visits.map(x => ({ kind: 'visit', at: x.visited_at, status: x.visit_status, who: x.visited_by_name, note: x.remarks || x.call_outcome })),
      ...calls.map(x => ({ kind: 'call', at: x.called_at, status: x.call_status, who: x.called_by_name || x.telecaller_name, note: x.outcome || x.remarks, follow: x.follow_up_date })),
    ].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

    el.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-2);flex-wrap:wrap">
          <span style="font-weight:var(--font-weight-semibold)">Field activity</span>
          <div style="display:flex;gap:var(--space-2)">
            <button class="btn btn-secondary btn-sm" id="fl-visit">+ Visit</button>
            <button class="btn btn-secondary btn-sm" id="fl-call">+ Call</button>
          </div>
        </div>
        <div class="card-body">
          ${items.length ? `<div class="u-stack">${items.map(it => `
            <div style="display:flex;gap:var(--space-3);align-items:flex-start;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)">
              <span class="badge badge-${it.kind === 'visit' ? 'info' : 'neutral'}">${it.kind}</span>
              <div style="flex:1;min-width:0">
                <div><strong>${esc(it.status || '—')}</strong>${it.note ? ` · ${esc(it.note)}` : ''}${it.follow ? ` <span class="badge badge-warning">follow-up ${esc(it.follow)}</span>` : ''}</div>
                <div class="u-meta">${esc(it.who || '')}${it.at ? ` · ${esc(timeAgo(it.at))}` : ''}</div>
              </div>
            </div>`).join('')}</div>` : '<div class="u-sm-muted">No visits or calls logged yet.</div>'}
        </div>
      </div>
    `;

    el.querySelector('#fl-visit').addEventListener('click', openVisit);
    el.querySelector('#fl-call').addEventListener('click', openCall);
  }

  function openVisit() {
    const form = document.createElement('form');
    form.className = 'u-stack-4';
    form.innerHTML = `
      <div class="form-group"><label class="form-label">Outcome</label>
        <select class="form-input" name="status">${VISIT_STATUS.map(s => `<option>${s}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Remarks</label><textarea class="form-input" name="remarks" rows="3" placeholder="What happened on the visit"></textarea></div>
      <div id="fl-err" class="hidden" style="color:var(--color-error);font-size:var(--text-sm)"></div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
        <button type="button" class="btn btn-secondary" id="fl-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="fl-save">Log visit</button>
      </div>`;
    openModal('Log visit — ' + (account.name || ''), form);
    form.querySelector('#fl-cancel').addEventListener('click', closeModal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('#fl-save'); const errEl = form.querySelector('#fl-err');
      const fd = new FormData(form);
      btn.disabled = true; btn.textContent = 'Saving...';
      const { data, error } = await sb.from('crm_visits').insert({
        org_id: org.id, account_id: account.id, firm_name: account.name || null,
        visited_by: user.id, visited_by_name: userName, visited_at: new Date().toISOString(),
        visit_status: (fd.get('status') || '').toString(), remarks: (fd.get('remarks') || '').toString().trim() || null, source: 'app',
      }).select().single();
      if (error) { btn.disabled = false; btn.textContent = 'Log visit'; errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
      visits.unshift(data);
      publishEvent('crm.visit.logged', { account_id: account.id, visit_id: data.id });
      closeModal(); toast('Visit logged'); paint();
    });
  }

  function openCall() {
    const form = document.createElement('form');
    form.className = 'u-stack-4';
    form.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Status</label>
          <select class="form-input" name="status">${CALL_STATUS.map(s => `<option>${s}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Follow-up date</label><input class="form-input" type="date" name="follow_up_date"></div>
      </div>
      <div class="form-group"><label class="form-label">Outcome</label><input class="form-input" name="outcome" placeholder="e.g. Interested, Not now"></div>
      <div class="form-group"><label class="form-label">Remarks</label><textarea class="form-input" name="remarks" rows="2"></textarea></div>
      <div id="fl-err" class="hidden" style="color:var(--color-error);font-size:var(--text-sm)"></div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2)">
        <button type="button" class="btn btn-secondary" id="fl-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="fl-save">Log call</button>
      </div>`;
    openModal('Log call — ' + (account.name || ''), form);
    form.querySelector('#fl-cancel').addEventListener('click', closeModal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('#fl-save'); const errEl = form.querySelector('#fl-err');
      const fd = new FormData(form);
      btn.disabled = true; btn.textContent = 'Saving...';
      const { data, error } = await sb.from('crm_calls').insert({
        org_id: org.id, account_id: account.id, firm_name: account.name || null,
        called_by: user.id, called_by_name: userName, telecaller_name: userName, called_at: new Date().toISOString(),
        call_status: (fd.get('status') || '').toString(), outcome: (fd.get('outcome') || '').toString().trim() || null,
        remarks: (fd.get('remarks') || '').toString().trim() || null, follow_up_date: (fd.get('follow_up_date') || '').toString() || null, source: 'app',
      }).select().single();
      if (error) { btn.disabled = false; btn.textContent = 'Log call'; errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
      calls.unshift(data);
      publishEvent('crm.call.logged', { account_id: account.id, call_id: data.id });
      closeModal(); toast('Call logged'); paint();
    });
  }

  el.innerHTML = `<div class="u-sm-muted">Loading field activity…</div>`;
  await load();
}
