import sb from '../../js/supabase.js';
import { getOrg, getUser, getMembership } from '../../js/auth.js';
import { esc, toast, timeAgo, formatDate } from '../../js/ui.js';

const TYPE_ICON = {
  note: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z',
  call: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
  task: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  email: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
};

// CRM › Activities. Org-wide feed of notes/calls/tasks/emails logged on records,
// with a "my open tasks" filter and a done toggle. Creation happens on each
// record's detail page; this is the cross-record view.
export default async function crmActivities(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const canEdit = ['owner', 'admin', 'manager'].includes(membership?.role || 'member');

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Activities</h1>
        <p class="page-subtitle">Notes, calls, and tasks across your records</p>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        <a href="#/crm" class="btn btn-secondary">← CRM</a>
        <select class="form-input" id="act-filter" style="max-width:180px;height:34px">
          <option value="all">All activity</option>
          <option value="mytasks">My open tasks</option>
          <option value="opentasks">All open tasks</option>
        </select>
      </div>
    </div>
    <div class="card"><div class="card-body"><div id="act-feed">
      <div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div>
    </div></div></div>
  `;

  if (!org) { document.getElementById('act-feed').innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }

  let activities = [];
  const ownerMap = {};

  const [{ data: acts, error }, { data: users }] = await Promise.all([
    sb.from('crm_activities').select('*').order('created_at', { ascending: false }).limit(200),
    sb.from('users').select('id, full_name, email'),
  ]);
  if (error) toast('Failed to load activities: ' + error.message);
  activities = acts || [];
  (users || []).forEach(u => { ownerMap[u.id] = u.full_name || u.email; });

  const filterSel = document.getElementById('act-filter');
  filterSel.addEventListener('change', paint);
  paint();

  function paint() {
    const feed = document.getElementById('act-feed');
    const f = filterSel.value;
    let rows = activities;
    if (f === 'mytasks') rows = rows.filter(a => a.type === 'task' && !a.completed && a.owner_id === user.id);
    else if (f === 'opentasks') rows = rows.filter(a => a.type === 'task' && !a.completed);

    if (!rows.length) {
      feed.innerHTML = `<div class="empty-state" style="padding:var(--space-6)">
        <div class="empty-state-title">${f === 'all' ? 'No activity yet' : 'No open tasks'}</div>
        <div class="empty-state-desc">Log notes, calls, and tasks from any account, contact, or opportunity.</div>
      </div>`;
      return;
    }

    feed.innerHTML = rows.map(a => {
      const isTask = a.type === 'task';
      const overdue = isTask && !a.completed && a.due_date && new Date(a.due_date) < new Date();
      const who = ownerMap[a.owner_id] || '';
      return `<div style="display:flex;gap:var(--space-3);padding:var(--space-3) 0;border-bottom:1px solid var(--color-border)">
        <div style="width:32px;height:32px;flex-shrink:0;border-radius:var(--radius-full);background:var(--color-accent-light);display:flex;align-items:center;justify-content:center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${TYPE_ICON[a.type] || TYPE_ICON.note}"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
            <span class="badge badge-neutral">${esc(a.type || 'note')}</span>
            <span style="font-weight:var(--font-weight-medium)">${esc(a.subject || '')}</span>
            ${a.related_type ? `<span class="u-meta">on ${esc(a.related_type)}</span>` : ''}
            ${isTask && a.due_date ? `<span class="badge badge-${overdue ? 'error' : 'info'}">Due ${esc(formatDate(a.due_date))}</span>` : ''}
            ${isTask && a.completed ? '<span class="badge badge-success">Done</span>' : ''}
          </div>
          ${a.body ? `<div style="margin-top:var(--space-1);white-space:pre-wrap">${esc(a.body)}</div>` : ''}
          <div class="u-meta" style="margin-top:var(--space-1)">${who ? esc(who) + ' · ' : ''}${a.created_at ? esc(timeAgo(a.created_at)) : ''}</div>
        </div>
        ${isTask && canEdit ? `<div style="flex-shrink:0"><button class="btn btn-secondary btn-sm" data-toggle="${a.id}">${a.completed ? 'Reopen' : 'Mark done'}</button></div>` : ''}
      </div>`;
    }).join('');

    if (canEdit) feed.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.toggle;
      const a = activities.find(x => x.id === id);
      if (!a) return;
      const next = !a.completed;
      b.disabled = true;
      const { data, error: e } = await sb.from('crm_activities')
        .update({ completed: next, completed_at: next ? new Date().toISOString() : null })
        .eq('id', id).select().single();
      if (e) { b.disabled = false; toast('Failed: ' + e.message); return; }
      Object.assign(a, data);
      paint();
    }));
  }
}
