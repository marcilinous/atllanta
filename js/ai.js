import sb from './supabase.js';
import { getUser, getOrg, getMembership } from './auth.js';
import { esc } from './ui.js';
import { publishEvent } from './events.js';

const GROQ_MODELS = ['llama-3.3-70b-versatile'];

export function initAIPanel() {
  if (document.getElementById('ai-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'ai-panel';
  panel.className = 'ai-panel hidden';
  panel.innerHTML = `
    <div class="ai-panel-header">
      <span style="font-weight:var(--font-weight-semibold)">AI Assistant</span>
      <button class="ai-panel-close" id="ai-close">&times;</button>
    </div>
    <div class="ai-messages" id="ai-messages">
      <div class="ai-msg ai-msg-bot">
        <div class="ai-msg-content">Hi! I can help you query your HR data. Try asking me things like:
          <ul style="margin:var(--space-2) 0 0;padding-left:var(--space-4);font-size:var(--text-xs)">
            <li>Who is absent today?</li>
            <li>Show pending leave requests</li>
            <li>How many open jobs do we have?</li>
            <li>List employees in Engineering</li>
          </ul>
        </div>
      </div>
    </div>
    <div class="ai-input-wrap">
      <input type="text" class="ai-input" id="ai-input" placeholder="Ask about your data..." autocomplete="off">
      <button class="btn btn-primary btn-sm" id="ai-send">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById('ai-close').addEventListener('click', () => panel.classList.add('hidden'));
  document.getElementById('ai-send').addEventListener('click', sendMessage);
  document.getElementById('ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

export function toggleAIPanel() {
  const panel = document.getElementById('ai-panel');
  if (panel) panel.classList.toggle('hidden');
}

async function sendMessage() {
  const input = document.getElementById('ai-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  const messagesEl = document.getElementById('ai-messages');
  messagesEl.insertAdjacentHTML('beforeend', `<div class="ai-msg ai-msg-user"><div class="ai-msg-content">${esc(msg)}</div></div>`);
  messagesEl.insertAdjacentHTML('beforeend', `<div class="ai-msg ai-msg-bot" id="ai-typing"><div class="ai-msg-content"><span class="ai-typing">Thinking...</span></div></div>`);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const result = await processQuery(msg);
    const typing = document.getElementById('ai-typing');
    if (typing) typing.remove();
    messagesEl.insertAdjacentHTML('beforeend', `<div class="ai-msg ai-msg-bot"><div class="ai-msg-content">${result}</div></div>`);
  } catch (err) {
    const typing = document.getElementById('ai-typing');
    if (typing) typing.remove();
    messagesEl.insertAdjacentHTML('beforeend', `<div class="ai-msg ai-msg-bot"><div class="ai-msg-content" style="color:var(--color-error)">Sorry, something went wrong: ${esc(err.message)}</div></div>`);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

export async function processQuery(query) {
  const org = getOrg();
  const user = getUser();
  const q = query.toLowerCase();
  const today = new Date().toISOString().split('T')[0];

  // Fast local queries for common patterns
  if (q.includes('absent') && q.includes('today')) {
    const { data } = await sb.from('attendance').select('*, user:user_id(full_name, email)').eq('date', today).eq('status', 'absent');
    if (!data?.length) return 'No one is marked absent today.';
    return `<strong>${data.length} absent today:</strong><ul>${data.map(a => `<li>${esc(a.user?.full_name || a.user?.email || '—')}</li>`).join('')}</ul>`;
  }

  if (q.includes('present') && q.includes('today')) {
    const { data } = await sb.from('attendance').select('*, user:user_id(full_name, email)').eq('date', today).eq('status', 'present');
    if (!data?.length) return 'No attendance records for today yet.';
    return `<strong>${data.length} present today:</strong><ul>${data.map(a => `<li>${esc(a.user?.full_name || a.user?.email || '—')}</li>`).join('')}</ul>`;
  }

  if (q.includes('pending') && q.includes('leave')) {
    const { data } = await sb.from('leave_requests').select('*, requester:user_id(full_name, email), leave_type:leave_type_id(name)').eq('status', 'pending').order('created_at', { ascending: false }).limit(10);
    if (!data?.length) return 'No pending leave requests.';
    return `<strong>${data.length} pending leave request${data.length !== 1 ? 's' : ''}:</strong><ul>${data.map(r => `<li>${esc(r.requester?.full_name || '—')} — ${esc(r.leave_type?.name || '—')} (${r.start_date} to ${r.end_date})</li>`).join('')}</ul>`;
  }

  if (q.includes('open') && q.includes('job')) {
    const { data, count } = await sb.from('jobs').select('id, title, status', { count: 'exact' }).eq('status', 'open');
    if (!data?.length) return 'No open jobs right now.';
    return `<strong>${count || data.length} open job${(count || data.length) !== 1 ? 's' : ''}:</strong><ul>${data.map(j => `<li>${esc(j.title)}</li>`).join('')}</ul>`;
  }

  if (q.includes('employee') && (q.includes('count') || q.includes('how many') || q.includes('total'))) {
    const { count } = await sb.from('users').select('*', { count: 'exact', head: true }).eq('status', 'active');
    return `There are <strong>${count || 0}</strong> active employees.`;
  }

  if (q.includes('late') && q.includes('today')) {
    const { data } = await sb.from('attendance').select('*, user:user_id(full_name)').eq('date', today).eq('status', 'late');
    if (!data?.length) return 'No one was late today.';
    return `<strong>${data.length} late today:</strong><ul>${data.map(a => `<li>${esc(a.user?.full_name || '—')}</li>`).join('')}</ul>`;
  }

  if (q.includes('on leave') && q.includes('today')) {
    const { data } = await sb.from('leave_requests').select('*, requester:user_id(full_name)').eq('status', 'approved').lte('start_date', today).gte('end_date', today);
    if (!data?.length) return 'No one is on approved leave today.';
    return `<strong>${data.length} on leave today:</strong><ul>${data.map(r => `<li>${esc(r.requester?.full_name || '—')}</li>`).join('')}</ul>`;
  }

  if (q.includes('interview') && (q.includes('today') || q.includes('scheduled'))) {
    const { data } = await sb.from('interviews').select('*, application:job_application_id(candidate:candidate_id(full_name), job:job_id(title))').gte('scheduled_at', today + 'T00:00:00').lte('scheduled_at', today + 'T23:59:59').eq('status', 'scheduled');
    if (!data?.length) return 'No interviews scheduled for today.';
    return `<strong>${data.length} interview${data.length !== 1 ? 's' : ''} today:</strong><ul>${data.map(i => `<li>${esc(i.application?.candidate?.full_name || '—')} for ${esc(i.application?.job?.title || '—')} at ${new Date(i.scheduled_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</li>`).join('')}</ul>`;
  }

  if (q.includes('employee') && q.includes('department') || (q.includes('list') && q.includes('in '))) {
    const deptMatch = query.match(/in\s+(\w[\w\s]*?)(?:\s+department)?$/i);
    if (deptMatch) {
      const deptName = deptMatch[1].trim();
      const { data: depts } = await sb.from('departments').select('id, name').ilike('name', `%${deptName}%`).limit(1);
      if (depts?.length) {
        const { data: emps } = await sb.from('users').select('full_name, email, designation').eq('department_id', depts[0].id).eq('status', 'active');
        if (!emps?.length) return `No employees found in ${esc(depts[0].name)}.`;
        return `<strong>${emps.length} employee${emps.length !== 1 ? 's' : ''} in ${esc(depts[0].name)}:</strong><ul>${emps.map(e => `<li>${esc(e.full_name)} — ${esc(e.designation || e.email)}</li>`).join('')}</ul>`;
      }
    }
  }

  // Action: Approve leave
  if (q.includes('approve') && q.includes('leave')) {
    const membership = getMembership();
    if (!membership || !['owner', 'admin', 'manager'].includes(membership.role)) {
      return 'You don\'t have permission to approve leave requests.';
    }
    const nameMatch = query.match(/approve\s+(\w[\w\s]*?)(?:'s|s)?\s+leave/i);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      const { data: reqs } = await sb.from('leave_requests')
        .select('id, days, leave_type_id, user_id, requester:user_id(full_name)')
        .eq('status', 'pending').limit(20);
      const match = reqs?.find(r => r.requester?.full_name?.toLowerCase().includes(name.toLowerCase()));
      if (!match) return `No pending leave request found for "${esc(name)}".`;
      return renderAction('approve_leave', match.id, `Approve ${esc(match.requester.full_name)}'s leave request (${match.days} days)?`, { days: match.days, leave_type_id: match.leave_type_id, user_id: match.user_id });
    }
  }

  // Action: Reject leave
  if (q.includes('reject') && q.includes('leave')) {
    const membership = getMembership();
    if (!membership || !['owner', 'admin', 'manager'].includes(membership.role)) {
      return 'You don\'t have permission to reject leave requests.';
    }
    const nameMatch = query.match(/reject\s+(\w[\w\s]*?)(?:'s|s)?\s+leave/i);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      const { data: reqs } = await sb.from('leave_requests')
        .select('id, requester:user_id(full_name)')
        .eq('status', 'pending').limit(20);
      const match = reqs?.find(r => r.requester?.full_name?.toLowerCase().includes(name.toLowerCase()));
      if (!match) return `No pending leave request found for "${esc(name)}".`;
      return renderAction('reject_leave', match.id, `Reject ${esc(match.requester.full_name)}'s leave request?`, {});
    }
  }

  // Action: Shortlist top candidates
  if (q.includes('shortlist') && (q.includes('top') || q.includes('candidate'))) {
    const membership = getMembership();
    if (!membership || !['owner', 'admin', 'manager'].includes(membership.role)) {
      return 'You don\'t have permission to shortlist candidates.';
    }
    const countMatch = query.match(/top\s+(\d+)/i);
    const count = countMatch ? parseInt(countMatch[1]) : 5;
    const roleMatch = query.match(/for\s+(.+?)$/i);
    if (roleMatch) {
      const jobTitle = roleMatch[1].trim();
      const { data: jobs } = await sb.from('jobs').select('id, title').ilike('title', `%${jobTitle}%`).eq('status', 'open').limit(1);
      if (!jobs?.length) return `No open job found matching "${esc(jobTitle)}".`;
      const job = jobs[0];
      const { data: apps } = await sb.from('job_applications')
        .select('id, match_score, candidate:candidate_id(full_name)')
        .eq('job_id', job.id).in('status', ['applied', 'screening'])
        .order('match_score', { ascending: false }).limit(count);
      if (!apps?.length) return `No unshortlisted candidates found for ${esc(job.title)}.`;
      const ids = apps.map(a => a.id);
      const list = apps.map(a => `${esc(a.candidate?.full_name || '—')} (${a.match_score || 0}%)`).join(', ');
      return renderAction('shortlist_candidates', ids.join(','), `Shortlist ${apps.length} candidates for ${esc(job.title)}? ${list}`, { job_id: job.id });
    }
  }

  // Fall back to Groq LLM for complex queries
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.access_token) {
      const resp = await fetch('/api/ai-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ query }),
      });
      if (resp.ok) {
        const result = await resp.json();
        let html = '';
        if (result.response) html += `<div>${esc(result.response)}</div>`;
        if (result.data?.length) {
          const keys = Object.keys(result.data[0]).filter(k => !['id', 'org_id', 'fts'].includes(k)).slice(0, 6);
          html += `<div style="overflow-x:auto;margin-top:var(--space-2)"><table style="width:100%;font-size:var(--text-xs);border-collapse:collapse">
            <thead><tr>${keys.map(k => `<th style="text-align:left;padding:var(--space-1) var(--space-2);border-bottom:1px solid var(--color-border)">${esc(k)}</th>`).join('')}</tr></thead>
            <tbody>${result.data.slice(0, 15).map(row => `<tr>${keys.map(k => `<td style="padding:var(--space-1) var(--space-2);border-bottom:1px solid var(--color-border-light)">${esc(String(row[k] ?? '—'))}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>`;
          if (result.data.length > 15) html += `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-1)">Showing 15 of ${result.data.length} results</div>`;
        }
        if (html) return html;
      }
    }
  } catch {}

  return `I can help with these queries:
    <ul style="margin-top:var(--space-2);font-size:var(--text-xs)">
      <li>Who is absent/present/late today?</li>
      <li>Who is on leave today?</li>
      <li>Show pending leave requests</li>
      <li>How many open jobs?</li>
      <li>How many employees total?</li>
      <li>List employees in [department]</li>
      <li>Any interviews today?</li>
    </ul>
    <div style="margin-top:var(--space-2);font-size:var(--text-xs);font-weight:var(--font-weight-medium);color:var(--color-text-secondary);margin-top:var(--space-3)">I can also take actions:</div>
    <ul style="margin-top:var(--space-1);font-size:var(--text-xs)">
      <li>Approve [name]'s leave</li>
      <li>Reject [name]'s leave</li>
      <li>Shortlist top 5 for [job title]</li>
    </ul>
    <div style="margin-top:var(--space-2);font-size:var(--text-xs);color:var(--color-text-tertiary)">Actions require confirmation before executing.</div>`;
}

