import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, formatDate } from '../../js/ui.js';

export default async function expenseReport(container) {
  const org = getOrg();
  const membership = getMembership();
  if (!org || !['owner', 'admin', 'manager'].includes(membership?.role)) {
    container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3></div>';
    return;
  }

  container.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-secondary)">Loading expense report...</div>';

  const [{ data: expenses }, { data: categories }] = await Promise.all([
    sb.from('expenses').select('*, category:category_id(name, code), submitter:user_id(full_name)').eq('org_id', org.id).order('expense_date', { ascending: false }),
    sb.from('expense_categories').select('id, name, code').eq('org_id', org.id).eq('is_active', true).order('name'),
  ]);

  const all = expenses || [];
  const cats = categories || [];
  const currency = org.currency || 'INR';

  const totalAmount = all.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const pending = all.filter(e => e.status === 'pending');
  const pendingAmount = pending.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const approved = all.filter(e => e.status === 'approved');
  const approvedAmount = approved.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const reimbursed = all.filter(e => e.status === 'reimbursed');
  const reimbursedAmount = reimbursed.reduce((s, e) => s + parseFloat(e.amount || 0), 0);

  const byCat = {};
  cats.forEach(c => byCat[c.id] = { name: c.name, code: c.code, total: 0, count: 0 });
  byCat['uncategorized'] = { name: 'Uncategorized', code: '—', total: 0, count: 0 };
  all.forEach(e => {
    const key = e.category_id || 'uncategorized';
    if (!byCat[key]) byCat[key] = { name: '—', code: '—', total: 0, count: 0 };
    byCat[key].total += parseFloat(e.amount || 0);
    byCat[key].count++;
  });
  const catEntries = Object.values(byCat).filter(c => c.count > 0).sort((a, b) => b.total - a.total);
  const maxCatTotal = Math.max(...catEntries.map(c => c.total), 1);

  const byMonth = {};
  all.forEach(e => {
    const m = e.expense_date?.substring(0, 7) || 'unknown';
    if (!byMonth[m]) byMonth[m] = { total: 0, count: 0 };
    byMonth[m].total += parseFloat(e.amount || 0);
    byMonth[m].count++;
  });
  const months = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6).reverse();
  const maxMonthTotal = Math.max(...months.map(([, v]) => v.total), 1);

  const recent = all.slice(0, 15);

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6);flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-1)">Expense Report</h1>
        <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0">Expense analytics and category breakdown</p>
      </div>
      <button class="btn btn-secondary btn-sm" id="expense-export">Export CSV</button>
    </div>

    <div class="stat-grid" style="margin-bottom:var(--space-6)">
      <div class="card"><div class="card-body" style="text-align:center">
        <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-text-primary)">${currency} ${totalAmount.toLocaleString()}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Total Expenses</div>
      </div></div>
      <div class="card"><div class="card-body" style="text-align:center">
        <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-warning)">${currency} ${pendingAmount.toLocaleString()}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Pending (${pending.length})</div>
      </div></div>
      <div class="card"><div class="card-body" style="text-align:center">
        <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-success)">${currency} ${approvedAmount.toLocaleString()}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Approved (${approved.length})</div>
      </div></div>
      <div class="card"><div class="card-body" style="text-align:center">
        <div style="font-size:var(--text-3xl);font-weight:var(--font-weight-bold);color:var(--color-info)">${currency} ${reimbursedAmount.toLocaleString()}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">Reimbursed (${reimbursed.length})</div>
      </div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);margin-bottom:var(--space-6)">
      <div class="card">
        <div class="card-body">
          <h3 style="font-size:var(--text-md);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-4)">By Category</h3>
          <div style="display:grid;gap:var(--space-3)">
            ${catEntries.map(c => `
              <div style="display:flex;align-items:center;gap:var(--space-3)">
                <div style="width:100px;font-size:var(--text-sm);color:var(--color-text-secondary);text-align:right;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.name)}">${esc(c.name)}</div>
                <div style="flex:1;height:24px;background:var(--color-bg-secondary);border-radius:var(--radius-md);overflow:hidden;position:relative">
                  <div style="height:100%;width:${(c.total / maxCatTotal) * 100}%;background:var(--color-accent);border-radius:var(--radius-md);min-width:${c.total ? '2px' : '0'}"></div>
                  <span style="position:absolute;right:var(--space-2);top:50%;transform:translateY(-50%);font-size:var(--text-xs);font-weight:var(--font-weight-medium)">${currency} ${c.total.toLocaleString()}</span>
                </div>
              </div>
            `).join('') || '<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">No expenses yet</div>'}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-body">
          <h3 style="font-size:var(--text-md);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-4)">Monthly Trend</h3>
          <div style="display:grid;gap:var(--space-3)">
            ${months.map(([m, v]) => {
              const label = new Date(m + '-01').toLocaleDateString('en', { month: 'short', year: '2-digit' });
              return `
              <div style="display:flex;align-items:center;gap:var(--space-3)">
                <div style="width:60px;font-size:var(--text-sm);color:var(--color-text-secondary);text-align:right;flex-shrink:0">${label}</div>
                <div style="flex:1;height:24px;background:var(--color-bg-secondary);border-radius:var(--radius-md);overflow:hidden;position:relative">
                  <div style="height:100%;width:${(v.total / maxMonthTotal) * 100}%;background:var(--color-info);border-radius:var(--radius-md);min-width:2px"></div>
                  <span style="position:absolute;right:var(--space-2);top:50%;transform:translateY(-50%);font-size:var(--text-xs);font-weight:var(--font-weight-medium)">${currency} ${v.total.toLocaleString()}</span>
                </div>
              </div>`;
            }).join('') || '<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">No data yet</div>'}
          </div>
        </div>
      </div>
    </div>

    ${recent.length ? `
    <div class="card">
      <div class="card-body">
        <h3 style="font-size:var(--text-md);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-4)">Recent Expenses</h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Date</th><th>Title</th><th>Submitted By</th><th>Category</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>${recent.map(e => {
            const statusMap = { pending: 'warning', approved: 'success', rejected: 'error', reimbursed: 'info' };
            return `<tr>
              <td style="font-size:var(--text-sm)">${e.expense_date ? formatDate(e.expense_date) : '—'}</td>
              <td style="font-weight:var(--font-weight-medium);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.title)}</td>
              <td style="font-size:var(--text-sm)">${esc(e.submitter?.full_name || '—')}</td>
              <td>${e.category ? `<span class="badge badge-neutral">${esc(e.category.code)}</span>` : '—'}</td>
              <td style="font-weight:var(--font-weight-semibold)">${currency} ${parseFloat(e.amount).toLocaleString()}</td>
              <td><span class="badge badge-${statusMap[e.status] || 'neutral'}">${esc(e.status)}</span></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
    </div>` : ''}`;

  document.getElementById('expense-export')?.addEventListener('click', () => {
    if (!all.length) return;
    const headers = 'Date,Title,Submitted By,Category,Amount,Currency,Status\n';
    const rows = all.map(e =>
      `${e.expense_date || ''},"${(e.title || '').replace(/"/g, '""')}","${e.submitter?.full_name || '—'}","${e.category?.name || '—'}",${e.amount},${e.currency || currency},${e.status}`
    ).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `expense_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
