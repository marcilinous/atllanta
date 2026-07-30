import sb from '../js/supabase.js';
import { getUser, getOrg } from '../js/auth.js';
import { esc, timeAgo, toast } from '../js/ui.js';
import { navigate } from '../js/router.js';
import { notifTarget, markRead, markAllRead } from '../js/notifications.js';

const MODULE_ICONS = {
  leave: '\u{1F333}', attendance: '\u{1F551}', recruitment: '\u{1F4BC}', people: '\u{1F465}',
  helpdesk: '\u{1F3AB}', finance: '\u{1F4B0}', platform: '\u{1F4E2}', system: '\u{2699}',
};
const MODULE_COLORS = {
  leave: 'var(--color-success-light)', attendance: 'var(--color-info-light)',
  recruitment: 'var(--color-warning-light)', people: 'var(--color-accent-light)',
  helpdesk: 'var(--color-info-light)', finance: 'var(--color-warning-light)',
  platform: 'var(--color-accent-light)', system: 'var(--color-bg-tertiary)',
};

export default async function notificationsView(container) {
  const org = getOrg();
  const user = getUser();

  if (!org || !user) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization found</div></div>`;
    return;
  }

  let filter = 'all';       // 'all' | 'unread'
  let moduleFilter = '';
  let page = 0;
  const pageSize = 25;

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Notifications</h1>
        <p class="page-subtitle">Everything that's happened across your workspace</p>
      </div>
      <button class="btn btn-secondary btn-sm" id="notif-mark-all">Mark all read</button>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;gap:var(--space-4);align-items:center;flex-wrap:wrap">
        <div class="tabs" id="notif-filter" style="border-bottom:none;margin-bottom:0">
          <button class="tab active" data-filter="all">All</button>
          <button class="tab" data-filter="unread">Unread</button>
        </div>
        <select class="form-input" id="notif-module" style="max-width:170px;height:34px">
          <option value="">All modules</option>
          <option value="leave">Leave</option>
          <option value="attendance">Attendance</option>
          <option value="recruitment">Recruitment</option>
          <option value="people">People</option>
          <option value="helpdesk">Helpdesk</option>
          <option value="finance">Finance</option>
          <option value="platform">Announcements</option>
        </select>
      </div>
      <div id="notif-page-list"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
    </div>
    <div style="display:flex;justify-content:center;gap:var(--space-3);margin-top:var(--space-4)" id="notif-page-pagination"></div>
  `;

  async function load() {
    let query = sb.from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('sent_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (filter === 'unread') query = query.eq('status', 'unread');
    if (moduleFilter) query = query.eq('module', moduleFilter);

    const { data: notifs, count, error } = await query;
    const listEl = document.getElementById('notif-page-list');
    const pagEl = document.getElementById('notif-page-pagination');

    if (error) {
      listEl.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-error)">Couldn't load notifications.</div>`;
      pagEl.innerHTML = '';
      return;
    }

    if (!notifs?.length) {
      listEl.innerHTML = `<div class="empty-state" style="padding:var(--space-10)">
        <div class="empty-state-title">${filter === 'unread' ? "You're all caught up" : 'No notifications yet'}</div>
        <div class="empty-state-desc">${filter === 'unread' ? 'No unread notifications.' : "Activity across your workspace will show up here."}</div>
      </div>`;
      pagEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = notifs.map(n => `
      <div class="notif-item ${n.status === 'unread' ? 'unread' : ''}" data-id="${n.id}"
        data-module="${esc(n.module || '')}" data-entity-type="${esc(n.entity_type || '')}"
        data-entity-id="${esc(n.entity_id || '')}" data-title="${esc(n.title || '')}"
        data-status="${esc(n.status)}">
        <div class="notif-icon" style="background:${MODULE_COLORS[n.module] || 'var(--color-bg-tertiary)'}">${MODULE_ICONS[n.module] || '\u{1F514}'}</div>
        <div class="notif-content">
          <div class="notif-title">${esc(n.title)}</div>
          ${n.body ? `<div style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-top:2px">${esc(n.body)}</div>` : ''}
          <div class="notif-time">${timeAgo(n.sent_at)}</div>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.notif-item').forEach(row => {
      row.addEventListener('click', async () => {
        if (row.dataset.status === 'unread') {
          row.classList.remove('unread');
          row.dataset.status = 'read';
          await markRead(row.dataset.id);
        }
        navigate(notifTarget({
          module: row.dataset.module,
          entity_type: row.dataset.entityType,
          entity_id: row.dataset.entityId || null,
          title: row.dataset.title,
        }));
      });
    });

    const totalPages = Math.ceil((count || 0) / pageSize);
    if (totalPages > 1) {
      pagEl.innerHTML = `
        <button class="btn btn-ghost btn-sm" ${page === 0 ? 'disabled' : ''} id="notif-prev">Previous</button>
        <span style="font-size:var(--text-sm);color:var(--color-text-secondary);line-height:30px">Page ${page + 1} of ${totalPages}</span>
        <button class="btn btn-ghost btn-sm" ${page >= totalPages - 1 ? 'disabled' : ''} id="notif-next">Next</button>
      `;
      document.getElementById('notif-prev')?.addEventListener('click', () => { page--; load(); });
      document.getElementById('notif-next')?.addEventListener('click', () => { page++; load(); });
    } else {
      pagEl.innerHTML = '';
    }
  }

  document.getElementById('notif-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    filter = btn.dataset.filter;
    document.querySelectorAll('#notif-filter .tab').forEach(b => b.classList.toggle('active', b === btn));
    page = 0;
    load();
  });

  document.getElementById('notif-module').addEventListener('change', (e) => {
    moduleFilter = e.target.value;
    page = 0;
    load();
  });

  document.getElementById('notif-mark-all').addEventListener('click', async () => {
    await markAllRead();
    toast('All notifications marked read');
    page = 0;
    load();
  });

  load();
}