let actionCounter = 0;

function renderAction(actionType, targetId, message, meta) {
  const id = `ai-action-${++actionCounter}`;
  setTimeout(() => {
    const confirmBtn = document.getElementById(`${id}-confirm`);
    const cancelBtn = document.getElementById(`${id}-cancel`);
    if (confirmBtn) confirmBtn.addEventListener('click', () => executeAction(id, actionType, targetId, meta));
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      const wrap = document.getElementById(id);
      if (wrap) wrap.innerHTML = `<div style="color:var(--color-text-tertiary);font-size:var(--text-xs)">Cancelled.</div>`;
    });
  }, 0);

  return `<div id="${id}">
    <div style="margin-bottom:var(--space-2)">${message}</div>
    <div style="display:flex;gap:var(--space-2)">
      <button class="btn btn-primary btn-sm" id="${id}-confirm">Confirm</button>
      <button class="btn btn-secondary btn-sm" id="${id}-cancel">Cancel</button>
    </div>
  </div>`;
}

async function executeAction(wrapperId, actionType, targetId, meta) {
  const wrap = document.getElementById(wrapperId);
  if (!wrap) return;
  wrap.innerHTML = `<span class="ai-typing">Executing...</span>`;

  const user = getUser();
  const org = getOrg();

  try {
    if (actionType === 'approve_leave') {
      const { error } = await sb.from('leave_requests').update({
        status: 'approved',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString()
      }).eq('id', targetId);
      if (error) throw error;
      publishEvent('leave.request.approved', {
        leave_request_id: targetId,
        user_id: meta.user_id,
        org_id: org.id,
        days: meta.days,
        leave_type_id: meta.leave_type_id
      });
      wrap.innerHTML = `<div style="color:var(--color-success)">Leave request approved.</div>`;
    }

    else if (actionType === 'reject_leave') {
      const { error } = await sb.from('leave_requests').update({
        status: 'rejected',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_comment: 'Rejected via AI assistant'
      }).eq('id', targetId);
      if (error) throw error;
      publishEvent('leave.request.rejected', {
        leave_request_id: targetId,
        org_id: org.id
      });
      wrap.innerHTML = `<div style="color:var(--color-success)">Leave request rejected.</div>`;
    }

    else if (actionType === 'shortlist_candidates') {
      const ids = targetId.split(',');
      for (const appId of ids) {
        const { error } = await sb.from('job_applications').update({
          status: 'shortlisted',
          shortlisted_at: new Date().toISOString(),
          shortlisted_by: user.id
        }).eq('id', appId);
        if (error) throw error;
      }
      wrap.innerHTML = `<div style="color:var(--color-success)">${ids.length} candidate${ids.length !== 1 ? 's' : ''} shortlisted.</div>`;
    }
  } catch (err) {
    wrap.innerHTML = `<div style="color:var(--color-error)">Failed: ${esc(err.message)}</div>`;
  }
}
