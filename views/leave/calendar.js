import sb from '../../js/supabase.js';
import { getUser, getOrg } from '../../js/auth.js';
import { esc, formatDate } from '../../js/ui.js';

export default async function leaveCalendar(container) {
  const user = getUser();
  const org = getOrg();
  if (!org) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No organization found</div></div>';
    return;
  }

  let currentMonth = new Date().getMonth();
  let currentYear = new Date().getFullYear();
  let filterDept = '';

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Team Leave Calendar</h1>
      <p class="page-subtitle">View team availability at a glance</p>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2)">
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <button class="btn btn-secondary btn-sm" id="cal-prev">&larr;</button>
          <span id="cal-month-label" style="font-weight:var(--font-weight-semibold);min-width:140px;text-align:center"></span>
          <button class="btn btn-secondary btn-sm" id="cal-next">&rarr;</button>
          <button class="btn btn-secondary btn-sm" id="cal-today" style="margin-left:var(--space-2)">Today</button>
        </div>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <select class="form-input form-input-sm" id="cal-dept-filter" style="min-width:160px">
            <option value="">All Departments</option>
          </select>
        </div>
      </div>
      <div class="card-body" id="cal-body" style="overflow-x:auto;padding:0">
        <div style="padding:var(--space-4)"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>
      </div>
      <div style="padding:var(--space-3) var(--space-4);border-top:1px solid var(--color-border);display:flex;gap:var(--space-4);flex-wrap:wrap;font-size:var(--text-xs);color:var(--color-text-secondary)">
        <span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--color-accent-light);border:1px solid var(--color-accent);vertical-align:middle;margin-right:4px"></span> Approved</span>
        <span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--color-warning-light);border:1px solid var(--color-warning);vertical-align:middle;margin-right:4px"></span> Pending</span>
        <span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--color-success-light);border:1px solid var(--color-success);vertical-align:middle;margin-right:4px"></span> Holiday</span>
        <span style="color:var(--color-text-tertiary)">Sat/Sun dimmed</span>
      </div>
    </div>
  `;

  const { data: depts } = await sb.from('departments').select('id, name').eq('org_id', org.id).order('name');
  const deptSelect = document.getElementById('cal-dept-filter');
  (depts || []).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    deptSelect.appendChild(opt);
  });

  async function renderCalendar() {
    const calBody = document.getElementById('cal-body');
    document.getElementById('cal-month-label').textContent =
      new Date(currentYear, currentMonth).toLocaleString('en', { month: 'long', year: 'numeric' });

    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const monthStart = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
    const monthEnd = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    let userQuery = sb.from('users').select('id, full_name, designation, department_id, department:department_id(name)').eq('org_id', org.id).eq('status', 'active').order('full_name');
    if (filterDept) userQuery = userQuery.eq('department_id', filterDept);
    const { data: users } = await userQuery;
    const teamUsers = users || [];

    const { data: leaves } = await sb.from('leave_requests')
      .select('user_id, start_date, end_date, days, status, leave_type:leave_type_id(name, code)')
      .eq('org_id', org.id)
      .in('status', ['approved', 'pending'])
      .lte('start_date', monthEnd)
      .gte('end_date', monthStart);

    const { data: holidays } = await sb.from('holidays')
      .select('date, name')
      .eq('org_id', org.id)
      .eq('year', currentYear);

    const holidayMap = {};
    (holidays || []).forEach(h => { holidayMap[h.date] = h.name; });

    const leaveMap = {};
    (leaves || []).forEach(l => {
      const start = new Date(l.start_date);
      const end = new Date(l.end_date);
      const d = new Date(start);
      while (d <= end) {
        const ds = d.toISOString().split('T')[0];
        if (!leaveMap[l.user_id]) leaveMap[l.user_id] = {};
        leaveMap[l.user_id][ds] = { status: l.status, type: l.leave_type?.code || '—', name: l.leave_type?.name || '—' };
        d.setDate(d.getDate() + 1);
      }
    });

    if (!teamUsers.length) {
      calBody.innerHTML = '<div style="padding:var(--space-6);text-align:center;color:var(--color-text-secondary)">No employees found for the selected filter.</div>';
      return;
    }

    const dayHeaders = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(currentYear, currentMonth, d);
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      const ds = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isHoliday = !!holidayMap[ds];
      dayHeaders.push({ day: d, dayName: dt.toLocaleString('en', { weekday: 'narrow' }), isWeekend, isHoliday, date: ds, holidayName: holidayMap[ds] });
    }

    calBody.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:var(--text-xs);min-width:${teamUsers.length > 0 ? 200 + daysInMonth * 32 : 400}px">
        <thead>
          <tr>
            <th style="padding:6px 8px;text-align:left;position:sticky;left:0;background:var(--color-bg-secondary);z-index:2;min-width:160px;border-bottom:1px solid var(--color-border)">Employee</th>
            ${dayHeaders.map(h => `<th style="padding:4px 2px;text-align:center;border-bottom:1px solid var(--color-border);${h.isWeekend ? 'color:var(--color-text-tertiary);' : ''}${h.isHoliday ? 'background:var(--color-success-light);' : ''}" title="${h.isHoliday ? esc(h.holidayName) : ''}">
              <div style="font-size:10px;font-weight:var(--font-weight-normal);color:var(--color-text-tertiary)">${h.dayName}</div>
              <div>${h.day}</div>
            </th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${teamUsers.map(u => `<tr>
            <td style="padding:6px 8px;position:sticky;left:0;background:var(--color-surface);z-index:1;border-bottom:1px solid var(--color-border-light);white-space:nowrap">
              <div style="font-weight:var(--font-weight-medium)">${esc(u.full_name)}</div>
              <div style="font-size:10px;color:var(--color-text-tertiary)">${esc(u.department?.name || '')}</div>
            </td>
            ${dayHeaders.map(h => {
              const leave = leaveMap[u.id]?.[h.date];
              let bg = '';
              let border = '';
              let title = '';
              let content = '';
              if (leave) {
                if (leave.status === 'approved') {
                  bg = 'var(--color-accent-light)';
                  border = '1px solid var(--color-accent)';
                } else {
                  bg = 'var(--color-warning-light)';
                  border = '1px solid var(--color-warning)';
                }
                title = `${leave.name} (${leave.status})`;
                content = leave.type;
              } else if (h.isHoliday) {
                bg = 'var(--color-success-light)';
                title = h.holidayName;
                content = 'H';
              }
              const dim = h.isWeekend && !leave ? 'background:var(--color-bg-tertiary);' : '';
              return `<td style="padding:2px;text-align:center;border-bottom:1px solid var(--color-border-light);${dim}" title="${esc(title)}">
                ${content ? `<div style="background:${bg};${border ? 'border:' + border + ';' : ''}border-radius:2px;padding:1px 2px;font-size:9px;font-weight:var(--font-weight-medium);line-height:1.4">${content}</div>` : ''}
              </td>`;
            }).join('')}
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  document.getElementById('cal-prev').addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar();
  });
  document.getElementById('cal-today').addEventListener('click', () => {
    currentMonth = new Date().getMonth();
    currentYear = new Date().getFullYear();
    renderCalendar();
  });
  deptSelect.addEventListener('change', () => {
    filterDept = deptSelect.value;
    renderCalendar();
  });

  await renderCalendar();
}
