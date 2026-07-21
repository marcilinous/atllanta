import sb from '../../js/supabase.js';
import { getUser, getOrg } from '../../js/auth.js';
import { esc, formatDate, initials, avColor, timeAgo } from '../../js/ui.js';

export default async function aiAssistant(container) {
  const user = getUser();
  const org = getOrg();
  const today = new Date().toISOString().split('T')[0];

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
          <button class="btn btn-primary" id="ai-send">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
      <div class="card" style="overflow-y:auto">
        <div class="card-header"><span class="card-title">Quick Questions</span></div>
        <div class="card-body" style="display:grid;gap:var(--space-2)">
          ${[
            ['Who is absent today?', 'attendance'],
            ['How many are present today?', 'attendance'],
            ['Show pending leave requests', 'leave'],
            ['Leave balances summary', 'leave'],
            ['Show open jobs', 'recruitment'],
            ['Shortlisted candidates', 'recruitment'],
            ['Upcoming interviews', 'recruitment'],
            ['Who joined recently?', 'people'],
            ['Team attendance this week', 'attendance'],
            ['Employee count by department', 'people'],
            ['Late arrivals this month', 'attendance'],
            ['Employees on notice', 'people'],
          ].map(([q, cat]) => {
            const catColors = { attendance: 'var(--color-success)', leave: 'var(--color-info)', recruitment: 'var(--color-accent)', people: 'var(--color-warning)' };
            return `<button class="btn btn-secondary btn-sm suggest-q" style="text-align:left;white-space:normal;position:relative;padding-left:var(--space-6)">
              <span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);width:6px;height:6px;border-radius:var(--radius-full);background:${catColors[cat] || 'var(--color-text-tertiary)'}"></span>
              ${q}
            </button>`;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  const chatEl = document.getElementById('ai-chat');
  const inputEl = document.getElementById('ai-input');

  function addMessage(content, isUser) {
    const msg = document.createElement('div');
    msg.style.cssText = `padding:var(--space-3);border-radius:var(--radius-lg);max-width:85%;font-size:var(--text-sm);line-height:1.6;${isUser
      ? 'background:var(--color-accent);color:white;align-self:flex-end'
      : 'background:var(--color-bg-secondary);align-self:flex-start'}`;
    msg.innerHTML = content;
    chatEl.appendChild(msg);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function tableWrap(headers, rows) {
    if (!rows.length) return '';
    return `<div style="overflow-x:auto;margin-top:var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-md)">
      <table style="width:100%;border-collapse:collapse;font-size:var(--text-xs)">
        <thead><tr>${headers.map(h => `<th style="padding:6px 8px;text-align:left;background:var(--color-bg-tertiary);font-weight:var(--font-weight-semibold)">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td style="padding:6px 8px;border-top:1px solid var(--color-border-light)">${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`;
  }

  function statBlock(items) {
    return `<div style="display:flex;gap:var(--space-4);margin-top:var(--space-2)">${items.map(([label, value, color]) =>
      `<div style="text-align:center"><div style="font-size:var(--text-lg);font-weight:var(--font-weight-bold);${color ? 'color:' + color : ''}">${value}</div><div style="font-size:10px;color:var(--color-text-tertiary)">${label}</div></div>`
    ).join('')}</div>`;
  }

  const matchers = [
    {
      test: q => q.includes('absent') && q.includes('today'),
      run: async () => {
        const { data } = await sb.from('attendance').select('*, user:user_id(full_name, designation)').eq('date', today).eq('status', 'absent');
        if (!data?.length) return 'No one is marked absent today.';
        return `<strong>${data.length} absent today</strong>` + tableWrap(['Name', 'Role'], data.map(a => [esc(a.user?.full_name || '—'), esc(a.user?.designation || '—')]));
      }
    },
    {
      test: q => q.includes('present') && q.includes('today'),
      run: async () => {
        const { data } = await sb.from('attendance').select('*, user:user_id(full_name)').eq('date', today).in('status', ['present', 'late']);
        if (!data?.length) return 'No attendance records for today yet.';
        const onTime = data.filter(a => a.status === 'present').length;
        const late = data.filter(a => a.status === 'late').length;
        return `<strong>${data.length} present today</strong>` + statBlock([['On Time', onTime, 'var(--color-success)'], ['Late', late, 'var(--color-warning)']]);
      }
    },
    {
      test: q => q.includes('late') && (q.includes('month') || q.includes('arrival')),
      run: async () => {
        const monthStart = today.slice(0, 7) + '-01';
        const { data } = await sb.from('attendance').select('user:user_id(full_name), date').eq('status', 'late').gte('date', monthStart).order('date', { ascending: false });
        if (!data?.length) return 'No late arrivals this month.';
        const byUser = {};
        data.forEach(a => { byUser[a.user?.full_name || '—'] = (byUser[a.user?.full_name || '—'] || 0) + 1; });
        const sorted = Object.entries(byUser).sort((a, b) => b[1] - a[1]);
        return `<strong>${data.length} late arrivals this month</strong>` + tableWrap(['Employee', 'Times Late'], sorted.map(([name, count]) => [esc(name), `<strong style="color:var(--color-warning)">${count}</strong>`]));
      }
    },
    {
      test: q => q.includes('pending') && q.includes('leave'),
      run: async () => {
        const { data } = await sb.from('leave_requests').select('*, requester:user_id(full_name), leave_type:leave_type_id(name, code)').eq('status', 'pending').order('created_at', { ascending: false });
        if (!data?.length) return 'No pending leave requests.';
        return `<strong>${data.length} pending leave requests</strong>` + tableWrap(
          ['Employee', 'Type', 'From', 'Days'],
          data.map(r => [esc(r.requester?.full_name || '—'), esc(r.leave_type?.code || '—'), formatDate(r.start_date), r.days])
        );
      }
    },
    {
      test: q => q.includes('leave') && q.includes('balance'),
      run: async () => {
        const { data } = await sb.from('leave_balances').select('*, leave_type:leave_type_id(name, code), user:user_id(full_name)').eq('year', new Date().getFullYear()).limit(30);
        if (!data?.length) return 'No leave balance data found.';
        const byUser = {};
        data.forEach(b => {
          const name = b.user?.full_name || 'Unknown';
          if (!byUser[name]) byUser[name] = {};
          byUser[name][b.leave_type?.code || '—'] = parseFloat(b.balance || 0);
        });
        const codes = [...new Set(data.map(b => b.leave_type?.code).filter(Boolean))];
        return `<strong>Leave Balances (${new Date().getFullYear()})</strong>` + tableWrap(
          ['Employee', ...codes],
          Object.entries(byUser).map(([name, types]) => [esc(name), ...codes.map(c => String(types[c] ?? '—'))])
        );
      }
    },
    {
      test: q => q.includes('open') && q.includes('job'),
      run: async () => {
        const { data: jobs } = await sb.from('jobs').select('id, title, location, employment_type').eq('status', 'open');
        if (!jobs?.length) return 'No open jobs right now.';
        const jobIds = jobs.map(j => j.id);
        const { data: apps } = await sb.from('job_applications').select('job_id').in('job_id', jobIds);
        const counts = {};
        (apps || []).forEach(a => { counts[a.job_id] = (counts[a.job_id] || 0) + 1; });
        return `<strong>${jobs.length} open positions</strong>` + tableWrap(
          ['Position', 'Location', 'Candidates'],
          jobs.map(j => [esc(j.title), esc(j.location || '—'), counts[j.id] || 0])
        );
      }
    },
    {
      test: q => q.includes('shortlist') && q.includes('candidate'),
      run: async () => {
        const { data } = await sb.from('job_applications').select('*, job:job_id(title), candidate:candidate_id(full_name)').eq('status', 'shortlisted');
        if (!data?.length) return 'No shortlisted candidates.';
        return `<strong>${data.length} shortlisted candidates</strong>` + tableWrap(
          ['Candidate', 'Job', 'Score'],
          data.map(a => [esc(a.candidate?.full_name || '—'), esc(a.job?.title || '—'), a.match_score ? `${Number(a.match_score).toFixed(0)}%` : '—'])
        );
      }
    },
    {
      test: q => q.includes('interview') && (q.includes('upcoming') || q.includes('scheduled')),
      run: async () => {
        const { data } = await sb.from('interviews')
          .select('*, application:job_application_id(candidate:candidate_id(full_name), job:job_id(title))')
          .eq('status', 'scheduled').gte('scheduled_at', today).order('scheduled_at').limit(10);
        if (!data?.length) return 'No upcoming interviews scheduled.';
        return `<strong>${data.length} upcoming interviews</strong>` + tableWrap(
          ['Candidate', 'Job', 'When'],
          data.map(i => [esc(i.application?.candidate?.full_name || '—'), esc(i.application?.job?.title || '—'),
            new Date(i.scheduled_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })])
        );
      }
    },
    {
      test: q => q.includes('joined') && q.includes('recent'),
      run: async () => {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        const { data } = await sb.from('users').select('full_name, date_of_joining, designation, department:department_id(name)').gte('date_of_joining', thirtyDaysAgo).order('date_of_joining', { ascending: false });
        if (!data?.length) return 'No employees joined in the last 30 days.';
        return `<strong>${data.length} new joiners (last 30 days)</strong>` + tableWrap(
          ['Name', 'Designation', 'Dept', 'Joined'],
          data.map(u => [esc(u.full_name), esc(u.designation || '—'), esc(u.department?.name || '—'), formatDate(u.date_of_joining)])
        );
      }
    },
    {
      test: q => q.includes('attendance') && q.includes('week'),
      run: async () => {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const { data } = await sb.from('attendance').select('status, date').gte('date', weekStart.toISOString().split('T')[0]);
        if (!data?.length) return 'No attendance data this week.';
        const present = data.filter(a => a.status === 'present').length;
        const late = data.filter(a => a.status === 'late').length;
        const absent = data.filter(a => a.status === 'absent').length;
        const onLeave = data.filter(a => a.status === 'on_leave').length;
        return '<strong>This week\'s attendance</strong>' + statBlock([
          ['Present', present, 'var(--color-success)'],
          ['Late', late, 'var(--color-warning)'],
          ['Absent', absent, 'var(--color-error)'],
          ['On Leave', onLeave, 'var(--color-info)'],
        ]);
      }
    },
    {
      test: q => q.includes('employee') && q.includes('count'),
      run: async () => {
        const { count } = await sb.from('users').select('*', { count: 'exact', head: true });
        return `Total employees: <strong>${count ?? '—'}</strong>`;
      }
    },
    {
      test: q => q.includes('department') && (q.includes('count') || q.includes('breakdown') || q.includes('employee')),
      run: async () => {
        const { data } = await sb.from('users').select('department:department_id(name)');
        if (!data?.length) return 'No employee data available.';
        const counts = {};
        data.forEach(u => { const d = u.department?.name || 'Unassigned'; counts[d] = (counts[d] || 0) + 1; });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        return `<strong>Employees by department (${data.length} total)</strong>` + tableWrap(['Department', 'Count'], sorted.map(([d, c]) => [esc(d), `<strong>${c}</strong>`]));
      }
    },
    {
      test: q => q.includes('on notice') || (q.includes('notice') && q.includes('employee')),
      run: async () => {
        const { data } = await sb.from('users').select('full_name, email, designation, department:department_id(name)').eq('status', 'on_notice');
        if (!data?.length) return 'No employees are currently on notice.';
        return `<strong>${data.length} employees on notice</strong>` + tableWrap(
          ['Name', 'Designation', 'Department'],
          data.map(u => [esc(u.full_name), esc(u.designation || '—'), esc(u.department?.name || '—')])
        );
      }
    },
    {
      test: q => q.includes('headcount') || (q.includes('team') && q.includes('size')),
      run: async () => {
        const { data } = await sb.from('users').select('status');
        if (!data?.length) return 'No employee data.';
        const active = data.filter(u => u.status === 'active').length;
        const onNotice = data.filter(u => u.status === 'on_notice').length;
        const exited = data.filter(u => u.status === 'exited').length;
        return '<strong>Headcount Summary</strong>' + statBlock([
          ['Active', active, 'var(--color-success)'],
          ['On Notice', onNotice, 'var(--color-warning)'],
          ['Exited', exited, 'var(--color-error)'],
        ]);
      }
    },
    {
      test: q => q.includes('holiday') || q.includes('holidays'),
      run: async () => {
        const year = new Date().getFullYear();
        const { data } = await sb.from('holidays').select('name, date, is_optional').eq('year', year).order('date');
        if (!data?.length) return `No holidays configured for ${year}.`;
        const upcoming = data.filter(h => h.date >= today);
        const next = upcoming.length ? `Next holiday: <strong>${esc(upcoming[0].name)}</strong> on ${formatDate(upcoming[0].date)}<br>` : '';
        return `${next}<strong>${data.length} holidays in ${year}</strong> (${upcoming.length} remaining)` + tableWrap(
          ['Holiday', 'Date', 'Type'],
          data.map(h => [esc(h.name), formatDate(h.date), h.is_optional ? 'Optional' : 'Mandatory'])
        );
      }
    },
  ];

  async function processQuery(query) {
    try {
      const q = query.toLowerCase().trim();
      for (const m of matchers) {
        if (m.test(q)) return await m.run();
      }

      return `I can help with questions about:
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-top:var(--space-2)">
        <div style="padding:var(--space-2);background:var(--color-bg-tertiary);border-radius:var(--radius-md)">
          <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-xs);color:var(--color-success)">Attendance</div>
          <div style="font-size:11px;color:var(--color-text-secondary)">absent/present today, weekly stats, late arrivals</div>
        </div>
        <div style="padding:var(--space-2);background:var(--color-bg-tertiary);border-radius:var(--radius-md)">
          <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-xs);color:var(--color-info)">Leave</div>
          <div style="font-size:11px;color:var(--color-text-secondary)">pending requests, balances, holidays</div>
        </div>
        <div style="padding:var(--space-2);background:var(--color-bg-tertiary);border-radius:var(--radius-md)">
          <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-xs);color:var(--color-accent)">Recruitment</div>
          <div style="font-size:11px;color:var(--color-text-secondary)">open jobs, shortlisted, interviews</div>
        </div>
        <div style="padding:var(--space-2);background:var(--color-bg-tertiary);border-radius:var(--radius-md)">
          <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-xs);color:var(--color-warning)">People</div>
          <div style="font-size:11px;color:var(--color-text-secondary)">headcount, departments, new joiners, on notice</div>
        </div>
      </div>`;
    } catch (err) {
      return `Sorry, something went wrong: ${esc(err.message || 'Unknown error')}`;
    }
  }

  async function handleSend() {
    const query = inputEl.value.trim();
    if (!query) return;

    addMessage(esc(query), true);
    inputEl.value = '';

    const thinking = document.createElement('div');
    thinking.style.cssText = 'padding:var(--space-2) var(--space-3);font-size:var(--text-xs);color:var(--color-text-tertiary);align-self:flex-start;display:flex;align-items:center;gap:var(--space-2)';
    thinking.innerHTML = '<span class="skeleton" style="width:8px;height:8px;border-radius:var(--radius-full);display:inline-block"></span> Searching...';
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
      inputEl.value = btn.textContent.trim();
      handleSend();
    });
  });

  addMessage('Hello! I\'m your Atllanta AI assistant. I can query your organization data — try asking about attendance, leaves, employees, or recruitment.', false);
}
