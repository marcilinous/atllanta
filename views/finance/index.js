import sb from '/js/supabase.js';
import { getUser, getOrg, getMembership } from '/js/auth.js';
import { esc, toast, openModal, closeModal } from '/js/ui.js';
import { publishEvent } from '/js/events.js';

export default async function financeView(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);
  let activeTab = 'my';

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Finance</h1>
        <p class="page-subtitle">Expense claims and reimbursements</p>
      </div>
      <button class="btn btn-primary" id="btn-new-expense">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Expense
      </button>
    </div>
    <div class="stat-grid" id="expense-stats" style="margin-bottom:var(--space-4)"></div>
    ${isManager ? `
    <div class="tabs" style="margin-bottom:var(--space-4)">
      <button class="tab active" data-tab="my">My Expenses</button>
      <button class="tab" data-tab="approvals">Pending Approvals</button>
      <button class="tab" data-tab="all">All Expenses</button>
    </div>` : ''}
    <div class="card">
      <div class="card-body" id="expense-list"></div>
    </div>
  `;

  const statsEl = document.getElementById('expense-stats');
  const listEl = document.getElementById('expense-list');

  async function loadStats() {
    const { data: myExpenses, error } = await sb.from('expenses').select('amount, status')
      .eq('user_id', user.id);
    if (error) { console.error(error); return; }

    const pending = myExpenses?.filter(e => e.status === 'pending') || [];
    const approved = myExpenses?.filter(e => e.status === 'approved') || [];
    const reimbursed = myExpenses?.filter(e => e.status === 'reimbursed') || [];
    const sum = arr => arr.reduce((s, e) => s + parseFloat(e.amount || 0), 0);

    statsEl.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Pending</div>
        <div class="stat-value">${org?.currency || 'INR'} ${sum(pending).toLocaleString()}</div>
        <div class="stat-change">${pending.length} claim${pending.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Approved</div>
        <div class="stat-value">${org?.currency || 'INR'} ${sum(approved).toLocaleString()}</div>
        <div class="stat-change">${approved.length} claim${approved.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Reimbursed</div>
        <div class="stat-value">${org?.currency || 'INR'} ${sum(reimbursed).toLocaleString()}</div>
        <div class="stat-change">${reimbursed.length} claim${reimbursed.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Claims</div>
        <div class="stat-value">${myExpenses?.length || 0}</div>
        <div class="stat-change">this period</div>
      </div>
    `;
  }

  async function loadExpenses() {
    listEl.innerHTML = '<div class="skeleton skeleton-text"></div>';
    let query = sb.from('expenses')
      .select('*, category:category_id(name, code), submitter:user_id(full_name, email), reviewer:reviewed_by(full_name)')
      .order('created_at', { ascending: false });

    if (activeTab === 'my') {
      query = query.eq('user_id', user.id);
    } else if (activeTab === 'approvals') {
      query = query.eq('status', 'pending');
    }

    const { data: expenses, error } = await query.limit(50);
    if (error) { listEl.innerHTML = `<div class="empty-state"><p>Error loading expenses</p></div>`; return; }
    if (!expenses?.length) {
      listEl.innerHTML = `<div class="empty-state">
        <svg width="40" height="40" fill="none" stroke="var(--color-text-tertiary)" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"/></svg>
        <p>${activeTab === 'approvals' ? 'No pending expense claims' : 'No expenses yet'}</p>
        ${activeTab === 'my' ? '<p style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Click "New Expense" to submit a claim</p>' : ''}
      </div>`;
      return;
    }

    const statusBadge = s => {
      const colors = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-error', reimbursed: 'badge-info' };
      return `<span class="badge ${colors[s] || ''}">${s}</span>`;
    };

    listEl.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Date</th>
            <th>Title</th>
            ${activeTab !== 'my' ? '<th>Submitted By</th>' : ''}
            <th>Category</th>
            <th>Amount</th>
            <th>Status</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${expenses.map(e => `<tr>
              <td>${new Date(e.expense_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
              <td style="font-weight:var(--font-weight-medium)">${esc(e.title)}</td>
              ${activeTab !== 'my' ? `<td>${esc(e.submitter?.full_name || e.submitter?.email || '—')}</td>` : ''}
              <td>${esc(e.category?.name || '—')}</td>
              <td style="font-weight:var(--font-weight-semibold)">${org?.currency || 'INR'} ${parseFloat(e.amount).toLocaleString()}</td>
              <td>${statusBadge(e.status)}</td>
              <td>
                <div style="display:flex;gap:var(--space-1)">
                  ${e.status === 'pending' && isManager && e.user_id !== user.id ? `
                    <button class="btn btn-ghost btn-sm btn-approve" data-id="${e.id}" data-uid="${e.user_id}" data-amt="${e.amount}" title="Approve" style="color:var(--color-success)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                    <button class="btn btn-ghost btn-sm btn-reject" data-id="${e.id}" title="Reject" style="color:var(--color-error)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  ` : ''}
                  ${e.status === 'approved' && isManager ? `
                    <button class="btn btn-ghost btn-sm btn-reimburse" data-id="${e.id}" title="Mark Reimbursed" style="color:var(--color-accent)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    </button>
                  ` : ''}
                  ${e.status === 'pending' && e.user_id === user.id ? `
                    <button class="btn btn-ghost btn-sm btn-cancel-expense" data-id="${e.id}" title="Cancel" style="color:var(--color-text-tertiary)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;

    listEl.querySelectorAll('.btn-approve').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await sb.from('expenses').update({
          status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString()
        }).eq('id', btn.dataset.id);
        if (error) { toast(error.message); return; }
        publishEvent('finance.expense.approved', { expense_id: btn.dataset.id, org_id: org.id, user_id: btn.dataset.uid, amount: btn.dataset.amt });
        toast('Expense approved');
        loadExpenses();
        loadStats();
      });
    });

    listEl.querySelectorAll('.btn-reject').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await sb.from('expenses').update({
          status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString()
        }).eq('id', btn.dataset.id);
        if (error) { toast(error.message); return; }
        toast('Expense rejected');
        loadExpenses();
        loadStats();
      });
    });

    listEl.querySelectorAll('.btn-reimburse').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await sb.from('expenses').update({
          status: 'reimbursed', reimbursed_at: new Date().toISOString()
        }).eq('id', btn.dataset.id);
        if (error) { toast(error.message); return; }
        toast('Marked as reimbursed');
        loadExpenses();
        loadStats();
      });
    });

    listEl.querySelectorAll('.btn-cancel-expense').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await sb.from('expenses').delete().eq('id', btn.dataset.id);
        if (error) { toast(error.message); return; }
        toast('Expense cancelled');
        loadExpenses();
        loadStats();
      });
    });
  }

  // Tab switching
  container.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      loadExpenses();
    });
  });

  // New expense form
  document.getElementById('btn-new-expense').addEventListener('click', async () => {
    const { data: categories, error: catErr } = await sb.from('expense_categories')
      .select('id, name, code').eq('is_active', true).order('name');
    if (catErr) console.error(catErr);

    openModal('New Expense', `
      <form id="expense-form" style="display:flex;flex-direction:column;gap:var(--space-3)">
        <div>
          <label class="form-label">Title</label>
          <input class="form-input" name="title" required placeholder="e.g. Client lunch, Travel to Mumbai">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
          <div>
            <label class="form-label">Amount (${org?.currency || 'INR'})</label>
            <input class="form-input" name="amount" type="number" step="0.01" min="0" required placeholder="0.00">
          </div>
          <div>
            <label class="form-label">Date</label>
            <input class="form-input" name="expense_date" type="date" required value="${new Date().toISOString().split('T')[0]}">
          </div>
        </div>
        <div>
          <label class="form-label">Category</label>
          <select class="form-input" name="category_id">
            <option value="">— Select —</option>
            ${(categories || []).map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.code)})</option>`).join('')}
          </select>
          ${!categories?.length ? '<p style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-1)">No categories configured. Ask an admin to set them up.</p>' : ''}
        </div>
        <div>
          <label class="form-label">Description</label>
          <textarea class="form-input" name="description" rows="2" placeholder="Optional details..."></textarea>
        </div>
        <div>
          <label class="form-label">Receipt</label>
          <input class="form-input" name="receipt" type="file" accept="image/*,.pdf">
        </div>
        <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-2)">
          <button type="button" class="btn btn-secondary" onclick="document.querySelector('.modal-overlay').remove()">Cancel</button>
          <button type="submit" class="btn btn-primary">Submit Expense</button>
        </div>
      </form>
    `);

    document.getElementById('expense-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const title = fd.get('title')?.trim();
      const amount = parseFloat(fd.get('amount'));
      const expense_date = fd.get('expense_date');
      const category_id = fd.get('category_id') || null;
      const description = fd.get('description')?.trim() || null;
      const receiptFile = fd.get('receipt');

      if (!title || !amount || !expense_date) { toast('Fill in required fields'); return; }

      let receipt_url = null;
      if (receiptFile?.size) {
        const path = `expenses/${org.id}/${Date.now()}_${receiptFile.name}`;
        const { error: upErr } = await sb.storage.from('documents').upload(path, receiptFile);
        if (upErr) { toast('Receipt upload failed: ' + upErr.message); return; }
        receipt_url = path;
      }

      const { data, error } = await sb.from('expenses').insert({
        org_id: org.id,
        user_id: user.id,
        category_id,
        title,
        amount,
        currency: org?.currency || 'INR',
        expense_date,
        receipt_url,
        description,
        status: 'pending'
      }).select().single();

      if (error) { toast('Failed: ' + error.message); return; }
      publishEvent('finance.expense.created', { expense_id: data.id, org_id: org.id, amount, title });
      closeModal();
      toast('Expense submitted');
      loadExpenses();
      loadStats();
    });
  });

  await Promise.all([loadStats(), loadExpenses()]);
}
