import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate, initials, avColor } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { publishEvent } from '../../js/events.js';

export default async function leaveBalances(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin'].includes(membership.role);
  const isManager = membership && ['owner', 'admin', 'manager'].includes(membership.role);
  const currentYear = new Date().getFullYear();

  if (!org || !user) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Please log in</div></div>';
    return;
  }

  let viewYear = currentYear;

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Leave Balances</h1>
        <p class="page-subtitle">${isManager ? 'View and manage team leave balances' : 'Your leave balance summary'}</p>
      </div>
      <div style="display:flex;gap:var(--space-2);align-items:center">
        <a href="#/leave" class="btn btn-secondary btn-sm">Leave Dashboard</a>
        ${isAdmin ? '<button class="btn btn-primary btn-sm" id="adjust-bal-btn">Adjust Balance</button>' : ''}
      </div>
    </div>

    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="card-header"><span class="card-title">My Balances — ${currentYear}</span></div>
      <div class="card-body" id="my-balances">
        <div class="skeleton skeleton-text"></div>
      </div>
    </div>

    ${isManager ? `<div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2)">
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <button class="btn btn-secondary btn-sm" id="bal-year-prev">&larr;</button>
          <span style="font-weight:var(--font-weight-semibold);min-width:50px;text-align:center" id="bal-year-label">${viewYear}</span>
          <button class="btn btn-secondary btn-sm" id="bal-year-next">&rarr;</button>
          <span class="card-title" style="margin-left:var(--space-2)">Team Balances</span>
        </div>
        <div style="display:flex;gap:var(--space-2)">
          <select class="form-input form-input-sm" id="bal-dept-filter" style="min-width:150px">
            <option value="">All Departments</option>
          </select>
          <button class="btn btn-secondary btn-sm" id="bal-export">Export CSV</button>
        </div>
      </div>
      <div id="team-balances">
        <div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div></div>
      </div>
    </div>` : ''}
  `;

  const [myBalResult, typesResult] = await Promise.all([
    sb.from('leave_balances').select('*, leave_type:leave_type_id(name, code, is_paid)').eq('user_id', user.id).eq('year', currentYear),
    sb.from('leave_types').select('id, name, code').eq('is_active', true).order('name'),
  ]);

  const myBalances = myBalResult.data || [];
  const leaveTypes = typesResult.data || [];
  const { data: pendingReqs } = await sb.from('leave_requests').select('leave_type_id, days').eq('user_id', user.id).eq('status', 'pending');
  const pendingByType = {};
  (pendingReqs || []).forEach(p => { pendingByType[p.leave_type_id] = (pendingByType[p.leave_type_id] || 0) + parseFloat(p.days); });

  const myBalEl = document.getElementById('my-balances');
  if (!myBalances.length) {
    myBalEl.innerHTML = '<div style="color:var(--color-text-tertiary);font-size:var(--text-sm)">No leave balances configured. Contact your admin.</div>';
  } else {
    myBalEl.innerHTML = `<div style="display:flex;gap:var(--space-3);overflow-x:auto;padding-bottom:var(--space-2)">
      ${myBalances.map(b => {
        const total = parseFloat(b.opening_balance || 0) + parseFloat(b.accrued || 0);
        const used = parseFloat(b.used || 0);
        const available = parseFloat(b.balance || 0);
        const pending = pendingByType[b.leave_type_id] || 0;
        const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
        const barColor = pct > 80 ? 'var(--color-error)' : pct > 50 ? 'var(--color-warning)' : 'var(--color-success)';
        return `<div class="leave-balance-card">
          <div class="leave-bal-header">
            <span class="leave-bal-code">${esc(b.leave_type?.code || '—')}</span>
            <span class="leave-bal-avail">${available}</span>
          </div>
          <div class="leave-bal-name">${esc(b.leave_type?.name || '—')}</div>
          <div class="leave-bal-bar"><div class="leave-bal-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
          <div class="leave-bal-meta">
            <span>Used ${used}/${total}</span>
            ${pending > 0 ? `<span style="color:var(--color-warning)">${pending} pending</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  if (!isManager) return;

  const { data: depts } = await sb.from('departments').select('id, name').order('name');
  const deptSelect = document.getElementById('bal-dept-filter');
  (depts || []).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    deptSelect.appendChild(opt);
  });

  let filterDept = '';
  let teamData = [];

  async function loadTeamBalances() {
    document.getElementById('bal-year-label').textContent = viewYear;
    const teamEl = document.getElementById('team-balances');
    teamEl.innerHTML = '<div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div></div>';

    let userQuery = sb.from('users').select('id, full_name, email, department:department_id(name)').eq('status', 'active').order('full_name');
    if (filterDept) userQuery = userQuery.eq('department_id', filterDept);
    const { data: users } = await userQuery;
    const teamUsers = users || [];

    if (!teamUsers.length) {
      teamEl.innerHTML = '<div style="padding:var(--space-4);text-align:center;color:var(--color-text-tertiary)">No employees found.</div>';
      return;
    }

    const userIds = teamUsers.map(u => u.id);
    const { data: balances } = await sb.from('leave_balances')
      .select('*, leave_type:leave_type_id(name, code)')
      .in('user_id', userIds)
      .eq('year', viewYear);

    const typeCodes = [...new Set((balances || []).map(b => b.leave_type?.code).filter(Boolean))].sort();

    const byUser = {};
    (balances || []).forEach(b => {
      if (!byUser[b.user_id]) byUser[b.user_id] = {};
      byUser[b.user_id][b.leave_type?.code || '?'] = {
        total: parseFloat(b.opening_balance || 0) + parseFloat(b.accrued || 0),
        used: parseFloat(b.used || 0),
        balance: parseFloat(b.balance || 0),
      };
    });

    teamData = teamUsers.map(u => {
      const bals = byUser[u.id] || {};
      const totalUsed = Object.values(bals).reduce((s, b) => s + b.used, 0);
      const totalBal = Object.values(bals).reduce((s, b) => s + b.balance, 0);
      return { ...u, bals, totalUsed, totalBal };
    });

    teamEl.innerHTML = `<div class="table-wrap"><table class="table" style="font-size:var(--text-sm)">
      <thead><tr>
        <th style="position:sticky;left:0;background:var(--color-bg-secondary);z-index:2;min-width:180px">Employee</th>
        ${typeCodes.map(c => `<th style="text-align:center;min-width:70px">${esc(c)}<br><span style="font-size:9px;font-weight:var(--font-weight-normal);color:var(--color-text-tertiary)">used/total</span></th>`).join('')}
        <th style="text-align:center">Total Used</th>
        <th style="text-align:center">Total Balance</th>
        ${isAdmin ? '<th></th>' : ''}
      </tr></thead>
      <tbody>${teamData.map(u => `<tr>
        <td style="position:sticky;left:0;background:var(--color-surface);z-index:1">
          <div style="display:flex;align-items:center;gap:var(--space-2)">
            <div style="width:24px;height:24px;border-radius:var(--radius-full);background:${avColor(u.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-size:8px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(u.full_name)}</div>
            <div>
              <div style="font-weight:var(--font-weight-medium)">${esc(u.full_name)}</div>
              <div style="font-size:9px;color:var(--color-text-tertiary)">${esc(u.department?.name || '—')}</div>
            </div>
          </div>
        </td>
        ${typeCodes.map(c => {
          const b = u.bals[c];
          if (!b) return '<td style="text-align:center;color:var(--color-text-tertiary)">—</td>';
          const pct = b.total > 0 ? (b.used / b.total) * 100 : 0;
          const color = pct > 80 ? 'var(--color-error)' : pct > 50 ? 'var(--color-warning)' : '';
          return `<td style="text-align:center"><span style="${color ? 'color:' + color + ';font-weight:var(--font-weight-semibold)' : ''}">${b.used}</span>/${b.total}</td>`;
        }).join('')}
        <td style="text-align:center;font-weight:var(--font-weight-semibold);color:var(--color-error)">${u.totalUsed}</td>
        <td style="text-align:center;font-weight:var(--font-weight-semibold);color:var(--color-success)">${u.totalBal}</td>
        ${isAdmin ? `<td><button class="btn btn-ghost btn-sm" data-edit-bal="${u.id}" style="font-size:var(--text-xs)">Adjust</button></td>` : ''}
      </tr>`).join('')}</tbody>
    </table></div>`;

    if (isAdmin) {
      teamEl.querySelectorAll('[data-edit-bal]').forEach(btn => {
        btn.addEventListener('click', () => openAdjustModal(btn.dataset.editBal));
      });
    }
  }

  function openAdjustModal(userId) {
    const u = teamData.find(t => t.id === userId);
    if (!u) return;
    const f = document.createElement('div');
    f.innerHTML = `<div style="display:grid;gap:var(--space-4)">
      <div style="font-weight:var(--font-weight-medium);margin-bottom:var(--space-2)">Adjusting balances for ${esc(u.full_name)} (${viewYear})</div>
      <div class="form-group">
        <label class="form-label">Leave Type</label>
        <select class="form-input" id="adj-type">
          ${leaveTypes.map(t => `<option value="${t.id}">${esc(t.name)} (${esc(t.code)})</option>`).join('')}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Opening Balance</label><input type="number" class="form-input" id="adj-opening" value="0" min="0" step="0.5"></div>
        <div class="form-group"><label class="form-label">Accrued</label><input type="number" class="form-input" id="adj-accrued" value="0" min="0" step="0.5"></div>
      </div>
      <div class="form-group"><label class="form-label">Used</label><input type="number" class="form-input" id="adj-used" value="0" min="0" step="0.5"></div>
      <div class="form-group"><label class="form-label">Reason for Adjustment</label><input type="text" class="form-input" id="adj-reason" placeholder="e.g. Year-end carry forward"></div>
      <button class="btn btn-primary" id="adj-save">Save Adjustment</button>
    </div>`;
    openModal('Adjust Leave Balance', f);

    const typeSelect = f.querySelector('#adj-type');
    function loadExisting() {
      const typeId = typeSelect.value;
      const code = leaveTypes.find(t => t.id === typeId)?.code;
      const existing = u.bals[code];
      f.querySelector('#adj-opening').value = existing ? existing.total - existing.used : 0;
      f.querySelector('#adj-accrued').value = 0;
      f.querySelector('#adj-used').value = existing ? existing.used : 0;
    }
    typeSelect.addEventListener('change', loadExisting);

    f.querySelector('#adj-save').addEventListener('click', async () => {
      const typeId = typeSelect.value;
      const opening = parseFloat(f.querySelector('#adj-opening').value) || 0;
      const accrued = parseFloat(f.querySelector('#adj-accrued').value) || 0;
      const used = parseFloat(f.querySelector('#adj-used').value) || 0;
      const reason = f.querySelector('#adj-reason').value.trim();

      const { data: existing } = await sb.from('leave_balances')
        .select('id').eq('user_id', userId).eq('leave_type_id', typeId).eq('year', viewYear).maybeSingle();

      if (existing) {
        const { error } = await sb.from('leave_balances').update({
          opening_balance: opening, accrued, used,
        }).eq('id', existing.id);
        if (error) return toast(error.message);
        await logAction('leave', 'leave_balance', existing.id, 'adjusted', null, { opening_balance: opening, accrued, used, reason });
        publishEvent('leave.balance.adjusted', { user_id: userId, leave_type_id: typeId, org_id: org.id });
      } else {
        const { error } = await sb.from('leave_balances').insert({
          org_id: org.id, user_id: userId, leave_type_id: typeId, year: viewYear,
          opening_balance: opening, accrued, used,
        });
        if (error) return toast(error.message);
        await logAction('leave', 'leave_balance', null, 'created', null, { user_id: userId, leave_type_id: typeId, year: viewYear, opening_balance: opening, accrued, used, reason });
        publishEvent('leave.balance.adjusted', { user_id: userId, leave_type_id: typeId, org_id: org.id });
      }

      closeModal();
      toast('Balance adjusted');
      loadTeamBalances();
    });
  }

  if (isAdmin) {
    document.getElementById('adjust-bal-btn')?.addEventListener('click', () => {
      const f = document.createElement('div');
      f.innerHTML = `<div style="display:grid;gap:var(--space-3)">
        <div class="form-group"><label class="form-label">Select Employee</label>
          <select class="form-input" id="adj-user-select">
            ${teamData.map(u => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" id="adj-user-go">Adjust Balance</button>
      </div>`;
      openModal('Select Employee', f);
      f.querySelector('#adj-user-go').addEventListener('click', () => {
        const uid = f.querySelector('#adj-user-select').value;
        closeModal();
        if (uid) openAdjustModal(uid);
      });
    });
  }

  document.getElementById('bal-year-prev')?.addEventListener('click', () => { viewYear--; loadTeamBalances(); });
  document.getElementById('bal-year-next')?.addEventListener('click', () => { viewYear++; loadTeamBalances(); });
  deptSelect?.addEventListener('change', () => { filterDept = deptSelect.value; loadTeamBalances(); });

  document.getElementById('bal-export')?.addEventListener('click', () => {
    if (!teamData.length) return toast('No data to export');
    const typeCodes = [...new Set(teamData.flatMap(u => Object.keys(u.bals)))].sort();
    const headers = ['Employee', 'Department', ...typeCodes.flatMap(c => [`${c} Used`, `${c} Balance`]), 'Total Used', 'Total Balance'].join(',');
    const rows = teamData.map(u => {
      const cols = [
        `"${u.full_name}"`,
        `"${u.department?.name || ''}"`,
        ...typeCodes.flatMap(c => {
          const b = u.bals[c];
          return b ? [b.used, b.balance] : ['', ''];
        }),
        u.totalUsed,
        u.totalBal,
      ];
      return cols.join(',');
    }).join('\n');
    const blob = new Blob([headers + '\n' + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `leave_balances_${viewYear}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  await loadTeamBalances();
}
