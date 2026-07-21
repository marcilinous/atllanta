import sb from '../../js/supabase.js';
import { getUser, getOrg } from '../../js/auth.js';
import { esc, formatDate } from '../../js/ui.js';

export default async function aiAssistant(container) {
  const user = getUser();
  const org = getOrg();

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">AI Assistant</h1>
      <p class="page-subtitle">Ask questions about your organization data</p>
    </div>
    <div class="ai-layout">
      <div class="card" style="display:flex;flex-direction:column">
        <div class="card-body" id="ai-chat" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:var(--space-3);padding:var(--space-4)"></div>
        <div style="border-top:1px solid var(--color-border);padding:var(--space-3);display:flex;gap:var(--space-2)">
          <input type="text" class="form-input" id="ai-input" placeholder="Ask about attendance, leaves, employees..." style="flex:1">
          <button class="btn btn-primary" id="ai-send">Send</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Suggested Questions</span></div>
        <div class="card-body" style="display:grid;gap:var(--space-2)">
          <button class="btn btn-secondary btn-sm suggest-q" style="text-align:left;white-space:normal">Who is absent today?</button>
          <button class="btn btn-secondary btn-sm suggest-q" style="text-align:left;white-space:normal">How many pending leave requests?</button>
          <button class="btn btn-secondary btn-sm suggest-q" style="text-align:left;white-space:normal">Show open jobs</button>
          <button class="btn btn-secondary btn-sm suggest-q" style="text-align:left;white-space:normal">Team attendance this week</button>
          <button class="btn btn-secondary btn-sm suggest-q" style="text-align:left;white-space:normal">Who joined recently?</button>
          <button class="btn btn-secondary btn-sm suggest-q" style="text-align:left;white-space:normal">Upcoming interviews</button>
          <button class="btn btn-secondary btn-sm suggest-q" style="text-align:left;white-space:normal">Leave balances summary</button>
          <button class="btn btn-secondary btn-sm suggest-q" style="text-align:left;white-space:normal">Shortlisted candidates count</button>
        </div>
      </div>
    </div>
  `;

  const chatEl = document.getElementById('ai-chat');
  const inputEl = document.getElementById('ai-input');

  function addMessage(content, isUser) {
    const msg = document.createElement('div');
    msg.style.cssText = `padding:var(--space-3);border-radius:var(--radius-lg);max-width:80%;font-size:var(--text-sm);line-height:1.6;${isUser ? 'background:var(--color-accent);color:white;align-self:flex-end' : 'background:var(--color-bg-secondary);align-self:flex-start'}`;
    msg.innerHTML = content;
    chatEl.appendChild(msg);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  async function processQuery(query) {
    const q = query.toLowerCase().trim();
    const today = new Date().toISOString().split('T')[0];

    if (q.includes('absent') && q.includes('today')) {
      const { data } = await sb.from('attendance').select('*, user:user_id(full_name)').eq('date', today).eq('status', 'absent');
      if (!data?.length) return 'No one is marked absent today.';
      return `<strong>${data.length} absent today:</strong><ul>${data.map(a => `<li>${esc(a.user?.full_name || 'Unknown')}</li>`).join('')}</ul>`;
    }

    if (q.includes('present') && q.includes('today')) {
      const { data } = await sb.from('attendance').select('*, user:user_id(full_name)').eq('date', today).eq('status', 'present');
      if (!data?.length) return 'No attendance records for today yet.';
      return `<strong>${data.length} present today:</strong><ul>${data.map(a => `<li>${esc(a.user?.full_name || 'Unknown')}</li>`).join('')}</ul>`;
    }

    if (q.includes('pending') && q.includes('leave')) {
      const { data } = await sb.from('leave_requests').select('*, requester:user_id(full_name), leave_type:leave_type_id(name)').eq('status', 'pending');
      if (!data?.length) return 'No pending leave requests.';
      return `<strong>${data.length} pending leave requests:</strong><ul>${data.map(r => `<li>${esc(r.requester?.full_name || '—')} — ${esc(r.leave_type?.name || '—')} (${r.days} days, ${r.start_date})</li>`).join('')}</ul>`;
    }

    if (q.includes('open') && q.includes('job')) {
      const { data } = await sb.from('jobs').select('title, location, employment_type').eq('status', 'open');
      if (!data?.length) return 'No open jobs right now.';
      return `<strong>${data.length} open jobs:</strong><ul>${data.map(j => `<li>${esc(j.title)}${j.location ? ' — ' + esc(j.location) : ''}</li>`).join('')}</ul>`;
    }

    if (q.includes('attendance') && q.includes('week')) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const { data } = await sb.from('attendance').select('status').gte('date', weekStart.toISOString().split('T')[0]);
      if (!data?.length) return 'No attendance data this week.';
      const present = data.filter(a => a.status === 'present').length;
      const late = data.filter(a => a.status === 'late').length;
      const absent = data.filter(a => a.status === 'absent').length;
      return `<strong>This week's attendance:</strong><br>Present: ${present}<br>Late: ${late}<br>Absent: ${absent}<br>Total records: ${data.length}`;
    }

    if (q.includes('joined') && q.includes('recent')) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const { data } = await sb.from('users').select('full_name, date_of_joining, designation').gte('date_of_joining', thirtyDaysAgo).order('date_of_joining', { ascending: false });
      if (!data?.length) return 'No employees joined in the last 30 days.';
      return `<strong>${data.length} joined recently:</strong><ul>${data.map(u => `<li>${esc(u.full_name)} — ${esc(u.designation || '—')} (${formatDate(u.date_of_joining)})</li>`).join('')}</ul>`;
    }

    if (q.includes('interview') && (q.includes('upcoming') || q.includes('scheduled'))) {
      const { data } = await sb.from('interviews')
        .select('*, application:job_application_id(candidate:candidate_id(full_name), job:job_id(title))')
        .eq('status', 'scheduled').gte('scheduled_at', today).order('scheduled_at').limit(10);
      if (!data?.length) return 'No upcoming interviews scheduled.';
      return `<strong>${data.length} upcoming interviews:</strong><ul>${data.map(i => `<li>${esc(i.application?.candidate?.full_name || '—')} for ${esc(i.application?.job?.title || '—')} — ${formatDate(i.scheduled_at)}</li>`).join('')}</ul>`;
    }

    if (q.includes('leave') && q.includes('balance')) {
      const { data } = await sb.from('leave_balances')
        .select('*, leave_type:leave_type_id(name), user:user_id(full_name)')
        .eq('year', new Date().getFullYear()).limit(20);
      if (!data?.length) return 'No leave balance data found.';
      const byUser = {};
      data.forEach(b => {
        const name = b.user?.full_name || 'Unknown';
        if (!byUser[name]) byUser[name] = [];
        byUser[name].push(`${b.leave_type?.name || '—'}: ${b.balance ?? '—'}`);
      });
      return `<strong>Leave balances:</strong><ul>${Object.entries(byUser).map(([name, balances]) => `<li><strong>${esc(name)}</strong>: ${balances.join(', ')}</li>`).join('')}</ul>`;
    }

    if (q.includes('shortlist') && q.includes('candidate')) {
      const { data } = await sb.from('job_applications').select('*, job:job_id(title)').eq('status', 'shortlisted');
      if (!data?.length) return 'No shortlisted candidates.';
      const byJob = {};
      data.forEach(a => {
        const title = a.job?.title || 'Unknown Job';
        byJob[title] = (byJob[title] || 0) + 1;
      });
      return `<strong>${data.length} shortlisted candidates:</strong><ul>${Object.entries(byJob).map(([job, count]) => `<li>${esc(job)}: ${count}</li>`).join('')}</ul>`;
    }

    if (q.includes('employee') && q.includes('count')) {
      const { count } = await sb.from('users').select('*', { count: 'exact', head: true });
      return `Total employees: <strong>${count ?? '—'}</strong>`;
    }

    return `I can help with questions about:<ul>
      <li>Attendance (who's absent/present today, weekly summary)</li>
      <li>Leave requests (pending, balances)</li>
      <li>Jobs (open positions)</li>
      <li>Interviews (upcoming, scheduled)</li>
      <li>Employees (recent joiners, count)</li>
      <li>Recruitment (shortlisted candidates)</li>
    </ul>Try asking one of the suggested questions!`;
  }

  async function handleSend() {
    const query = inputEl.value.trim();
    if (!query) return;

    addMessage(esc(query), true);
    inputEl.value = '';

    const thinking = document.createElement('div');
    thinking.style.cssText = 'padding:var(--space-2);font-size:var(--text-xs);color:var(--color-text-tertiary);align-self:flex-start';
    thinking.textContent = 'Thinking...';
    chatEl.appendChild(thinking);
    chatEl.scrollTop = chatEl.scrollHeight;

    const response = await processQuery(query);
    chatEl.removeChild(thinking);
    addMessage(response, false);
  }

  document.getElementById('ai-send').addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSend();
  });

  container.querySelectorAll('.suggest-q').forEach(btn => {
    btn.addEventListener('click', () => {
      inputEl.value = btn.textContent;
      handleSend();
    });
  });

  addMessage('Hello! I\'m your Atllanta AI assistant. Ask me about attendance, leaves, employees, jobs, or interviews.', false);
}
