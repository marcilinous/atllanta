import sb from '../../js/supabase.js';
import { getUser, getOrg } from '../../js/auth.js';

export default async function attendanceDashboard(container) {
  const user = getUser();
  const org = getOrg();
  const today = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Attendance</h1>
      <p class="page-subtitle">Track your team's daily attendance</p>
    </div>
    <div class="card" style="margin-bottom:var(--space-6)">
      <div class="card-body" style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Today, ${new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
          <div id="checkin-status" style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold);margin-top:var(--space-1)">Checking status...</div>
        </div>
        <button class="btn btn-primary btn-lg" id="checkin-btn" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span id="checkin-btn-text">Loading...</span>
        </button>
      </div>
    </div>
    <div class="stat-grid" id="att-stats">
      <div class="stat-card"><div class="stat-label">Present</div><div class="stat-value" id="att-present">—</div></div>
      <div class="stat-card"><div class="stat-label">Absent</div><div class="stat-value" id="att-absent">—</div></div>
      <div class="stat-card"><div class="stat-label">Late</div><div class="stat-value" id="att-late">—</div></div>
      <div class="stat-card"><div class="stat-label">On Leave</div><div class="stat-value" id="att-leave">—</div></div>
    </div>
  `;

  if (!org || !user) return;

  const { data: myAtt } = await sb.from('attendance')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .maybeSingle();

  const statusEl = document.getElementById('checkin-status');
  const btn = document.getElementById('checkin-btn');
  const btnText = document.getElementById('checkin-btn-text');

  if (!myAtt) {
    statusEl.textContent = 'Not checked in';
    btnText.textContent = 'Check In';
    btn.disabled = false;
    btn.onclick = () => handleCheckIn(user.id, org.id, today);
  } else if (myAtt.check_in && !myAtt.check_out) {
    statusEl.textContent = `Checked in at ${new Date(myAtt.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    btnText.textContent = 'Check Out';
    btn.disabled = false;
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
    btn.onclick = () => handleCheckOut(myAtt.id);
  } else {
    const hours = myAtt.total_hours ? myAtt.total_hours.toFixed(1) : '—';
    statusEl.textContent = `Done for the day (${hours} hours)`;
    btnText.textContent = 'Completed';
    btn.disabled = true;
  }

  const { data: allAtt } = await sb.from('attendance').select('status').eq('date', today);
  if (allAtt) {
    document.getElementById('att-present').textContent = allAtt.filter(a => a.status === 'present').length;
    document.getElementById('att-absent').textContent = allAtt.filter(a => a.status === 'absent').length;
    document.getElementById('att-late').textContent = allAtt.filter(a => a.status === 'late').length;
    document.getElementById('att-leave').textContent = allAtt.filter(a => a.status === 'on_leave').length;
  }
}

async function handleCheckIn(userId, orgId, date) {
  const btn = document.getElementById('checkin-btn');
  btn.disabled = true;
  const now = new Date().toISOString();
  const { error } = await sb.from('attendance').insert({
    org_id: orgId,
    user_id: userId,
    date,
    check_in: now,
    status: 'present'
  });
  if (error) {
    btn.disabled = false;
    alert('Check-in failed: ' + error.message);
    return;
  }
  location.reload();
}

async function handleCheckOut(attId) {
  const btn = document.getElementById('checkin-btn');
  btn.disabled = true;
  const now = new Date().toISOString();
  const { error } = await sb.from('attendance').update({ check_out: now }).eq('id', attId);
  if (error) {
    btn.disabled = false;
    alert('Check-out failed: ' + error.message);
    return;
  }
  location.reload();
}
