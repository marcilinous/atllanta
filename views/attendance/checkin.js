import sb from '../../js/supabase.js';
import { getUser, getOrg } from '../../js/auth.js';
import { esc, toast } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';
import { logAction } from '../../js/audit.js';

export default async function checkinView(container) {
  const user = getUser();
  const org = getOrg();
  const today = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Check In / Out</h1>
      <p class="page-subtitle">${new Date().toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
    <div class="dash-grid" style="margin-top:0">
      <div class="card">
        <div class="card-body" style="text-align:center;padding:var(--space-8)">
          <div id="clock" style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);margin-bottom:var(--space-4)"></div>
          <div id="checkin-status" style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-6)">Loading...</div>
          <button class="btn btn-primary btn-lg" id="action-btn" disabled style="min-width:180px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span id="action-text">Loading...</span>
          </button>
          <div id="location-info" style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-3)"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Today's Log</span></div>
        <div class="card-body" id="today-log">
          <div style="padding:var(--space-4);text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm)">Loading...</div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:var(--space-6)">
      <div class="card-header"><span class="card-title">This Week</span></div>
      <div id="week-summary"></div>
    </div>
  `;

  if (!org || !user) return;

  function updateClock() {
    const el = document.getElementById('clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  updateClock();
  setInterval(updateClock, 1000);

  let currentLat = null, currentLng = null;
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
      const locEl = document.getElementById('location-info');
      if (locEl) locEl.textContent = `Location: ${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}`;
    }, () => {});
  }

  const { data: myAtt, error: myAttErr } = await sb.from('attendance')
    .select('*').eq('user_id', user.id).eq('date', today).maybeSingle();
  if (myAttErr) toast('Failed to load attendance: ' + myAttErr.message);

  const statusEl = document.getElementById('checkin-status');
  const actionBtn = document.getElementById('action-btn');
  const actionText = document.getElementById('action-text');
  const logEl = document.getElementById('today-log');

  function renderLog() {
    if (!myAtt) {
      logEl.innerHTML = `<div style="padding:var(--space-4);text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm)">No activity today</div>`;
      return;
    }
    logEl.innerHTML = `
      <div style="display:grid;gap:var(--space-3)">
        <div style="display:flex;justify-content:space-between;padding:var(--space-2) 0">
          <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">Check In</span>
          <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${myAtt.check_in ? new Date(myAtt.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:var(--space-2) 0">
          <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">Check Out</span>
          <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${myAtt.check_out ? new Date(myAtt.check_out).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:var(--space-2) 0">
          <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">Total Hours</span>
          <span style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${myAtt.total_hours ? Number(myAtt.total_hours).toFixed(1) + 'h' : '—'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:var(--space-2) 0">
          <span style="font-size:var(--text-sm);color:var(--color-text-secondary)">Status</span>
          <span class="badge badge-${myAtt.status === 'present' ? 'success' : myAtt.status === 'late' ? 'warning' : 'neutral'}"><span class="badge-dot"></span>${esc(myAtt.status)}</span>
        </div>
      </div>`;
  }

  if (!myAtt) {
    statusEl.textContent = 'You have not checked in yet today';
    actionText.textContent = 'Check In';
    actionBtn.disabled = false;
    actionBtn.onclick = async () => {
      actionBtn.disabled = true;
      const now = new Date().toISOString();
      const { error } = await sb.from('attendance').insert({
        org_id: org.id, user_id: user.id, date: today, check_in: now, status: 'present',
        check_in_lat: currentLat, check_in_lng: currentLng,
      });
      if (error) { toast('Check-in failed: ' + error.message); actionBtn.disabled = false; return; }
      await logAction('attendance', 'attendance', null, 'check_in', null, { date: today, check_in: now });
      await publishEvent('attendance.checkin.completed', { user_id: user.id, org_id: org.id, check_in_time: now });
      toast('Checked in successfully!');
      checkinView(container);
    };
  } else if (myAtt.check_in && !myAtt.check_out) {
    statusEl.textContent = `Checked in at ${new Date(myAtt.check_in).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}`;
    actionText.textContent = 'Check Out';
    actionBtn.disabled = false;
    actionBtn.classList.remove('btn-primary');
    actionBtn.classList.add('btn-secondary');
    actionBtn.onclick = async () => {
      actionBtn.disabled = true;
      const now = new Date();
      const totalHours = ((now - new Date(myAtt.check_in)) / 3600000).toFixed(2);
      const { error } = await sb.from('attendance').update({
        check_out: now.toISOString(), total_hours: parseFloat(totalHours),
        check_out_lat: currentLat, check_out_lng: currentLng,
      }).eq('id', myAtt.id);
      if (error) { toast('Check-out failed: ' + error.message); actionBtn.disabled = false; return; }
      await logAction('attendance', 'attendance', myAtt.id, 'check_out', null, { check_out: now.toISOString(), total_hours: totalHours });
      toast('Checked out successfully!');
      checkinView(container);
    };
  } else {
    const hours = myAtt.total_hours ? Number(myAtt.total_hours).toFixed(1) : '—';
    statusEl.textContent = `Day complete — ${hours} hours logged`;
    actionText.textContent = 'Done';
    actionBtn.disabled = true;
  }

  renderLog();

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const { data: weekData, error: weekErr } = await sb.from('attendance')
    .select('*').eq('user_id', user.id).gte('date', weekStartStr).order('date');
  if (weekErr) toast('Failed to load week summary: ' + weekErr.message);

  const weekEl = document.getElementById('week-summary');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (weekData?.length) {
    weekEl.innerHTML = `<div style="display:flex;gap:var(--space-4);padding:var(--space-4);overflow-x:auto">
      ${days.map((day, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const att = weekData.find(a => a.date === dateStr);
        const color = att ? (att.status === 'present' ? 'var(--color-success)' : att.status === 'late' ? 'var(--color-warning)' : att.status === 'absent' ? 'var(--color-error)' : 'var(--color-text-tertiary)') : 'var(--color-border)';
        return `<div style="text-align:center;flex:1;min-width:60px">
          <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-bottom:var(--space-2)">${day}</div>
          <div style="width:40px;height:40px;border-radius:var(--radius-full);background:${color};opacity:${att ? 1 : 0.3};margin:0 auto;display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold)">${d.getDate()}</div>
          <div style="font-size:10px;color:var(--color-text-tertiary);margin-top:var(--space-1)">${att?.total_hours ? Number(att.total_hours).toFixed(1) + 'h' : ''}</div>
        </div>`;
      }).join('')}
    </div>`;
  } else {
    weekEl.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-text-tertiary);font-size:var(--text-sm)">No data this week</div>`;
  }
}
