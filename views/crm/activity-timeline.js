import sb from '../../js/supabase.js';
import { esc, toast, initials, avColor, timeAgo, formatDate } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

const TYPES = ['note', 'call', 'task', 'email'];
const TYPE_ICON = {
  note: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z',
  call: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
  task: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  email: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
};

// Reusable CRM activity timeline for one record. Mounts a composer (notes/calls/
// tasks/emails) + a chronological list into `el`. Tasks carry a due date and a
// done toggle. All writes go through the anon+RLS client.
export async function renderActivityTimeline(el, { relatedType, relatedId, org, user, canEdit = true, ownerMap = {} } = {}) {
  let activities = [];

  async function load() {
    const { data, error } = await sb
      .from('crm_activities')
      .select('*')
      .eq('related_type', relatedType)
      .eq('related_id', relatedId)
      .order('created_at', { ascending: false });
    if (error) { el.innerHTML = `<div class="u-sm-muted">Failed to load activity: ${esc(error.message)}</div>`; return; }
    activities = data || [];
    paint();
  }

  function ownerName(id) { const o = ownerMap[id]; return o ? (o.full_name || o.email || '') : ''; }

  function itemHtml(a) {
    const isTask = a.type === 'task';
    const overdue = isTask && !a.completed && a.due_date && new Date(a.due_date) < new Date();
    const who = ownerName(a.owner_id);
    return `<div style="display:flex;gap:var(--space-3);padding:var(--space-3) 0;border-bottom:1px solid var(--color-border)">
      <div style="width:32px;height:32px;flex-shrink:0;border-radius:var(--radius-full);background:var(--color-accent-light);display:flex;align-items:center;justify-content:center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${TYPE_ICON[a.type] || TYPE_ICON.note}"/></svg>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
          <span class="badge badge-neutral">${esc(a.type || 'note')}</span>
          <span style="font-weight:var(--font-weight-medium)">${esc(a.subject || '')}</span>
          ${isTask && a.due_date ? `<span class="badge badge-${overdue ? 'error' : 'info'}">Due ${esc(formatDate(a.due_date))}</span>` : ''}
          ${isTask && a.completed ? '<span class="badge badge-success">Done</span>' : ''}
        </div>
        ${a.body ? `<div style="margin-top:var(--space-1);white-space:pre-wrap">${esc(a.body)}</div>` : ''}
        <div class="u-meta" style="margin-top:var(--space-1)">${who ? esc(who) + ' · ' : ''}${a.created_at ? esc(timeAgo(a.created_at)) : ''}</div>
      </div>
      ${isTask && canEdit ? `<div style="flex-shrink:0"><button class="btn btn-secondary btn-sm" data-toggle="${a.id}">${a.completed ? 'Reopen' : 'Mark done'}</button></div>` : ''}
    </div>`;
  }

  function paint() {
    el.innerHTML = `
      ${canEdit ? `<form id="act-composer" class="card" style="margin-bottom:var(--space-3)">
        <div class="card-body u-stack">
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
            <select class="form-input" name="type" id="act-type" style="max-width:130px;height:34px">${TYPES.map(t => `<option value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select>
            <input class="form-input" name="subject" placeholder="Subject" style="flex:1;height:34px" required>
            <input class="form-input" type="date" name="due_date" id="act-due" style="max-width:160px;height:34px;display:none">
          </div>
          <textarea class="form-input" name="body" rows="2" placeholder="Add details (optional)"></textarea>
          <div style="display:flex;justify-content:flex-end"><button type="submit" class="btn btn-primary btn-sm" id="act-log">Log activity</button></div>
        </div>
      </form>` : ''}
      <div id="act-list">${activities.length ? activities.map(itemHtml).join('') : '<div class="u-sm-muted" style="padding:var(--space-3) 0">No activity yet.</div>'}</div>
    `;

    if (canEdit) {
      const form = el.querySelector('#act-composer');
      const typeSel = el.querySelector('#act-type');
      const dueInput = el.querySelector('#act-due');
      typeSel.addEventListener('change', () => { dueInput.style.display = typeSel.value === 'task' ? '' : 'none'; });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = el.querySelector('#act-log');
        const fd = new FormData(form);
        const subject = (fd.get('subject') || '').toString().trim();
        if (!subject) return;
        const type = (fd.get('type') || 'note').toString();
        const payload = {
          org_id: org.id, type, subject,
          body: (fd.get('body') || '').toString().trim() || null,
          due_date: type === 'task' ? ((fd.get('due_date') || '').toString() || null) : null,
          related_type: relatedType, related_id: relatedId,
          owner_id: user.id, created_by: user.id,
        };
        btn.disabled = true; btn.textContent = 'Logging...';
        const { data, error } = await sb.from('crm_activities').insert(payload).select().single();
        if (error) { btn.disabled = false; btn.textContent = 'Log activity'; toast('Failed: ' + error.message); return; }
        activities.unshift(data);
        logAction('crm', 'activity', data.id, 'created', null, data);
        publishEvent('crm.activity.created', { activity_id: data.id, related_type: relatedType, related_id: relatedId, type });
        toast('Activity logged');
        paint();
      });

      el.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
        const id = b.dataset.toggle;
        const a = activities.find(x => x.id === id);
        if (!a) return;
        const next = !a.completed;
        b.disabled = true;
        const { data, error } = await sb.from('crm_activities')
          .update({ completed: next, completed_at: next ? new Date().toISOString() : null })
          .eq('id', id).select().single();
        if (error) { b.disabled = false; toast('Failed: ' + error.message); return; }
        Object.assign(a, data);
        publishEvent('crm.activity.updated', { activity_id: id, completed: next });
        paint();
      }));
    }
  }

  el.innerHTML = `<div class="u-sm-muted">Loading activity…</div>`;
  await load();
}
