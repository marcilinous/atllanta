import sb from '../../js/supabase.js';
import { getUser, getOrg } from '../../js/auth.js';
import { esc } from '../../js/ui.js';

export default async function leaveBalances(container) {
  const org = getOrg();
  const user = getUser();
  if (!org || !user) { container.innerHTML = '<p>Please log in.</p>'; return; }

  const year = new Date().getFullYear();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">My Leave Balances</h1>
        <p class="page-subtitle">Leave allocation and usage for ${year}</p>
      </div>
    </div>
    <div id="bal-content">
      <div class="skeleton skeleton-text" style="width:60%"></div>
      <div class="skeleton skeleton-text" style="width:80%"></div>
    </div>
  `;

  const { data: balances } = await sb
    .from('leave_balances')
    .select('*, leave_type:leave_type_id(name, code, is_paid)')
    .eq('user_id', user.id)
    .eq('year', year);

  const { data: pending } = await sb
    .from('leave_requests')
    .select('leave_type_id, days')
    .eq('user_id', user.id)
    .eq('status', 'pending');

  const pendingByType = {};
  (pending || []).forEach(p => {
    pendingByType[p.leave_type_id] = (pendingByType[p.leave_type_id] || 0) + parseFloat(p.days);
  });

  const el = document.getElementById('bal-content');
  if (!el) return;

  if (!balances?.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-title">No leave balances</div><p>Leave types haven't been configured yet. Contact your admin.</p></div>`;
    return;
  }

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--space-4)">
      ${balances.map(b => {
        const total = parseFloat(b.opening_balance) + parseFloat(b.accrued);
        const used = parseFloat(b.used) || 0;
        const pendingDays = pendingByType[b.leave_type_id] || 0;
        const available = parseFloat(b.balance) || 0;
        const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
        return `
          <div class="card">
            <div class="card-body">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
                <div>
                  <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-md)">${esc(b.leave_type?.name || '—')}</div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(b.leave_type?.code || '')} ${b.leave_type?.is_paid ? '· Paid' : '· Unpaid'}</div>
                </div>
                <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);color:var(--color-accent)">${available}</div>
              </div>
              <div style="background:var(--color-bg-tertiary);border-radius:var(--radius-full);height:8px;margin-bottom:var(--space-3)">
                <div style="background:var(--color-accent);height:100%;border-radius:var(--radius-full);width:${pct}%;transition:width var(--transition-normal)"></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-2);font-size:var(--text-xs);color:var(--color-text-secondary)">
                <div>Total<br><strong style="color:var(--color-text-primary)">${total}</strong></div>
                <div>Used<br><strong style="color:var(--color-error)">${used}</strong></div>
                <div>Pending<br><strong style="color:var(--color-warning)">${pendingDays}</strong></div>
              </div>
            </div>
          </div>`;
      }).join('')}
    </div>
  `;
}
