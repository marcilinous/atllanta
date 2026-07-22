import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate, timeAgo, initials, avColor } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';
import { navigate } from '../../js/router.js';

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

function priorityBadge(p) {
  const map = { Low: 'neutral', Medium: 'info', High: 'warning', Urgent: 'error' };
  return `<span class="badge badge-${map[p] || 'neutral'}">${esc(p)}</span>`;
}

function statusBadge(s) {
  const map = { open: 'warning', in_progress: 'info', resolved: 'success', closed: 'neutral' };
  const labels = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
  return `<span class="badge badge-${map[s] || 'neutral'}">${labels[s] || esc(s)}</span>`;
}

export default async function helpdeskView(container) {
  const user = await getUser();
  const org = await getOrg();
  const membership = await getMembership();
  const role = membership?.role || 'member';
  const isAdmin = ['owner', 'admin'].includes(role);
  const isManager = ['owner', 'admin', 'manager'].includes(role);
  let activeTab = 'mine';
  let filterCategory = '';
  let filterStatus = '';

  const [{ data: categories }, { data: myHandlerCats }] = await Promise.all([
    sb.from('helpdesk_categories').select('*').eq('org_id', org.id).eq('is_active', true).order('sort_order').order('name'),
    sb.from('helpdesk_category_handlers').select('category_id').eq('user_id', user.id),
  ]);
  const cats = categories || [];
  const handledCatIds = (myHandlerCats || []).map(h => h.category_id);
  const isHandler = handledCatIds.length > 0;

  async function loadTickets() {
    let q = sb.from('helpdesk_tickets')
      .select('*, category:category_id(id, name, icon), creator:created_by(id, full_name, email), assignee:assigned_to(id, full_name, email)')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false });

    if (filterCategory) q = q.eq('category_id', filterCategory);
    if (filterStatus) q = q.eq('status', filterStatus);

    const { data, error } = await q;
    if (error) { toast(error.message, 'error'); return []; }
    return data || [];
  }

  function filterTickets(tickets) {
    if (activeTab === 'mine') return tickets.filter(t => t.created_by === user.id);
    if (activeTab === 'assigned') return tickets.filter(t => t.assigned_to === user.id || (t.category_id && handledCatIds.includes(t.category_id)));
    return tickets;
  }

  function showNewTicketModal() {
    const html = `
      <form id="new-ticket-form">
        <div class="form-group">
          <label class="form-label">Category</label>
          <select class="form-input" name="category_id" required>
            <option value="">Select a category...</option>
            ${cats.map(c => `<option value="${c.id}">${esc(c.icon || '📋')} ${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Priority</label>
          <select class="form-input" name="priority">
            ${PRIORITIES.map(p => `<option value="${p}" ${p === 'Medium' ? 'selected' : ''}>${p}</option>`).join('')}
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
        <div style="display:flex;gap:var(--space-3);justify-content:flex-end;margin-top:var(--space-4)">
          <button type="button" class="btn btn-secondary" id="cancel-ticket">Cancel</button>
          <button type="submit" class="btn btn-primary">Submit Ticket</button>
        </div>
      </form>`;
    openModal('New Ticket', html);
    document.getElementById('cancel-ticket').addEventListener('click', closeModal);
    document.getElementById('new-ticket-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const { data, error } = await sb.from('helpdesk_tickets').insert({
        org_id: org.id,
        category_id: fd.get('category_id') || null,
        subject: fd.get('subject'),
        description: fd.get('description'),
        priority: fd.get('priority'),
        created_by: user.id,
      }).select().single();
      if (error) { toast(error.message, 'error'); return; }
      await publishEvent('helpdesk.ticket.created', {
        ticket_id: data.id, subject: fd.get('subject'),
        category_id: fd.get('category_id'), user_id: user.id, title: fd.get('subject')
      });
      toast('Ticket created');
      closeModal();
      render();
    });
  }

  function showDetailModal(ticket) {
    const creatorName = ticket.creator?.full_name || 'Unknown';
    const assigneeName = ticket.assignee?.full_name || null;
    const html = `
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="display:flex;gap:var(--space-3);align-items:center">
          <div style="width:36px;height:36px;border-radius:var(--radius-full);background:${avColor(creatorName)};display:flex;align-items:center;justify-content:center;color:#fff;font-size:var(--text-sm);font-weight:var(--font-weight-semibold)">${initials(creatorName)}</div>
          <div>
            <div style="font-weight:var(--font-weight-medium)">${esc(creatorName)}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${timeAgo(ticket.created_at)}</div>
          </div>
        </div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          ${ticket.category ? `<span class="badge badge-info">${esc(ticket.category.icon || '📋')} ${esc(ticket.category.name)}</span>` : ''}
          ${priorityBadge(ticket.priority)}
          ${statusBadge(ticket.status)}
        </div>
        ${assigneeName ? `<div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Assigned to: <strong>${esc(assigneeName)}</strong></div>` : ''}
        <div>
          <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium);color:var(--color-text-secondary);margin-bottom:var(--space-1)">Description</div>
          <div style="font-size:var(--text-base);white-space:pre-wrap">${esc(ticket.description || 'No description provided.')}</div>
        </div>
        ${isManager && ['open', 'in_progress'].includes(ticket.status) ? `
        <div style="border-top:1px solid var(--color-border);padding-top:var(--space-4)">
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap">
            ${ticket.status === 'open' ? `<button class="btn btn-secondary btn-sm" id="progress-ticket">Mark In Progress</button>` : ''}
            <button class="btn btn-primary btn-sm" id="resolve-ticket">Resolve</button>
            <button class="btn btn-secondary btn-sm" id="close-ticket">Close</button>
            <button class="btn btn-secondary btn-sm" id="assign-ticket">Assign To...</button>
          </div>
        </div>` : ''}
        ${isManager && ticket.status === 'resolved' ? `
        <div style="border-top:1px solid var(--color-border);padding-top:var(--space-4)">
          <button class="btn btn-secondary btn-sm" id="close-ticket">Close</button>
        </div>` : ''}
      </div>`;
    openModal(ticket.subject, html);

    const actions = {
      'progress-ticket': { status: 'in_progress', msg: 'Ticket in progress' },
      'resolve-ticket': { status: 'resolved', msg: 'Ticket resolved' },
      'close-ticket': { status: 'closed', msg: 'Ticket closed' },
    };
    for (const [id, action] of Object.entries(actions)) {
      document.getElementById(id)?.addEventListener('click', async () => {
        const update = { status: action.status, updated_at: new Date().toISOString() };
        if (action.status === 'resolved') { update.resolved_by = user.id; update.resolved_at = new Date().toISOString(); }
        await sb.from('helpdesk_tickets').update(update).eq('id', ticket.id);
        await publishEvent('helpdesk.ticket.updated', { ticket_id: ticket.id, status: action.status, user_id: ticket.created_by });
        toast(action.msg);
        closeModal();
        render();
      });
    }

    document.getElementById('assign-ticket')?.addEventListener('click', () => showAssignModal(ticket));
  }

  async function showAssignModal(ticket) {
    closeModal();
    let assignees = [];
    if (ticket.category_id) {
      const { data } = await sb.from('helpdesk_category_handlers')
        .select('user:user_id(id, full_name, email, designation)')
        .eq('category_id', ticket.category_id);
      assignees = (data || []).map(d => d.user);
    }
    if (!assignees.length) {
      const { data } = await sb.from('users').select('id, full_name, email, designation')
        .eq('org_id', org.id).eq('status', 'active').in('role', ['owner', 'admin', 'manager']).order('full_name');
      assignees = data || [];
    }

    const html = `
      <div style="display:grid;gap:var(--space-2);max-height:350px;overflow-y:auto">
        ${assignees.map(a => `
          <button class="btn btn-secondary" data-assign-uid="${a.id}" style="text-align:left;display:flex;align-items:center;gap:var(--space-3)">
            <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${avColor(a.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(a.full_name)}</div>
            <div>
              <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(a.full_name)}</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(a.designation || a.email)}</div>
            </div>
          </button>
        `).join('')}
      </div>`;
    openModal('Assign Ticket', html);

    document.querySelectorAll('[data-assign-uid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await sb.from('helpdesk_tickets').update({
          assigned_to: btn.dataset.assignUid,
          status: 'in_progress',
          updated_at: new Date().toISOString()
        }).eq('id', ticket.id);
        toast('Ticket assigned');
        closeModal();
        render();
      });
    });
  }

  async function render() {
    const tickets = await loadTickets();
    const visible = filterTickets(tickets);

    const openCount = tickets.filter(t => t.created_by === user.id && t.status === 'open').length;
    const assignedCount = tickets.filter(t => t.assigned_to === user.id || (t.category_id && handledCatIds.includes(t.category_id))).filter(t => ['open', 'in_progress'].includes(t.status)).length;

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6);flex-wrap:wrap;gap:var(--space-3)">
        <div>
          <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);color:var(--color-text-primary);margin:0 0 var(--space-1)">Helpdesk</h1>
          <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0">Raise and track support tickets</p>
        </div>
        <div style="display:flex;gap:var(--space-2)">
          ${isAdmin ? `<button class="btn btn-secondary" id="helpdesk-settings-btn">Settings</button>` : ''}
          <button class="btn btn-primary" id="new-ticket-btn">New Ticket</button>
        </div>
      </div>

      <div class="tabs" style="margin-bottom:var(--space-4)">
        <button class="tab${activeTab === 'mine' ? ' active' : ''}" data-tab="mine">My Tickets${openCount ? ` <span class="badge badge-error" style="margin-left:var(--space-1)">${openCount}</span>` : ''}</button>
        ${isHandler || isManager ? `<button class="tab${activeTab === 'assigned' ? ' active' : ''}" data-tab="assigned">Assigned to Me${assignedCount ? ` <span class="badge badge-warning" style="margin-left:var(--space-1)">${assignedCount}</span>` : ''}</button>` : ''}
        ${isManager ? `<button class="tab${activeTab === 'all' ? ' active' : ''}" data-tab="all">All Tickets</button>` : ''}
      </div>

      <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-4);flex-wrap:wrap">
        <select class="form-input" id="filter-cat" style="width:auto;min-width:150px">
          <option value="">All Categories</option>
          ${cats.map(c => `<option value="${c.id}" ${filterCategory === c.id ? 'selected' : ''}>${esc(c.icon || '')} ${esc(c.name)}</option>`).join('')}
        </select>
        <select class="form-input" id="filter-status" style="width:auto;min-width:120px">
          <option value="">All Statuses</option>
          <option value="open" ${filterStatus === 'open' ? 'selected' : ''}>Open</option>
          <option value="in_progress" ${filterStatus === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="resolved" ${filterStatus === 'resolved' ? 'selected' : ''}>Resolved</option>
          <option value="closed" ${filterStatus === 'closed' ? 'selected' : ''}>Closed</option>
        </select>
      </div>

      <div id="ticket-list"></div>`;

    const listEl = container.querySelector('#ticket-list');

    if (!visible.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🎫</div>
          <h3 class="empty-state-title">No tickets found</h3>
          <p class="empty-state-desc">${activeTab === 'mine' ? 'You have not raised any tickets yet.' : 'No tickets match the current filters.'}</p>
        </div>`;
    } else {
      listEl.innerHTML = visible.map(t => {
        const creatorName = t.creator?.full_name || 'Unknown';
        return `
          <div class="card ticket-card" data-tid="${t.id}" style="margin-bottom:var(--space-3);cursor:pointer">
            <div class="card-body" style="display:flex;gap:var(--space-4);align-items:flex-start">
              <div style="width:40px;height:40px;border-radius:var(--radius-full);background:${avColor(creatorName)};display:flex;align-items:center;justify-content:center;color:#fff;font-size:var(--text-sm);font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(creatorName)}</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-2)">
                  ${t.category ? `<span class="badge badge-info">${esc(t.category.icon || '📋')} ${esc(t.category.name)}</span>` : ''}
                  ${priorityBadge(t.priority)}
                  ${statusBadge(t.status)}
                </div>
                <div style="font-weight:var(--font-weight-medium);margin-bottom:var(--space-1)">${esc(t.subject)}</div>
                <div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">
                  ${esc(creatorName)} · ${formatDate(t.created_at)}
                  ${t.assignee ? ` · Assigned: ${esc(t.assignee.full_name)}` : ''}
                </div>
              </div>
            </div>
          </div>`;
      }).join('');
    }

    document.getElementById('new-ticket-btn').addEventListener('click', () => {
      if (!cats.length) { toast('No categories configured. Ask your admin to set up helpdesk categories.'); return; }
      showNewTicketModal();
    });
    document.getElementById('helpdesk-settings-btn')?.addEventListener('click', () => navigate('helpdesk/settings'));

    document.getElementById('filter-cat').addEventListener('change', (e) => { filterCategory = e.target.value; render(); });
    document.getElementById('filter-status').addEventListener('change', (e) => { filterStatus = e.target.value; render(); });

    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => { activeTab = tab.dataset.tab; render(); });
    });

    container.querySelectorAll('.ticket-card').forEach(card => {
      card.addEventListener('click', () => {
        const t = visible.find(x => x.id === card.dataset.tid);
        if (t) showDetailModal(t);
      });
    });
  }

  await render();
}
