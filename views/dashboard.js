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
      .dash-wrapper {
        position: relative;
        min-height: 100%;
      }
      .dash-wrapper > * {
        position: relative;
        z-index: 1;
      }
      .dash-banner {
        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-lg);
        margin-bottom: var(--space-4);
        font-size: var(--text-sm);
        display: flex;
        align-items: center;
        gap: var(--space-3);
        background: var(--color-accent-light);
        border: 1px solid var(--color-border);
        color: var(--color-text-primary);
      }
      .dash-banner svg { width: 22px; height: 22px; color: var(--color-accent); flex-shrink: 0; }
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

    <div class="dash-wrapper">
    <div id="dash-banner-slot"></div>
    <div id="dash-header" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);margin-bottom:var(--space-6);flex-wrap:wrap">
      <div>
        <h1 class="page-title" style="margin:0">${greeting}${firstName ? ', ' + esc(firstName) : ''}</h1>
        <p class="page-subtitle" style="margin:var(--space-1) 0 0">${today.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' })}${org ? ' · ' + esc(org.name) : ''}</p>
      </div>
      <div id="att-status" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-4);background:var(--color-bg-secondary);border-radius:var(--radius-full)">
        <div style="width:8px;height:8px;border-radius:var(--radius-full);background:var(--color-text-tertiary)"></div>
        <span class="u-sm-muted">Loading...</span>
      </div>
    </div>

    <div class="dash-two-col">
      <div>
        <div id="composer" style="margin-bottom:var(--space-4)"></div>
        <div id="feed" class="u-stack-4">
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
            <div class="u-meta">${today.getFullYear()} holiday calendar</div>
          </div>
          <div id="leaves-list" style="max-height:520px;overflow-y:auto">
            <div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text" style="width:70%"></div></div>
          </div>
        </div>
      </div>
    </div>
    </div>
  `;

  if (!org) return;

  const [attResult, postsResult, eventsResult, membersResult, leavesResult, annResult] = await Promise.all([
    sb.from('attendance').select('*').eq('user_id', user.id).eq('date', todayStr).maybeSingle(),
    sb.from('posts').select('*').eq('org_id', org.id).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(30),
    sb.from('events').select('*, actor:actor_id(full_name, email)').order('created_at', { ascending: false }).limit(15),
    sb.from('memberships').select('user_id, full_name, email, role').eq('organization_id', org.id),
    sb.from('holidays').select('*').eq('year', today.getFullYear()).order('date', { ascending: true }),
    sb.from('announcements').select('*, author:author_id(full_name)').eq('org_id', org.id).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(5),
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
      <span class="u-sm-muted">${label}</span>
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
          <div style="color:var(--color-text-tertiary);margin-bottom:var(--space-2);display:flex;justify-content:center">${ic('calendar', 28)}</div>
          <div class="u-sm-muted">No holidays configured</div>
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
        <div style="width:32px;height:32px;border-radius:var(--radius-lg);background:${isToday ? 'var(--color-success-light)' : isPast ? 'var(--color-bg-tertiary)' : 'var(--color-accent-light)'};display:flex;align-items:center;justify-content:center;color:${dotColor};flex-shrink:0">${isToday ? ic('sparkle') : h.is_optional ? ic('dot') : ic('calendar')}</div>
        <div style="min-width:0">
          <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.name)}</div>
          <div class="u-meta">${dayName}, ${dateLabel}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${h.is_optional ? '<span style="font-size:var(--text-xs);padding:2px 8px;border-radius:var(--radius-full);background:var(--color-warning-light);color:var(--color-warning)">Optional</span>' : ''}
          ${isToday ? '<span style="font-size:var(--text-xs);padding:2px 8px;border-radius:var(--radius-full);background:var(--color-success-light);color:var(--color-success)">Today</span>' : ''}
        </div>
      </div>`;
  }

  // Holiday greeting banner if today is an org holiday
  const todayHoliday = (leavesResult.data || []).find(h => h.date === todayStr);
  const bannerSlot = document.getElementById('dash-banner-slot');
  if (todayHoliday && bannerSlot) {
    const g = getHolidayGreeting(todayHoliday.name);
    bannerSlot.innerHTML = `
      <div class="dash-banner">
        ${HOLIDAY_ICON[g.icon] || HOLIDAY_ICON.sparkle}
        <div>
          <div style="font-weight:var(--font-weight-semibold)">${esc(todayHoliday.name)}</div>
          <div class="u-meta">${esc(g.message)}</div>
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
                <button class="btn btn-ghost btn-sm post-type-btn active" data-type="announcement" title="Announcement" style="font-size:var(--text-xs)">${ic('megaphone', 14)} Announce</button>
                <button class="btn btn-ghost btn-sm post-type-btn" data-type="shoutout" title="Shoutout" style="font-size:var(--text-xs)">${ic('star', 14)} Shoutout</button>
                <button class="btn btn-ghost btn-sm post-type-btn" data-type="update" title="Update" style="font-size:var(--text-xs)">${ic('edit', 14)} Update</button>
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
    let icon = 'bell';
    if (action === 'created' && entity === 'employee') {
      content = `welcomed a new team member${payload.name ? ': **' + payload.name + '**' : ''}`;
      icon = 'userplus';
    } else if (action === 'approved' && entity === 'request') {
      content = `approved a leave request`;
      icon = 'check';
    } else if (action === 'created' && entity === 'job') {
      content = `posted a new job opening${payload.title ? ': **' + payload.title + '**' : ''}`;
      icon = 'briefcase';
    } else if (action === 'shortlisted') {
      content = `shortlisted a candidate`;
      icon = 'star';
    } else if (action === 'completed' && entity === 'checkin') {
      content = `checked in for the day`;
      icon = 'pin';
    } else if (action === 'feedback_submitted') {
      content = `submitted interview feedback`;
      icon = 'edit';
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

  for (const ann of (annResult.data || [])) {
    feedItems.push({
      id: ann.id,
      type: 'announcement',
      pinned: ann.pinned,
      author: ann.author?.full_name || 'Admin',
      authorId: ann.author_id,
      title: ann.title,
      content: ann.body,
      time: ann.created_at,
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
        <div style="color:var(--color-text-tertiary);margin-bottom:var(--space-3);display:flex;justify-content:center">${ic('inbox', 28)}</div>
        <div style="font-weight:var(--font-weight-semibold);margin-bottom:var(--space-1)">Your noticeboard is empty</div>
        <div class="u-sm-muted">${isManager ? 'Post an announcement to get things started.' : 'Updates and announcements from your organization will appear here.'}</div>
      </div>`;
  } else {
    feedEl.innerHTML = feedItems.map(item => {
      const authorName = item.author;
      const color = avColor(authorName);
      const ago = timeAgo(item.time);

      if (item.type === 'post') {
        const typeLabel = { announcement: ic('megaphone', 12), shoutout: ic('star', 12), update: ic('edit', 12), milestone: ic('award', 12) };
        const typeBadge = typeLabel[item.postType] || '';
        const reactions = item.reactions;
        const canPin = isAdmin && !item.pinned;
        const canUnpin = isAdmin && item.pinned;
        const canDelete = item.authorId === user.id || isAdmin;

        return `
          <div class="card" style="padding:0;overflow:hidden${item.pinned ? ';border-left:3px solid var(--color-accent)' : ''}">
            ${item.pinned ? `<div style="padding:var(--space-1) var(--space-4);background:var(--color-accent-light);font-size:var(--text-xs);color:var(--color-accent);font-weight:var(--font-weight-medium);display:flex;align-items:center;gap:var(--space-1)">${ic('bookmark', 12)} Pinned</div>` : ''}
            <div style="padding:var(--space-4)">
              <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-3)">
                <div style="width:40px;height:40px;border-radius:var(--radius-full);background:${color};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold);font-size:var(--text-sm);flex-shrink:0">${initials(authorName)}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-sm)">${esc(authorName)}</div>
                  <div class="u-meta">${ago} ${typeBadge}</div>
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

      if (item.type === 'announcement') {
        return `
          <div class="card" style="padding:0;overflow:hidden;border-left:3px solid var(--color-warning)">
            <div style="padding:var(--space-1) var(--space-4);background:var(--color-warning-light);font-size:var(--text-xs);color:var(--color-warning);font-weight:var(--font-weight-medium);display:flex;align-items:center;gap:var(--space-1)">${ic('megaphone', 12)} Announcement${item.pinned ? ' · Pinned' : ''}</div>
            <div style="padding:var(--space-4)">
              <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-2)">
                <div style="width:36px;height:36px;border-radius:var(--radius-full);background:${color};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold);font-size:var(--text-xs);flex-shrink:0">${initials(authorName)}</div>
                <div>
                  <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-sm)">${esc(authorName)}</div>
                  <div class="u-meta">${ago}</div>
                </div>
              </div>
              ${item.title ? `<h4 style="margin:0 0 var(--space-1);font-size:var(--text-md);font-weight:var(--font-weight-semibold)">${esc(item.title)}</h4>` : ''}
              <p style="margin:0;font-size:var(--text-sm);color:var(--color-text-secondary);white-space:pre-wrap;max-height:120px;overflow:hidden">${esc(item.content)}</p>
              <a href="#/announcements" style="font-size:var(--text-xs);color:var(--color-accent);text-decoration:none;margin-top:var(--space-2);display:inline-block">View all announcements &rarr;</a>
            </div>
          </div>`;
      }

      return `
        <div style="display:flex;gap:var(--space-3);padding:var(--space-2) var(--space-3);align-items:center">
          <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${color};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(authorName)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:var(--text-sm)"><span style="font-weight:var(--font-weight-medium)">${esc(authorName)}</span> <span class="u-muted">${formatPostContent(esc(item.content))}</span></div>
            <div style="font-size:10px;color:var(--color-text-tertiary)">${ago}</div>
          </div>
          <span style="color:var(--color-text-tertiary);display:flex">${ic(item.icon)}</span>
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
      if (isAdmin && !post.pinned) actions.push(`<button class="btn btn-secondary btn-sm" data-action="pin" style="width:100%">${ic('bookmark', 14)} Pin to top</button>`);
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

// Holiday greeting: a single tokenized banner (SVG icon + name + message).
// No emoji, no particles, no hardcoded colors — inherits the module accent.
const _svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const HOLIDAY_ICON = {
  sparkle: _svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),
  gift: _svg('<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>'),
  moon: _svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  sun: _svg('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>'),
  leaf: _svg('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>'),
  flag: _svg('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'),
  star: _svg('<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/>'),
  calendar: _svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
};

// Inline-SVG glyphs for dashboard UI icons (no emoji). Colored via currentColor.
const ICON = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  megaphone: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  star: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
};
const ic = (name, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:middle">${ICON[name] || ICON.bell}</svg>`;

function getHolidayGreeting(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('diwali') || n.includes('deepavali')) return { message: 'Festival of Lights', icon: 'sparkle' };
  if (n.includes('holi')) return { message: 'Festival of Colours', icon: 'sparkle' };
  if (n.includes('eid')) return { message: 'Eid Mubarak', icon: 'moon' };
  if (n.includes('christmas') || n.includes('xmas')) return { message: 'Merry Christmas', icon: 'gift' };
  if (n.includes('ganesh') || n.includes('vinayak')) return { message: 'Ganpati Bappa Morya', icon: 'sparkle' };
  if (n.includes('pongal') || n.includes('makar') || n.includes('sankranti') || n.includes('lohri')) return { message: 'Happy Harvest', icon: 'sun' };
  if (n.includes('navratri') || n.includes('durga') || n.includes('dasara') || n.includes('dussehra')) return { message: 'Happy Navratri', icon: 'sparkle' };
  if (n.includes('onam')) return { message: 'Happy Onam', icon: 'leaf' };
  if (n.includes('raksha') || n.includes('rakhi')) return { message: 'Happy Raksha Bandhan', icon: 'star' };
  if (n.includes('republic') || n.includes('independence')) return { message: 'Jai Hind', icon: 'flag' };
  if (n.includes('new year')) return { message: 'Happy New Year', icon: 'sparkle' };
  if (n.includes('women')) return { message: "Happy Women's Day", icon: 'star' };
  if (n.includes('labour') || n.includes('labor')) return { message: 'Happy Labour Day', icon: 'star' };
  if (n.includes('gandhi')) return { message: 'Gandhi Jayanti', icon: 'star' };
  if (n.includes('halloween')) return { message: 'Happy Halloween', icon: 'star' };
  return { message: 'Enjoy your holiday', icon: 'calendar' };
}
