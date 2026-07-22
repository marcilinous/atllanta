export default async function financeView(container) {
  container.innerHTML = `
    <div style="padding:var(--space-6);max-width:600px;margin:0 auto">
      <div class="empty-state">
        <svg width="48" height="48" fill="none" stroke="var(--color-text-tertiary)" stroke-width="1.5" viewBox="0 0 24 24">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
        <h3>Finance</h3>
        <p>Payroll, expenses, and financial reports are coming soon.</p>
      </div>
      <div class="card" style="margin-top:var(--space-6)">
        <div class="card-body">
          <h4 class="card-title" style="margin:0 0 var(--space-3);font-size:var(--text-base)">Planned Features</h4>
          <ul style="margin:0;padding:0 0 0 var(--space-5);color:var(--color-text-secondary);font-size:var(--text-sm);display:flex;flex-direction:column;gap:var(--space-2)">
            <li>Payroll processing</li>
            <li>Expense management</li>
            <li>Reimbursements</li>
            <li>Financial reports</li>
          </ul>
        </div>
      </div>
    </div>`;
}
