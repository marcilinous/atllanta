import sb from '../js/supabase.js';
import { getUser, getOrg, getMembership } from '../js/auth.js';
import { esc, toast, timeAgo, initials, avColor, openModal, closeModal, formatDate } from '../js/ui.js';

export default async function dashboard(container) {
  const org = getOrg();
  const user = getUser();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const greeting = today.getHours() < 12 ? 'Good morning' : today.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = membership?.full_name?.split(' ')[0] || user?.user_metadata?.full_name?.split(' ')[0] || '';

  container.innerHTML = `
    <style>
      @keyframes dash-float {
        0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.07; }
        50% { transform: translateY(-20px) rotate(3deg); opacity: 0.12; }
      }
      @keyframes dash-drift {
        0%, 100% { transform: translate(0, 0) scale(1); }
        33% { transform: translate(10px, -15px) scale(1.05); }
        66% { transform: translate(-8px, -8px) scale(0.97); }
      }
      @keyframes dash-pulse {
        0%, 100% { opacity: 0.04; }
        50% { opacity: 0.09; }
      }
      .dash-two-col {
        display: grid;
        grid-template-columns: 1fr 380px;
        gap: var(--space-6);
        align-items: start;
      }
      @media (max-width: 1024px) {
        .dash-two-col { grid-template-columns: 1fr; }
      }
      .leaves-panel {
        position: relative;
        overflow: hidden;
        border-radius: var(--radius-xl);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
      }
      .leaves-bg {
        position: absolute;
        inset: 0;
        pointer-events: none;
        overflow: hidden;
        z-index: 0;
      }
      .leaves-bg .shape {
        position: absolute;
        border-radius: 50%;
      }
      .leaves-bg .s1 {
        width: 120px; height: 120px;
        background: var(--color-accent);
        top: -30px; right: -20px;
        animation: dash-float 8s ease-in-out infinite;
      }
      .leaves-bg .s2 {
        width: 80px; height: 80px;
        background: var(--color-success);
        bottom: 40px; left: -20px;
        animation: dash-drift 10s ease-in-out infinite;
      }
      .leaves-bg .s3 {
        width: 60px; height: 60px;
        background: var(--color-warning);
        top: 50%; right: 30%;
        animation: dash-pulse 6s ease-in-out infinite;
      }
      .leaves-bg .s4 {
        width: 160px; height: 160px;
        background: var(--color-info);
        bottom: -60px; right: -40px;
        animation: dash-float 12s ease-in-out infinite reverse;
      }
      .leaves-bg .s5 {
        width: 40px; height: 40px;
        background: var(--color-error);
        top: 30%; left: 20%;
        animation: dash-drift 7s ease-in-out infinite reverse;
      }
      .leaves-content {
        position: relative;
        z-index: 1;
      }
      .leave-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: var(--space-3);
        align-items: center;
        padding: var(--space-3) var(--space-4);
        border-bottom: 1px solid var(--color-border-light);
        transition: background var(--transition-fast);
      }
      .leave-row:last-child { border-bottom: none; }
      .leave-row:hover { background: rgba(255,255,255,0.03); }
    </style>

    <div id="dash-header" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);margin-bottom:var(--space-6);flex-wrap:wrap">
      <div>
        <h1 class="page-title" style="margin:0">${greeting}${firstName ? ', ' + esc(firstName) : ''}</h1>
        <p class="page-subtitle" style="margin:var(--space-1) 0 0">${today.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' })}${org ? ' · ' + esc(org.name) : ''}</p>
      </div>
      <div id="att-status" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-4);background:var(--color-bg-secondary);border-radius:var(--radius-full)">
        <div style="width:8px;height:8px;border-radius:var(--radius-full);background:var(--color-text-tertiary)"></div>
        <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">Loading...</span>
      </div>
    </div>

    <div class="dash-two-col">
      <div>
        <div id="composer" style="margin-bottom:var(--space-4)"></div>
        <div id="feed" style="display:grid;gap:var(--space-4)">
          <div class="card" style="padding:var(--space-6);text-align:center"><div class="skeleton skeleton-text"></div></div>
        </div>
      </div>
      <div class="leaves-panel" id="leaves-panel">
        <div class="leaves-bg">
          <div class="shape s1"></div>
          <div class="shape s2"></div>
          <div class="shape s3"></div>
          <div class="shape s4"></div>
          <div class="shape s5"></div>
        </div>
        <div class="leaves-content">
          <div style="padding:var(--space-4);border-bottom:1px solid var(--color-border-light)">
            <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-md)">Organization Holidays</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${today.getFullYear()} holiday calendar</div>
          </div>
          <div id="leaves-list" style="max-height:520px;overflow-y:auto">
            <div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text" style="width:70%"></div></div>
          </div>
        </div>
      </div>
    </div>
  `;

  if (!org) return;

  const [attResult, postsResult, eventsResult, membersResult, leavesResult] = await Promise.all([
    sb.from('attendance').select('*').eq('user_id', user.id).eq('date', todayStr).maybeSingle(),
    sb.from('posts').select('*').eq('org_id', org.id).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(30),
    sb.from('events').select('*, actor:actor_id(full_name, email)').order('created_at', { ascending: false }).limit(15),
    sb.from('memberships').select('user_id, full_name, email, role').eq('organization_id', org.id),
    sb.from('holidays').select('*').eq('year', today.getFullYear()).order('date', { ascending: true }),
  ]);

  const allMembers = membersResult.data || [];

  // Attendance status pill
  const attEl = document.getElementById('att-status');
  if (attEl) {
    const att = attResult.data;
    let dot = 'var(--color-text-tertiary)';
    let label = 'Not checked in';
    if (att?.check_in && !att?.check_out) {
      dot = 'var(--color-success)';
      const elapsed = ((Date.now() - new Date(att.check_in).getTime()) / 3600000).toFixed(1);
      label = `Working · ${elapsed}h`;
    } else if (att?.check_out) {
      dot = 'var(--color-accent)';
      label = `Done · ${att.total_hours ? Number(att.total_hours).toFixed(1) + 'h' : 'complete'}`;
    }
    attEl.innerHTML = `
      <div style="width:8px;height:8px;border-radius:var(--radius-full);background:${dot}"></div>
      <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">${label}</span>
      <a href="#/me" style="font-size:var(--text-xs);color:var(--color-accent);text-decoration:none;margin-left:var(--space-1)">My Hub &rarr;</a>
    `;
  }

  // Holidays panel
  const leavesListEl = document.getElementById('leaves-list');
  if (leavesListEl) {
    const holidays = (leavesResult.data || []).filter(h => {
      const d = new Date(h.date);
      return d.getDay() !== 0;
    });
    if (!holidays.length) {
      leavesListEl.innerHTML = `
        <div style="padding:var(--space-8);text-align:center">
          <div style="font-size:var(--text-2xl);margin-bottom:var(--space-2)">📅</div>
          <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">No holidays configured</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-1)">${isAdmin ? 'Add holidays in Leave Settings' : 'Ask your admin to set up the holiday calendar'}</div>
        </div>`;
    } else {
      const past = holidays.filter(h => h.date < todayStr);
      const todayH = holidays.filter(h => h.date === todayStr);
      const upcoming = holidays.filter(h => h.date > todayStr);

      let html = '';
      if (todayH.length) {
        html += `<div style="padding:var(--space-2) var(--space-4);font-size:var(--text-xs);font-weight:var(--font-weight-semibold);color:var(--color-success);text-transform:uppercase;letter-spacing:0.05em;background:var(--color-bg-secondary)">Today</div>`;
        html += todayH.map(h => holidayRow(h, 'today')).join('');
      }
      if (upcoming.length) {
        html += `<div style="padding:var(--space-2) var(--space-4);font-size:var(--text-xs);font-weight:var(--font-weight-semibold);color:var(--color-accent);text-transform:uppercase;letter-spacing:0.05em;background:var(--color-bg-secondary)">Upcoming (${upcoming.length})</div>`;
        html += upcoming.map(h => holidayRow(h, 'upcoming')).join('');
      }
      if (past.length) {
        html += `<div style="padding:var(--space-2) var(--space-4);font-size:var(--text-xs);font-weight:var(--font-weight-semibold);color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.05em;background:var(--color-bg-secondary)">Past (${past.length})</div>`;
        html += past.map(h => holidayRow(h, 'past')).join('');
      }
      leavesListEl.innerHTML = html;
    }
  }

  function holidayRow(h, period) {
    const d = new Date(h.date);
    const dayName = d.toLocaleDateString('en', { weekday: 'short' });
    const dateLabel = d.toLocaleDateString('en', { day: 'numeric', month: 'short' });
    const isPast = period === 'past';
    const isToday = period === 'today';
    const dotColor = isToday ? 'var(--color-success)' : isPast ? 'var(--color-text-tertiary)' : 'var(--color-accent)';

    return `
      <div class="leave-row" style="${isPast ? 'opacity:0.5' : ''}">
        <div style="width:32px;height:32px;border-radius:var(--radius-lg);background:${isToday ? 'var(--color-success-light)' : isPast ? 'var(--color-bg-tertiary)' : 'var(--color-accent-light)'};display:flex;align-items:center;justify-content:center;font-size:var(--text-sm);flex-shrink:0">${isToday ? '🎉' : h.is_optional ? '🔹' : '📅'}</div>
        <div style="min-width:0">
          <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.name)}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${dayName}, ${dateLabel}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${h.is_optional ? '<span style="font-size:var(--text-xs);padding:2px 8px;border-radius:var(--radius-full);background:var(--color-warning-light);color:var(--color-warning)">Optional</span>' : ''}
          ${isToday ? '<span style="font-size:var(--text-xs);padding:2px 8px;border-radius:var(--radius-full);background:var(--color-success-light);color:var(--color-success)">Today</span>' : ''}
        </div>
      </div>`;
  }

  // Composer (managers+)
  const composerEl = document.getElementById('composer');
  if (composerEl && isManager) {
    const authorName = membership?.full_name || user?.user_metadata?.full_name || 'You';
    composerEl.innerHTML = `
      <div class="card" style="padding:var(--space-4)">
        <div style="display:flex;gap:var(--space-3);align-items:flex-start">
          <div style="width:40px;height:40px;border-radius:var(--radius-full);background:${avColor(authorName)};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold);font-size:var(--text-sm);flex-shrink:0">${initials(authorName)}</div>
          <div style="flex:1">
            <textarea class="form-input" id="post-text" rows="2" placeholder="Share an update, announcement, or shoutout..." style="resize:vertical;border:none;padding:0;background:transparent;font-size:var(--text-base);min-height:48px"></textarea>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:var(--space-2)">
              <div style="display:flex;gap:var(--space-2)">
                <button class="btn btn-ghost btn-sm post-type-btn active" data-type="announcement" title="Announcement" style="font-size:var(--text-xs)">📢 Announce</button>
                <button class="btn btn-ghost btn-sm post-type-btn" data-type="shoutout" title="Shoutout" style="font-size:var(--text-xs)">🎉 Shoutout</button>
                <button class="btn btn-ghost btn-sm post-type-btn" data-type="update" title="Update" style="font-size:var(--text-xs)">📝 Update</button>
              </div>
              <button class="btn btn-primary btn-sm" id="post-submit">Post</button>
            </div>
          </div>
        </div>
      </div>
    `;

    let postType = 'announcement';
    composerEl.querySelectorAll('.post-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        composerEl.querySelectorAll('.post-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        postType = btn.dataset.type;
      });
    });

    composerEl.querySelector('#post-submit').addEventListener('click', async () => {
      const content = composerEl.querySelector('#post-text').value.trim();
      if (!content) return toast('Write something first');
      const btn = composerEl.querySelector('#post-submit');
      btn.disabled = true;
      btn.textContent = 'Posting...';
      const { error } = await sb.from('posts').insert({
        org_id: org.id,
        author_id: user.id,
        content,
        type: postType,
      });
      if (error) { toast(error.message); btn.disabled = false; btn.textContent = 'Post'; return; }
      composerEl.querySelector('#post-text').value = '';
      btn.disabled = false;
      btn.textContent = 'Post';
      toast('Posted');
      dashboard(container);
    });
  }

  // Build feed items — mix posts + events
  const feedItems = [];

  for (const post of (postsResult.data || [])) {
    const author = allMembers.find(m => m.user_id === post.author_id);
    feedItems.push({
      id: post.id,
      type: 'post',
      postType: post.type,
      pinned: post.pinned,
      author: author?.full_name || author?.email || 'Team member',
      authorId: post.author_id,
      content: post.content,
      reactions: post.reactions || {},
      time: post.created_at,
    });
  }

  for (const ev of (eventsResult.data || [])) {
    const parts = ev.event_type.split('.');
    const action = parts[parts.length - 1];
    const entity = parts.length > 1 ? parts[parts.length - 2] : '';
    const payload = ev.payload || {};

    let content = '';
    let icon = '🔔';
    if (action === 'created' && entity === 'employee') {
      content = `welcomed a new team member${payload.name ? ': **' + payload.name + '**' : ''}`;
      icon = '👋';
    } else if (action === 'approved' && entity === 'request') {
      content = `approved a leave request`;
      icon = '✅';
    } else if (action === 'created' && entity === 'job') {
      content = `posted a new job opening${payload.title ? ': **' + payload.title + '**' : ''}`;
      icon = '💼';
    } else if (action === 'shortlisted') {
      content = `shortlisted a candidate`;
      icon = '⭐';
    } else if (action === 'completed' && entity === 'checkin') {
      content = `checked in for the day`;
      icon = '📍';
    } else if (action === 'feedback_submitted') {
      content = `submitted interview feedback`;
      icon = '📝';
    } else {
      content = `${action} ${entity}`.trim();
    }

    feedItems.push({
      id: ev.id,
      type: 'event',
      author: ev.actor?.full_name || ev.actor?.email || 'System',
      authorId: ev.actor_id,
      content,
      icon,
      time: ev.created_at,
    });
  }

  feedItems.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.time) - new Date(a.time);
  });

  const feedEl = document.getElementById('feed');
  if (!feedItems.length) {
    feedEl.innerHTML = `
      <div class="card" style="padding:var(--space-8);text-align:center">
        <div style="font-size:var(--text-2xl);margin-bottom:var(--space-3)">📋</div>
        <div style="font-weight:var(--font-weight-semibold);margin-bottom:var(--space-1)">Your noticeboard is empty</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${isManager ? 'Post an announcement to get things started.' : 'Updates and announcements from your organization will appear here.'}</div>
      </div>`;
  } else {
    feedEl.innerHTML = feedItems.map(item => {
      const authorName = item.author;
      const color = avColor(authorName);
      const ago = timeAgo(item.time);

      if (item.type === 'post') {
        const typeLabel = { announcement: '📢', shoutout: '🎉', update: '📝', milestone: '🏆' };
        const typeBadge = typeLabel[item.postType] || '';
        const reactions = item.reactions;
        const canPin = isAdmin && !item.pinned;
        const canUnpin = isAdmin && item.pinned;
        const canDelete = item.authorId === user.id || isAdmin;

        return `
          <div class="card" style="padding:0;overflow:hidden${item.pinned ? ';border-left:3px solid var(--color-accent)' : ''}">
            ${item.pinned ? '<div style="padding:var(--space-1) var(--space-4);background:var(--color-accent-light);font-size:var(--text-xs);color:var(--color-accent);font-weight:var(--font-weight-medium)">📌 Pinned</div>' : ''}
            <div style="padding:var(--space-4)">
              <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-3)">
                <div style="width:40px;height:40px;border-radius:var(--radius-full);background:${color};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold);font-size:var(--text-sm);flex-shrink:0">${initials(authorName)}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-sm)">${esc(authorName)}</div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${ago} ${typeBadge}</div>
                </div>
                ${canDelete || canPin || canUnpin ? `<div class="post-actions" style="position:relative">
                  <button class="btn btn-ghost btn-sm post-menu-btn" data-post-id="${item.id}" style="padding:2px 6px;font-size:var(--text-base)">⋯</button>
                </div>` : ''}
              </div>
              <div style="font-size:var(--text-base);line-height:var(--line-height-relaxed);white-space:pre-wrap;word-break:break-word">${formatPostContent(esc(item.content))}</div>
              <div style="display:flex;gap:var(--space-3);margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--color-border-light)">
                <button class="btn btn-ghost btn-sm react-btn" data-post-id="${item.id}" data-emoji="👍" style="font-size:var(--text-sm)">${reactions['👍'] ? '👍 ' + reactions['👍'] : '👍'}</button>
                <button class="btn btn-ghost btn-sm react-btn" data-post-id="${item.id}" data-emoji="🎉" style="font-size:var(--text-sm)">${reactions['🎉'] ? '🎉 ' + reactions['🎉'] : '🎉'}</button>
                <button class="btn btn-ghost btn-sm react-btn" data-post-id="${item.id}" data-emoji="❤️" style="font-size:var(--text-sm)">${reactions['❤️'] ? '❤️ ' + reactions['❤️'] : '❤️'}</button>
              </div>
            </div>
          </div>`;
      }

      return `
        <div style="display:flex;gap:var(--space-3);padding:var(--space-2) var(--space-3);align-items:center">
          <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${color};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(authorName)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:var(--text-sm)"><span style="font-weight:var(--font-weight-medium)">${esc(authorName)}</span> <span style="color:var(--color-text-secondary)">${formatPostContent(esc(item.content))}</span></div>
            <div style="font-size:10px;color:var(--color-text-tertiary)">${ago}</div>
          </div>
          <span style="font-size:var(--text-base)">${item.icon}</span>
        </div>`;
    }).join('');
  }

  // Reaction handlers
  feedEl.querySelectorAll('.react-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const postId = btn.dataset.postId;
      const emoji = btn.dataset.emoji;
      const post = (postsResult.data || []).find(p => p.id === postId);
      if (!post) return;
      const reactions = { ...(post.reactions || {}) };
      reactions[emoji] = (reactions[emoji] || 0) + 1;
      const { error } = await sb.from('posts').update({ reactions }).eq('id', postId);
      if (error) return toast(error.message);
      post.reactions = reactions;
      btn.textContent = `${emoji} ${reactions[emoji]}`;
    });
  });

  // Post menu handlers
  feedEl.querySelectorAll('.post-menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.postId;
      const post = (postsResult.data || []).find(p => p.id === postId);
      if (!post) return;

      const f = document.createElement('div');
      const actions = [];
      if (isAdmin && !post.pinned) actions.push(`<button class="btn btn-secondary btn-sm" data-action="pin" style="width:100%">📌 Pin to top</button>`);
      if (isAdmin && post.pinned) actions.push(`<button class="btn btn-secondary btn-sm" data-action="unpin" style="width:100%">Unpin</button>`);
      if (post.author_id === user.id || isAdmin) actions.push(`<button class="btn btn-secondary btn-sm" data-action="delete" style="width:100%;color:var(--color-error)">Delete post</button>`);

      f.innerHTML = `<div style="display:grid;gap:var(--space-2)">${actions.join('')}</div>`;
      openModal('Post Options', f);

      f.querySelector('[data-action="pin"]')?.addEventListener('click', async () => {
        await sb.from('posts').update({ pinned: true }).eq('id', postId);
        closeModal();
        dashboard(container);
      });
      f.querySelector('[data-action="unpin"]')?.addEventListener('click', async () => {
        await sb.from('posts').update({ pinned: false }).eq('id', postId);
        closeModal();
        dashboard(container);
      });
      f.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        const { error } = await sb.from('posts').delete().eq('id', postId);
        if (error) return toast(error.message);
        closeModal();
        toast('Post deleted');
        dashboard(container);
      });
    });
  });
}

function formatPostContent(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
