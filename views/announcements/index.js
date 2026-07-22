import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate, initials, avColor } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

export default async function announcementsView(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);

  async function loadAnnouncements() {
    const { data, error } = await sb
      .from('announcements')
      .select('*, author:author_id(full_name, email)')
      .eq('org_id', org.id)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) { toast('Failed to load announcements'); return []; }
    return data || [];
  }

  async function render() {
    const announcements = await loadAnnouncements();

    container.innerHTML = `
      <div style="max-width:720px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-6)">
          <div>
            <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);margin:0">Announcements</h1>
            <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:var(--space-1) 0 0">Company-wide updates and notices</p>
          </div>
          ${isAdmin ? '<button class="btn btn-primary" id="btn-post">Post Announcement</button>' : ''}
        </div>
        <div id="feed"></div>
      </div>`;

    const feed = document.getElementById('feed');

    if (!announcements.length) {
      feed.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📢</div>
          <h3 class="empty-state-title">No Announcements</h3>
          <p class="empty-state-desc">There are no announcements yet.${isAdmin ? ' Post one to get started.' : ''}</p>
        </div>`;
    } else {
      feed.innerHTML = announcements.map(a => {
        const name = a.author?.full_name || 'Unknown';
        return `
        <div class="card" style="margin-bottom:var(--space-3)${a.pinned ? ';border-left:3px solid var(--color-accent)' : ''}">
          <div class="card-body">
            <div style="display:flex;align-items:flex-start;gap:var(--space-3)">
              <div style="width:36px;height:36px;border-radius:var(--radius-full);background:${avColor(name)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:var(--text-sm);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(name)}</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
                  <span style="font-weight:var(--font-weight-medium)">${esc(name)}</span>
                  <span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${formatDate(a.created_at)}</span>
                  ${a.pinned ? '<span class="badge" style="background:var(--color-accent-light);color:var(--color-accent);font-size:var(--text-xs)">Pinned</span>' : ''}
                </div>
                <h4 style="margin:var(--space-2) 0 var(--space-1);font-size:var(--text-md);font-weight:var(--font-weight-semibold)">${esc(a.title)}</h4>
                <p style="margin:var(--space-1) 0 0;font-size:var(--text-base);color:var(--color-text-secondary);white-space:pre-wrap">${esc(a.body)}</p>
              </div>
              ${isAdmin ? `
              <div style="display:flex;gap:var(--space-1);flex-shrink:0">
                <button class="btn btn-ghost btn-sm btn-pin" data-id="${a.id}" data-pinned="${a.pinned}" title="${a.pinned ? 'Unpin' : 'Pin'}" style="color:var(--color-text-tertiary)">
                  <svg width="14" height="14" fill="${a.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 17v5M5 17h14l-1.5-6.5a2 2 0 0 0-2-1.5H8.5a2 2 0 0 0-2 1.5L5 17z"/><path d="M15 9V5a3 3 0 0 0-6 0v4"/></svg>
                </button>
                <button class="btn btn-ghost btn-sm btn-edit" data-id="${a.id}" title="Edit" style="color:var(--color-text-tertiary)">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn btn-ghost btn-sm btn-del" data-id="${a.id}" title="Delete" style="color:var(--color-error)">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>` : ''}
            </div>
          </div>
        </div>`;
      }).join('');

      feed.querySelectorAll('.btn-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this announcement?')) return;
          const { error } = await sb.from('announcements').delete().eq('id', btn.dataset.id);
          if (error) { toast(error.message); return; }
          toast('Announcement deleted');
          render();
        });
      });

      feed.querySelectorAll('.btn-pin').forEach(btn => {
        btn.addEventListener('click', async () => {
          const nowPinned = btn.dataset.pinned === 'true';
          const { error } = await sb.from('announcements').update({ pinned: !nowPinned }).eq('id', btn.dataset.id);
          if (error) { toast(error.message); return; }
          toast(nowPinned ? 'Unpinned' : 'Pinned');
          render();
        });
      });

      feed.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const a = announcements.find(x => x.id === btn.dataset.id);
          if (a) showPostModal(a);
        });
      });
    }

    if (isAdmin) {
      document.getElementById('btn-post').addEventListener('click', () => showPostModal());
    }
  }

  function showPostModal(existing) {
    const isEdit = !!existing;
    openModal(isEdit ? 'Edit Announcement' : 'Post Announcement', `
      <form id="ann-form" style="display:flex;flex-direction:column;gap:var(--space-3)">
        <div>
          <label class="form-label">Title</label>
          <input class="form-input" name="title" required placeholder="Announcement title" value="${esc(existing?.title || '')}">
        </div>
        <div>
          <label class="form-label">Body</label>
          <textarea class="form-input" name="body" rows="5" required placeholder="Write your announcement...">${esc(existing?.body || '')}</textarea>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <input type="checkbox" name="pinned" id="ann-pin" ${existing?.pinned ? 'checked' : ''}>
          <label for="ann-pin" class="form-label" style="margin:0">Pin to top</label>
        </div>
        <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-2)">
          <button type="button" class="btn btn-secondary" onclick="document.querySelector('.modal-overlay').remove()">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Post'}</button>
        </div>
      </form>
    `);

    document.getElementById('ann-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const title = fd.get('title').trim();
      const body = fd.get('body').trim();
      const pinned = !!fd.get('pinned');
      if (!title || !body) return;

      if (isEdit) {
        const { error } = await sb.from('announcements').update({ title, body, pinned, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) { toast(error.message); return; }
        toast('Announcement updated');
      } else {
        const { error } = await sb.from('announcements').insert({
          org_id: org.id, author_id: user.id, title, body, pinned
        });
        if (error) { toast(error.message); return; }
        publishEvent('platform.announcement.created', { title });
        toast('Announcement posted');
      }
      closeModal();
      render();
    });
  }

  await render();
}
