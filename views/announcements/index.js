import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate, initials, avColor } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

export default async function announcementsView(container) {
  const user = await getUser();
  const org = await getOrg();
  const membership = await getMembership();
  const isAdmin = membership && (membership.role === 'owner' || membership.role === 'admin');

  container.innerHTML = `
    <div style="padding:var(--space-6);max-width:720px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-6)">
        <div>
          <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);color:var(--color-text-primary);margin:0">Announcements</h1>
          <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:var(--space-1) 0 0">Company-wide updates and notices</p>
        </div>
        ${isAdmin ? '<button class="btn btn-primary" id="btn-post">Post Announcement</button>' : ''}
      </div>
      <div id="feed"></div>
    </div>`;

  const feed = container.querySelector('#feed');

  async function loadAnnouncements() {
    const { data, error } = await sb
      .from('events')
      .select('*, actor:actor_id(full_name, email)')
      .eq('event_type', 'platform.announcement.created')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) { toast('Failed to load announcements', 'error'); return; }
    if (!data || data.length === 0) {
      feed.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" fill="none" stroke="var(--color-text-tertiary)" stroke-width="1.5" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <h3>No Announcements</h3>
          <p>There are no announcements yet.${isAdmin ? ' Post one to get started.' : ''}</p>
        </div>`;
      return;
    }

    const pinned = data.filter(e => e.payload?.pinned);
    const regular = data.filter(e => !e.payload?.pinned);
    const sorted = [...pinned, ...regular];

    feed.innerHTML = sorted.map(e => {
      const name = e.actor?.full_name || 'Unknown';
      const ini = initials(name);
      const bg = avColor(name);
      const isPinned = e.payload?.pinned;
      const canDelete = isAdmin;
      return `
        <div class="card" style="margin-bottom:var(--space-3)${isPinned ? ';border-left:3px solid var(--color-accent)' : ''}">
          <div class="card-body">
            <div style="display:flex;align-items:flex-start;gap:var(--space-3)">
              <div style="width:36px;height:36px;border-radius:var(--radius-full);background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:var(--text-sm);font-weight:var(--font-weight-semibold);flex-shrink:0">${esc(ini)}</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
                  <span style="font-weight:var(--font-weight-medium);color:var(--color-text-primary)">${esc(name)}</span>
                  <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${formatDate(e.created_at)}</span>
                  ${isPinned ? '<span class="badge" style="background:var(--color-accent-light);color:var(--color-accent);font-size:var(--text-xs)">Pinned</span>' : ''}
                </div>
                ${e.payload?.title ? `<h4 style="margin:var(--space-2) 0 var(--space-1);font-size:var(--text-md);font-weight:var(--font-weight-semibold);color:var(--color-text-primary)">${esc(e.payload.title)}</h4>` : ''}
                <p style="margin:var(--space-1) 0 0;font-size:var(--text-base);color:var(--color-text-secondary);white-space:pre-wrap">${esc(e.payload?.body || '')}</p>
              </div>
              ${canDelete ? `<button class="btn btn-ghost btn-sm btn-del" data-id="${e.id}" title="Delete" style="flex-shrink:0;color:var(--color-text-tertiary)">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    feed.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this announcement?')) return;
        const { error: delErr } = await sb.from('events').delete().eq('id', btn.dataset.id);
        if (delErr) { toast('Failed to delete', 'error'); return; }
        toast('Announcement deleted');
        loadAnnouncements();
      });
    });
  }

  if (isAdmin) {
    container.querySelector('#btn-post').addEventListener('click', () => {
      openModal('Post Announcement', `
        <form id="ann-form">
          <div class="form-group">
            <label class="form-label">Title</label>
            <input class="form-input" name="title" required placeholder="Announcement title" />
          </div>
          <div class="form-group">
            <label class="form-label">Body</label>
            <textarea class="form-input" name="body" rows="5" required placeholder="Write your announcement..."></textarea>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:var(--space-2)">
            <input type="checkbox" name="pinned" id="ann-pin" />
            <label for="ann-pin" class="form-label" style="margin:0">Pin to top</label>
          </div>
          <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-4)">
            <button type="button" class="btn btn-secondary" id="ann-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Post</button>
          </div>
        </form>
      `);

      document.getElementById('ann-cancel').addEventListener('click', closeModal);
      document.getElementById('ann-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const title = fd.get('title').trim();
        const body = fd.get('body').trim();
        const pinned = fd.has('pinned');
        if (!title || !body) return;

        const { error: insErr } = await sb.from('events').insert({
          org_id: org.id,
          event_type: 'platform.announcement.created',
          actor_id: user.id,
          payload: { title, body, pinned },
          status: 'completed'
        });

        if (insErr) { toast('Failed to post announcement', 'error'); return; }
        await publishEvent('platform.announcement.created', { title });
        closeModal();
        toast('Announcement posted');
        loadAnnouncements();
      });
    });
  }

  await loadAnnouncements();
}
