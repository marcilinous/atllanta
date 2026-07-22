import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate, timeAgo, initials, avColor } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

const CATEGORIES = ['IT Support', 'HR Query', 'Admin Request', 'Other'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const STATUSES = ['open', 'resolved', 'closed'];

function priorityBadge(p) {
  const map = { Low: 'neutral', Medium: 'info', High: 'warning', Urgent: 'error' };
  return `<span class="badge badge-${map[p] || 'neutral'}">${esc(p)}</span>`;
}

function statusBadge(s) {
  const map = { open: 'warning', resolved: 'success', closed: 'neutral' };
  return `<span class="badge badge-${map[s] || 'neutral'}">${esc(s)}</span>`;
}

function categoryBadge(c) {
  return `<span class="badge badge-info">${esc(c)}</span>`;
}

function buildTickets(events) {
  const map = {};
  for (const ev of events) {
    const tid = ev.payload?.ticket_id;
    if (!tid) continue;
    if (!map[tid]) {
      map[tid] = {
        ticket_id: tid,
        subject: ev.payload.subject || '(no subject)',
        description: ev.payload.description || '',
        category: ev.payload.category || 'Other',
        priority: ev.payload.priority || 'Medium',
        status: ev.payload.status || 'open',
        created_at: ev.created_at,
        actor: ev.actor,
        actor_id: ev.actor_id,
        events: []
      };
    }
    map[tid].events.push(ev);
    if (ev.event_type === 'helpdesk.ticket.updated') {
      if (ev.payload.status) map[tid].status = ev.payload.status;
      if (ev.payload.priority) map[tid].priority = ev.payload.priority;
    }
  }
  return Object.values(map).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export default async function helpdeskView(container) {
  const user = await getUser();
  const org = await getOrg();
  const membership = await getMembership();
  const role = membership?.role || 'member';
  const isAdmin = ['owner', 'admin', 'manager'].includes(role);
  let activeTab = 'mine';

  async function loadEvents() {
    const { data, error } = await sb
      .from('events')
      .select('*, actor:actor_id(full_name, email)')
      .like('event_type', 'helpdesk.ticket.%')
      .order('created_at', { ascending: false });
    if (error) { toast(error.message, 'error'); return []; }
    return data || [];
  }

  function showNewTicketModal() {
    const html = `
      <form id="new-ticket-form">
        <div class="form-group">
          <label class="form-label">Category</label>
          <select class="form-input" name="category" required>
            ${CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Priority</label>
          <select class="form-input" name="priority" required>
            ${PRIORITIES.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Subject</label>
          <input class="form-input" name="subject" required maxlength="200" placeholder="Brief summary of the issue">
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-input" name="description" rows="4" placeholder="Describe your issue in detail"></textarea>
        </div>
        <div style="display:flex;gap:var(--space-3);justify-content:flex-end;margin-top:var(--space-4);">
          <button type="button" class="btn btn-secondary" id="cancel-ticket">Cancel</button>
          <button type="submit" class="btn btn-primary">Submit Ticket</button>
        </div>
      </form>`;
    openModal('New Ticket', html);

    document.getElementById('cancel-ticket').addEventListener('click', closeModal);
    document.getElementById('new-ticket-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const ticket_id = crypto.randomUUID();
      await publishEvent('helpdesk.ticket.created', {
        ticket_id,
        subject: fd.get('subject'),
        description: fd.get('description'),
        category: fd.get('category'),
        priority: fd.get('priority'),
        status: 'open'
      });
      toast('Ticket created');
      closeModal();
      await render();
    });
  }

  function showDetailModal(ticket) {
    const authorName = ticket.actor?.full_name || 'Unknown';
    const av = avColor(authorName);
    const html = `
      <div style="display:flex;flex-direction:column;gap:var(--space-4);">
        <div style="display:flex;gap:var(--space-3);align-items:center;">
          <div style="width:36px;height:36px;border-radius:var(--radius-full);background:${av};display:flex;align-items:center;justify-content:center;color:#fff;font-size:var(--text-sm);font-weight:var(--font-weight-semibold);">${initials(authorName)}</div>
          <div>
            <div style="font-weight:var(--font-weight-medium);color:var(--color-text-primary);">${esc(authorName)}</div>
            <div style="font-size:var(--text-sm);color:var(--color-text-tertiary);">${timeAgo(ticket.created_at)}</div>
          </div>
        </div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
          ${categoryBadge(ticket.category)}
          ${priorityBadge(ticket.priority)}
          ${statusBadge(ticket.status)}
        </div>
        <div>
          <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);color:var(--color-text-secondary);margin-bottom:var(--space-1);">Description</div>
          <div style="font-size:var(--text-base);color:var(--color-text-primary);white-space:pre-wrap;">${esc(ticket.description || 'No description provided.')}</div>
        </div>
        ${isAdmin && ticket.status === 'open' ? `
        <div style="border-top:1px solid var(--color-border);padding-top:var(--space-4);display:flex;gap:var(--space-3);">
          <button class="btn btn-primary btn-sm" id="resolve-ticket">Mark Resolved</button>
          <button class="btn btn-secondary btn-sm" id="close-ticket">Close Ticket</button>
        </div>` : ''}
        ${isAdmin && ticket.status === 'resolved' ? `
        <div style="border-top:1px solid var(--color-border);padding-top:var(--space-4);display:flex;gap:var(--space-3);">
          <button class="btn btn-secondary btn-sm" id="close-ticket">Close Ticket</button>
        </div>` : ''}
      </div>`;
    openModal(ticket.subject, html);

    const resolveBtn = document.getElementById('resolve-ticket');
    const closeBtn = document.getElementById('close-ticket');

    if (resolveBtn) {
      resolveBtn.addEventListener('click', async () => {
        await publishEvent('helpdesk.ticket.updated', {
          ticket_id: ticket.ticket_id,
          status: 'resolved'
        });
        toast('Ticket resolved');
        closeModal();
        await render();
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', async () => {
        await publishEvent('helpdesk.ticket.updated', {
          ticket_id: ticket.ticket_id,
          status: 'closed'
        });
        toast('Ticket closed');
        closeModal();
        await render();
      });
    }
  }

  async function render() {
    const events = await loadEvents();
    const allTickets = buildTickets(events);
    const myTickets = allTickets.filter(t => t.actor_id === user.id);
    const visible = activeTab === 'mine' ? myTickets : allTickets;

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6);flex-wrap:wrap;gap:var(--space-3);">
        <div>
          <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);color:var(--color-text-primary);margin:0 0 var(--space-1);">Helpdesk</h1>
          <p style="font-size:var(--text-base);color:var(--color-text-secondary);margin:0;">Raise and track support tickets</p>
        </div>
        <button class="btn btn-primary" id="new-ticket-btn">New Ticket</button>
      </div>
      <div class="tabs" style="margin-bottom:var(--space-4);">
        <button class="tab${activeTab === 'mine' ? ' active' : ''}" data-tab="mine">My Tickets</button>
        ${isAdmin ? `<button class="tab${activeTab === 'all' ? ' active' : ''}" data-tab="all">All Tickets</button>` : ''}
      </div>
      <div id="ticket-list"></div>`;

    const listEl = container.querySelector('#ticket-list');

    if (!visible.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🎫</div>
          <h3 class="empty-state-title">No tickets found</h3>
          <p class="empty-state-desc">${activeTab === 'mine' ? 'You have not raised any tickets yet.' : 'No tickets have been created.'}</p>
        </div>`;
    } else {
      listEl.innerHTML = visible.map(t => {
        const authorName = t.actor?.full_name || 'Unknown';
        const av = avColor(authorName);
        return `
          <div class="card ticket-card" data-tid="${esc(t.ticket_id)}" style="margin-bottom:var(--space-3);cursor:pointer;">
            <div class="card-body" style="display:flex;gap:var(--space-4);align-items:flex-start;">
              <div style="width:40px;height:40px;border-radius:var(--radius-full);background:${av};display:flex;align-items:center;justify-content:center;color:#fff;font-size:var(--text-sm);font-weight:var(--font-weight-semibold);flex-shrink:0;">${initials(authorName)}</div>
              <div style="flex:1;min-width:0;">
                <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-2);">
                  ${categoryBadge(t.category)}
                  ${priorityBadge(t.priority)}
                  ${statusBadge(t.status)}
                </div>
                <div style="font-weight:var(--font-weight-medium);color:var(--color-text-primary);margin-bottom:var(--space-1);">${esc(t.subject)}</div>
                <div style="font-size:var(--text-sm);color:var(--color-text-tertiary);">${esc(authorName)} &middot; ${formatDate(t.created_at)}</div>
              </div>
            </div>
          </div>`;
      }).join('');
    }

    container.querySelector('#new-ticket-btn').addEventListener('click', showNewTicketModal);

    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        container.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        tab.classList.add('active');
        render();
      });
    });

    container.querySelectorAll('.ticket-card').forEach(card => {
      card.addEventListener('click', () => {
        const t = visible.find(x => x.ticket_id === card.dataset.tid);
        if (t) showDetailModal(t);
      });
    });
  }

  await render();
}
