import sb from '../../js/supabase.js';
import { esc, toast, stagePill, openModal, closeModal, getAuthToken, clientId, initials, avColor, formatDate } from '../../js/ui.js';
import { getOrg } from '../../js/auth.js';
import { logAction } from '../../js/audit.js';

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
    <div id="interviews-content"><div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
  `;

  document.getElementById('back-to-jobs').addEventListener('click', () => {
    window.location.hash = '#/recruitment';
  });

  const [{ data: jobs }, { data: candidates }, { data: apps }] = await Promise.all([
    sb.from('jobs').select('*').eq(orgCol, cid),
    sb.from('candidates').select('*').eq(orgCol, cid),
    sb.from('job_applications').select('*').in('status', ['interview_scheduled', 'interviewed', 'shortlisted', 'screened', 'new', 'offered']),
  ]);

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
        <div style="display:flex;gap:var(--space-2)">
          <button class="btn btn-secondary btn-sm" data-act="slots" data-app="${a.id}">Manage Slots</button>
          <button class="btn btn-secondary btn-sm" data-act="stage" data-app="${a.id}">Update Stage</button>
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
}
