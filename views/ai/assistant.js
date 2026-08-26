import { esc, getAuthToken } from '../../js/ui.js';

export default async function aiAssistant(container) {
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


  // Answer via the permission-aware Groq assistant (/api/ai-query). It plans a
  // dataset + filters with the LLM, runs the query through the caller's RLS, and
  // returns a natural-language answer plus the (permission-scoped) rows.
  async function processQuery(query) {
    try {
      const token = await getAuthToken();
      const resp = await fetch('/api/ai-query', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        return `Sorry, I couldn't answer that${e.error ? ` — ${esc(e.error)}` : ` (${resp.status})`}.`;
      }
      const { response, data } = await resp.json();
      let html = esc(response || 'No answer.').replace(/\n/g, '<br>');
      if (Array.isArray(data) && data.length) {
        const rows = data.slice(0, 20);
        const headers = Object.keys(rows[0] || {});
        if (headers.length) {
          html += tableWrap(headers, rows.map(r => headers.map(h => esc(String(r[h] ?? '—')))));
        }
      }
      return html;
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
    thinking.innerHTML = '<span class="skeleton" style="width:8px;height:8px;border-radius:var(--radius-full);display:inline-block"></span> Thinking…';
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
