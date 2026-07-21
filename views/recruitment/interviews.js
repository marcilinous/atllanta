import sb from '../../js/supabase.js';
import { esc, toast, stagePill, openModal, closeModal, getAuthToken, clientId, initials, avColor, formatDate } from '../../js/ui.js';
import { getOrg, getUser } from '../../js/auth.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

export default async function interviewsView(container) {
  const org = getOrg();
  const cid = org?.id || await clientId();
  if (!cid) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No organization found</div></div>';
    return;
  }
  const orgCol = org ? 'org_id' : 'client_id';

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <h1 class="page-title">Interviews</h1>
        <p class="page-subtitle">Scheduled interviews and slot management</p>
      </div>
      <button class="btn btn-secondary" id="back-to-jobs">Back to Jobs</button>
    </div>
    <div class="tabs" style="margin-bottom:var(--space-4)">
      <button class="tab active" data-tab="list">List</button>
      <button class="tab" data-tab="timeline">Timeline</button>
    </div>
    <div id="interviews-content"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
    <div id="interviews-timeline" style="display:none"></div>
  `;

  document.getElementById('back-to-jobs').addEventListener('click', () => {
    window.location.hash = '#/recruitment';
  });

  container.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const show = tab.dataset.tab;
      document.getElementById('interviews-content').style.display = show === 'list' ? '' : 'none';
      document.getElementById('interviews-timeline').style.display = show === 'timeline' ? '' : 'none';
    });
  });

  const [{ data: jobs, error: jobsErr }, { data: candidates, error: candsErr }, { data: apps, error: appsErr }] = await Promise.all([
    sb.from('jobs').select('*').eq(orgCol, cid),
    sb.from('candidates').select('*').eq(orgCol, cid),
    sb.from('job_applications').select('*').in('status', ['interview_scheduled', 'interviewed', 'shortlisted', 'screened', 'new', 'offered']),
  ]);
  if (jobsErr) toast('Failed to load jobs: ' + jobsErr.message);
  if (candsErr) toast('Failed to load candidates: ' + candsErr.message);
  if (appsErr) toast('Failed to load applications: ' + appsErr.message);

  const allJobs = jobs || [];
  const allCands = candidates || [];
  const allApps = (apps || []).filter(a => allJobs.some(j => j.id === a.job_id));

  const interviewApps = allApps.filter(a => ['interview_scheduled', 'interviewed'].includes(a.status));
  const schedulable = allApps.filter(a => !['rejected', 'hired', 'interviewed'].includes(a.status) && !a.interview_at);

  const content = document.getElementById('interviews-content');

  // Schedulable candidates section
  if (schedulable.length) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:var(--space-6)';
    section.innerHTML = `
      <h3 style="font-size:var(--text-base);font-weight:var(--font-weight-semibold);margin-bottom:var(--space-3)">Ready to schedule</h3>
      <div style="display:flex;flex-wrap:wrap;gap:var(--space-2)">
        ${schedulable.map(a => {
          const c = allCands.find(x => x.id === a.candidate_id);
          const j = allJobs.find(x => x.id === a.job_id);
          return `<button class="btn btn-secondary btn-sm" data-act="manage-slots" data-app="${a.id}">${esc(c?.full_name || 'Unknown')} · ${esc(j?.title || '')}</button>`;
        }).join('')}
      </div>`;
    content.appendChild(section);

    section.querySelectorAll('[data-act=manage-slots]').forEach(btn => {
      btn.addEventListener('click', () => showSlotManager(btn.dataset.app));
    });
  }

  // Scheduled interviews
  if (!interviewApps.length) {
    content.innerHTML += `
      <div class="card" style="padding:var(--space-6);text-align:center">
        <div style="color:var(--color-text-secondary)">No interviews scheduled yet.</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-tertiary);margin-top:var(--space-2)">Assign slots to a candidate above, then send a scheduling link.</div>
      </div>`;
    return;
  }

  const list = document.createElement('div');
  list.style.cssText = 'display:grid;gap:var(--space-3)';
  interviewApps.forEach(a => {
    const c = allCands.find(x => x.id === a.candidate_id);
    const j = allJobs.find(x => x.id === a.job_id);
    const d = a.interview_at ? new Date(a.interview_at) : new Date(a.updated_at);

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:var(--space-4)';
    card.innerHTML = `
      <div style="display:flex;gap:var(--space-4);align-items:center">
        <div style="text-align:center;min-width:48px">
          <div style="font-size:var(--text-xl);font-weight:var(--font-weight-bold)">${d.getDate()}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${d.toLocaleString('en', { month: 'short' })}</div>
        </div>
        <div style="flex:1">
          <div style="font-weight:var(--font-weight-semibold)">${esc(c?.full_name || 'Unknown')}</div>
          <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(j?.title || '')} · ${a.status.replaceAll('_', ' ')}</div>
          <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${a.interview_at ? '' : ' (manual)'}</div>
          ${a.meet_link ? `<a href="${esc(a.meet_link)}" target="_blank" rel="noopener" style="font-size:var(--text-sm);color:var(--color-accent)">Google Meet</a>` : ''}
        </div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" data-act="slots" data-app="${a.id}">Manage Slots</button>
          <button class="btn btn-primary btn-sm" data-act="feedback" data-app="${a.id}">Feedback</button>
          <button class="btn btn-secondary btn-sm" data-act="stage" data-app="${a.id}">Stage</button>
          ${c?.phone ? `<a class="btn btn-secondary btn-sm" href="https://wa.me/${(c.phone || '').replace(/[^\d]/g, '')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        </div>
      </div>`;
    list.appendChild(card);
  });
  content.appendChild(list);

  content.querySelectorAll('[data-act=slots]').forEach(btn => {
    btn.addEventListener('click', () => showSlotManager(btn.dataset.app));
  });
  content.querySelectorAll('[data-act=stage]').forEach(btn => {
    btn.addEventListener('click', () => {
      const stages = ['new', 'screened', 'shortlisted', 'interview_scheduled', 'interviewed', 'offered', 'hired', 'rejected'];
      const app = allApps.find(a => a.id === btn.dataset.app);
      const f = document.createElement('div');
      f.innerHTML = `
        <div style="display:grid;gap:var(--space-3)">
          <select class="form-input" id="int-stage">${stages.map(s => `<option value="${s}" ${s === app?.status ? 'selected' : ''}>${s.replaceAll('_', ' ')}</option>`).join('')}</select>
          <button class="btn btn-primary" id="int-stage-save">Update</button>
        </div>`;
      openModal('Update Stage', f);
      f.querySelector('#int-stage-save').addEventListener('click', async () => {
        const newStatus = f.querySelector('#int-stage').value;
        const { error } = await sb.from('job_applications').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', btn.dataset.app);
        if (error) { toast('Failed: ' + error.message); return; }
        await logAction('recruitment', 'job_application', btn.dataset.app, 'stage_updated', { status: app?.status }, { status: newStatus });
        closeModal();
        toast('Stage updated');
        interviewsView(container);
      });
    });
  });

  content.querySelectorAll('[data-act=feedback]').forEach(btn => {
    btn.addEventListener('click', () => {
      const app = allApps.find(a => a.id === btn.dataset.app);
      const cand = allCands.find(c => c.id === app?.candidate_id);
      const job = allJobs.find(j => j.id === app?.job_id);
      const user = getUser();
      const f = document.createElement('div');
      f.innerHTML = `
        <div style="display:grid;gap:var(--space-3)">
          <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(cand?.full_name || '—')} for ${esc(job?.title || '—')}</div>
          <div class="form-group">
            <label class="form-label">Rating</label>
            <div style="display:flex;gap:var(--space-2)" id="fb-stars">
              ${[1,2,3,4,5].map(n => `<button type="button" class="btn btn-ghost btn-sm" data-star="${n}" style="font-size:var(--text-lg);padding:var(--space-1)">${n <= 0 ? '☆' : '☆'}</button>`).join('')}
            </div>
            <input type="hidden" id="fb-rating" value="">
          </div>
          <div class="form-group"><label class="form-label">Decision</label>
            <select class="form-input" id="fb-decision">
              <option value="">Select...</option>
              <option value="advance">Advance to next round</option>
              <option value="hire">Hire</option>
              <option value="hold">Hold</option>
              <option value="reject">Reject</option>
            </select>
          </div>
          <div class="form-group"><label class="form-label">Feedback</label><textarea class="form-input" id="fb-text" rows="4" placeholder="Interview notes, strengths, areas of concern..."></textarea></div>
          <button class="btn btn-primary" id="fb-save">Submit Feedback</button>
        </div>`;
      openModal('Interview Feedback', f);

      let selectedRating = 0;
      f.querySelectorAll('[data-star]').forEach(star => {
        star.addEventListener('click', () => {
          selectedRating = parseInt(star.dataset.star);
          f.querySelector('#fb-rating').value = selectedRating;
          f.querySelectorAll('[data-star]').forEach(s => {
            s.textContent = parseInt(s.dataset.star) <= selectedRating ? '★' : '☆';
            s.style.color = parseInt(s.dataset.star) <= selectedRating ? 'var(--color-warning)' : '';
          });
        });
      });

      f.querySelector('#fb-save').addEventListener('click', async () => {
        const rating = selectedRating;
        const decision = f.querySelector('#fb-decision').value;
        const feedback = f.querySelector('#fb-text').value.trim();
        if (!rating) return toast('Please select a rating');
        if (!decision) return toast('Please select a decision');

        const interviewData = {
          org_id: org?.id || cid,
          job_application_id: app.id,
          round_number: 1,
          interviewer_id: user?.id,
          scheduled_at: app.interview_at || app.updated_at,
          status: 'completed',
          rating,
          feedback: feedback || null,
          decision,
        };
        const { error: intErr } = await sb.from('interviews').insert(interviewData);
        if (intErr) return toast('Failed: ' + intErr.message);

        const newAppStatus = decision === 'hire' ? 'offered' : decision === 'reject' ? 'rejected' : 'interviewed';
        const { error: appErr } = await sb.from('job_applications').update({ status: newAppStatus, updated_at: new Date().toISOString() }).eq('id', app.id);
        if (appErr) toast('Failed to update stage: ' + appErr.message);

        await logAction('recruitment', 'interview', app.id, 'feedback_submitted', { status: app.status }, { status: newAppStatus, rating, decision });
        closeModal();
        toast('Feedback submitted');
        interviewsView(container);
      });
    });
  });

  // ── Slot Manager ──
  async function showSlotManager(appId) {
    const app = allApps.find(a => a.id === appId);
    if (!app) return;
    const cand = allCands.find(c => c.id === app.candidate_id);
    const job = allJobs.find(j => j.id === app.job_id);

    const { data: slots } = await sb.from('interview_slots')
      .select('*')
      .eq('application_id', appId)
      .order('slot_start');

    const allSlots = slots || [];

    const f = document.createElement('div');
    f.innerHTML = `
      <div style="display:grid;gap:var(--space-4)">
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(cand?.full_name)} for ${esc(job?.title)}</div>
        <div style="display:flex;gap:var(--space-2);align-items:flex-end">
          <div class="form-group" style="flex:1"><label class="form-label">Date</label><input type="date" class="form-input" id="sl-date" min="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="form-group"><label class="form-label">Start</label><input type="time" class="form-input" id="sl-start" value="10:00"></div>
          <div class="form-group"><label class="form-label">End</label><input type="time" class="form-input" id="sl-end" value="10:30"></div>
          <button class="btn btn-primary btn-sm" id="sl-add" style="margin-bottom:4px">Add</button>
        </div>
        <div style="display:flex;gap:var(--space-2)">
          <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">Quick add:</span>
          <button class="btn btn-secondary btn-sm" data-quick="30">+30 min slots</button>
          <button class="btn btn-secondary btn-sm" data-quick="60">+1 hr slots</button>
        </div>
        <div id="slot-list"></div>
      </div>`;
    openModal('Manage Interview Slots', f);

    function renderSlots() {
      const now = new Date();
      const future = allSlots.filter(s => new Date(s.slot_end) > now);
      const past = allSlots.filter(s => new Date(s.slot_end) <= now);
      const listEl = f.querySelector('#slot-list');

      listEl.innerHTML = !future.length
        ? '<div style="padding:var(--space-4);text-align:center;color:var(--color-text-tertiary)">No upcoming slots</div>'
        : future.map(s => {
          const st = new Date(s.slot_start);
          const en = new Date(s.slot_end);
          const booked = !!s.booked_by;
          return `<div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)${booked ? ';opacity:0.7' : ''}">
            <span style="font-size:var(--text-sm);min-width:80px">${st.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            <span style="font-size:var(--text-sm)">${st.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${en.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span class="badge badge-${booked ? 'warning' : 'success'}" style="margin-left:auto"><span class="badge-dot"></span>${booked ? 'booked' : 'open'}</span>
            ${!booked ? `<button class="btn btn-ghost btn-sm" data-del="${s.id}" style="padding:2px">&times;</button>` : ''}
          </div>`;
        }).join('');

      if (past.length) {
        listEl.innerHTML += `<details style="margin-top:var(--space-3)"><summary style="font-size:var(--text-sm);cursor:pointer;color:var(--color-text-secondary)">${past.length} past slot${past.length !== 1 ? 's' : ''}</summary>
          ${past.map(s => {
            const st = new Date(s.slot_start);
            const en = new Date(s.slot_end);
            return `<div style="display:flex;gap:var(--space-3);padding:var(--space-1) 0;font-size:var(--text-xs);color:var(--color-text-tertiary)">
              <span>${st.toLocaleDateString('en', { day: 'numeric', month: 'short' })}</span>
              <span>${st.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${en.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span>${s.booked_by ? 'booked' : 'expired'}</span>
            </div>`;
          }).join('')}</details>`;
      }

      listEl.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const { error } = await sb.from('interview_slots').delete().eq('id', btn.dataset.del);
          if (error) { toast('Failed: ' + error.message); return; }
          const idx = allSlots.findIndex(s => s.id === btn.dataset.del);
          if (idx !== -1) allSlots.splice(idx, 1);
          renderSlots();
          toast('Slot removed');
        });
      });
    }

    renderSlots();

    f.querySelector('#sl-add').addEventListener('click', async () => {
      const date = f.querySelector('#sl-date').value;
      const start = f.querySelector('#sl-start').value;
      const end = f.querySelector('#sl-end').value;
      if (!date || !start || !end) return toast('Fill date, start, and end time');
      if (start >= end) return toast('End must be after start');
      const { data: membership } = await sb.from('memberships').select('organization_id').limit(1).single();
      const { data, error } = await sb.from('interview_slots').insert({
        organization_id: membership?.organization_id,
        job_id: app.job_id,
        application_id: appId,
        slot_start: new Date(`${date}T${start}:00`).toISOString(),
        slot_end: new Date(`${date}T${end}:00`).toISOString(),
        created_by: (await sb.auth.getUser()).data.user.id,
      }).select().single();
      if (error) return toast(error.message);
      allSlots.push(data);
      allSlots.sort((a, b) => a.slot_start.localeCompare(b.slot_start));
      renderSlots();
      toast('Slot added');
    });

    f.querySelectorAll('[data-quick]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const date = f.querySelector('#sl-date').value;
        if (!date) return toast('Pick a date first');
        const mins = +btn.dataset.quick;
        const { data: membership } = await sb.from('memberships').select('organization_id').limit(1).single();
        const userId = (await sb.auth.getUser()).data.user.id;
        const newSlots = [];
        for (let h = 9; h < 18;) {
          const m = h * 60;
          const mEnd = m + mins;
          if (mEnd / 60 > 18) break;
          const sh = String(Math.floor(m / 60)).padStart(2, '0');
          const sm = String(m % 60).padStart(2, '0');
          const eh = String(Math.floor(mEnd / 60)).padStart(2, '0');
          const em = String(mEnd % 60).padStart(2, '0');
          const slot_start = new Date(`${date}T${sh}:${sm}:00`).toISOString();
          const slot_end = new Date(`${date}T${eh}:${em}:00`).toISOString();
          if (!allSlots.some(s => s.slot_start === slot_start && s.slot_end === slot_end)) {
            newSlots.push({
              organization_id: membership?.organization_id,
              job_id: app.job_id,
              application_id: appId,
              slot_start,
              slot_end,
              created_by: userId,
            });
          }
          h = mEnd / 60;
        }
        if (!newSlots.length) return toast('All slots already exist');
        const { data, error } = await sb.from('interview_slots').insert(newSlots).select();
        if (error) return toast(error.message);
        allSlots.push(...data);
        allSlots.sort((a, b) => a.slot_start.localeCompare(b.slot_start));
        renderSlots();
        toast(`${data.length} slots added`);
      });
    });
  }

  // ── Timeline View ──
  function renderTimeline() {
    const timelineEl = document.getElementById('interviews-timeline');
    const scheduled = allApps.filter(a => a.interview_at || ['interview_scheduled', 'interviewed'].includes(a.status));

    let weekOffset = 0;
    function getWeekDates() {
      const today = new Date();
      const start = new Date(today);
      start.setDate(start.getDate() - start.getDay() + 1 + weekOffset * 7);
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        days.push(d);
      }
      return days;
    }

    function draw() {
      const days = getWeekDates();
      const weekLabel = `${days[0].toLocaleDateString('en', { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      const hours = [];
      for (let h = 9; h <= 18; h++) hours.push(h);

      const dayInterviews = days.map(day => {
        const ds = day.toISOString().split('T')[0];
        return scheduled.filter(a => {
          const at = a.interview_at || a.updated_at;
          return at && at.startsWith(ds);
        }).map(a => {
          const dt = new Date(a.interview_at || a.updated_at);
          const c = allCands.find(x => x.id === a.candidate_id);
          const j = allJobs.find(x => x.id === a.job_id);
          return { dt, name: c?.full_name || 'Unknown', job: j?.title || '', status: a.status, hour: dt.getHours(), minute: dt.getMinutes() };
        });
      });

      const todayStr = new Date().toISOString().split('T')[0];

      timelineEl.innerHTML = `
        <div class="card">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <button class="btn btn-secondary btn-sm" id="tl-prev">&larr;</button>
              <span style="font-weight:var(--font-weight-semibold);min-width:200px;text-align:center">${weekLabel}</span>
              <button class="btn btn-secondary btn-sm" id="tl-next">&rarr;</button>
              <button class="btn btn-secondary btn-sm" id="tl-this-week" style="margin-left:var(--space-2)">This Week</button>
            </div>
            <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">
              ${scheduled.length} interview${scheduled.length !== 1 ? 's' : ''} total
            </div>
          </div>
          <div class="card-body" style="overflow-x:auto;padding:0">
            <div style="display:grid;grid-template-columns:60px repeat(7, 1fr);min-width:700px">
              <div style="border-bottom:2px solid var(--color-border);padding:8px 4px"></div>
              ${days.map((d, i) => {
                const isToday = d.toISOString().split('T')[0] === todayStr;
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return `<div style="border-bottom:2px solid var(--color-border);padding:8px;text-align:center;${isToday ? 'background:var(--color-accent-light);' : ''}${isWeekend ? 'color:var(--color-text-tertiary);' : ''}">
                  <div style="font-size:var(--text-xs)">${d.toLocaleString('en', { weekday: 'short' })}</div>
                  <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-md)">${d.getDate()}</div>
                  <div style="font-size:10px;color:var(--color-text-tertiary)">${dayInterviews[i].length > 0 ? dayInterviews[i].length + ' int.' : ''}</div>
                </div>`;
              }).join('')}
              ${hours.map(h => `
                <div style="padding:4px 8px;font-size:10px;color:var(--color-text-tertiary);text-align:right;border-top:1px solid var(--color-border-light);height:48px;display:flex;align-items:flex-start;justify-content:flex-end">${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}</div>
                ${days.map((d, di) => {
                  const isToday = d.toISOString().split('T')[0] === todayStr;
                  const ints = dayInterviews[di].filter(iv => iv.hour === h);
                  return `<div style="border-top:1px solid var(--color-border-light);${isToday ? 'background:var(--color-accent-light);' : ''}padding:2px;position:relative;min-height:48px">
                    ${ints.map(iv => {
                      const top = (iv.minute / 60) * 100;
                      const statusColor = iv.status === 'interviewed' ? 'var(--color-success)' : iv.status === 'interview_scheduled' ? 'var(--color-accent)' : 'var(--color-warning)';
                      return `<div style="position:absolute;top:${top}%;left:2px;right:2px;background:var(--color-surface);border:1px solid ${statusColor};border-left:3px solid ${statusColor};border-radius:var(--radius-sm);padding:2px 4px;font-size:9px;z-index:1;cursor:default" title="${esc(iv.name)} — ${esc(iv.job)}">
                        <div style="font-weight:var(--font-weight-medium);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(iv.name)}</div>
                        <div style="color:var(--color-text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(iv.job)}</div>
                      </div>`;
                    }).join('')}
                  </div>`;
                }).join('')}
              `).join('')}
            </div>
          </div>
        </div>`;

      timelineEl.querySelector('#tl-prev').addEventListener('click', () => { weekOffset--; draw(); });
      timelineEl.querySelector('#tl-next').addEventListener('click', () => { weekOffset++; draw(); });
      timelineEl.querySelector('#tl-this-week').addEventListener('click', () => { weekOffset = 0; draw(); });
    }

    draw();
  }

  renderTimeline();
}
