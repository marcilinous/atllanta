import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, initials, avColor } from '../../js/ui.js';

export default async function teamPlanner(container) {
  const org = getOrg();
  const membership = getMembership();
  if (!org || !['owner', 'admin', 'manager'].includes(membership?.role)) {
    container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3></div>';
    return;
  }

  const today = new Date();
  let viewWeekStart = new Date(today);
  viewWeekStart.setDate(today.getDate() - today.getDay() + 1);
  viewWeekStart.setHours(0, 0, 0, 0);
  let filterDept = '';

  const { data: depts } = await sb.from('departments').select('id, name').eq('org_id', org.id).order('name');

  async function render() {
    const weekEnd = new Date(viewWeekStart);
    weekEnd.setDate(viewWeekStart.getDate() + 6);

    const startStr = fmt(viewWeekStart);
    const endStr = fmt(weekEnd);
    const weekLabel = `${viewWeekStart.toLocaleDateString('en', { month: 'short', day: 'numeric' })} — ${weekEnd.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    let userQ = sb.from('users').select('id, full_name, department:department_id(name)')
      .eq('org_id', org.id).eq('status', 'active').order('full_name');
    if (filterDept) userQ = userQ.eq('department_id', filterDept);

    const [{ data: users }, { data: leaves }, { data: attendance }, { data: holidays }] = await Promise.all([
      userQ,
      sb.from('leave_requests').select('user_id, start_date, end_date, days, status, leave_type:leave_type_id(code, name)')
        .eq('org_id', org.id).eq('status', 'approved').lte('start_date', endStr).gte('end_date', startStr),
      sb.from('attendance').select('user_id, date, status')
        .eq('org_id', org.id).gte('date', startStr).lte('date', endStr),
      sb.from('holidays').select('name, date, is_optional')
        .eq('org_id', org.id).gte('date', startStr).lte('date', endStr),
    ]);

    const team = users || [];
    const leaveList = leaves || [];
    const attList = attendance || [];
    const holidayList = holidays || [];

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(viewWeekStart);
      d.setDate(viewWeekStart.getDate() + i);
      const dateStr = fmt(d);
      const hol = holidayList.find(h => h.date === dateStr);
      days.push({
        date: d,
        dateStr,
        dayName: d.toLocaleDateString('en', { weekday: 'short' }),
        dayNum: d.getDate(),
        month: d.toLocaleDateString('en', { month: 'short' }),
        isToday: dateStr === fmt(today),
        isSunday: d.getDay() === 0,
        isSaturday: d.getDay() === 6,
        holiday: hol,
      });
    }

    const leaveMap = {};
    leaveList.forEach(l => {
      const start = new Date(l.start_date);
      const end = new Date(l.end_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const ds = fmt(d);
        if (!leaveMap[l.user_id]) leaveMap[l.user_id] = {};
        leaveMap[l.user_id][ds] = l.leave_type?.code || 'LV';
      }
    });

    const attMap = {};
    attList.forEach(a => {
      if (!attMap[a.user_id]) attMap[a.user_id] = {};
      attMap[a.user_id][a.date] = a.status;
    });

    const isThisWeek = fmt(viewWeekStart) === fmt((() => { const d = new Date(today); d.setDate(today.getDate() - today.getDay() + 1); return d; })());

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6);flex-wrap:wrap;gap:var(--space-3)">
        <div>
          <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);margin:0 0 var(--space-1)">Team Planner</h1>
          <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0">Weekly view of team availability</p>
        </div>
        <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
          <select class="form-input form-input-sm" id="planner-dept" style="min-width:150px">
            <option value="">All Departments</option>
            ${(depts || []).map(d => `<option value="${d.id}" ${filterDept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
          </select>
          <div style="display:flex;align-items:center;gap:var(--space-2)">
            <button class="btn btn-secondary btn-sm" id="planner-prev">&larr;</button>
            <span style="font-weight:var(--font-weight-semibold);min-width:180px;text-align:center;font-size:var(--text-sm)">${weekLabel}</span>
            <button class="btn btn-secondary btn-sm" id="planner-next">&rarr;</button>
          </div>
          ${!isThisWeek ? `<button class="btn btn-secondary btn-sm" id="planner-today">Today</button>` : ''}
        </div>
      </div>

      <div class="card">
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;min-width:700px">
            <thead>
              <tr>
                <th style="padding:var(--space-3);text-align:left;position:sticky;left:0;background:var(--color-bg-secondary);z-index:2;min-width:180px;border-bottom:2px solid var(--color-border)">Employee</th>
                ${days.map(d => `
                  <th style="padding:var(--space-2) var(--space-3);text-align:center;border-bottom:2px solid var(--color-border);min-width:90px;
                    ${d.isToday ? 'background:var(--color-accent-light);' : d.isSunday || d.isSaturday ? 'background:var(--color-bg-tertiary);' : ''}">
                    <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);font-weight:var(--font-weight-normal)">${d.dayName}</div>
                    <div style="font-size:var(--text-md);font-weight:var(--font-weight-semibold);${d.isToday ? 'color:var(--color-accent)' : ''}">${d.dayNum}</div>
                    <div style="font-size:9px;color:var(--color-text-tertiary)">${d.month}</div>
                    ${d.holiday ? `<div style="font-size:9px;color:var(--color-accent);font-weight:var(--font-weight-medium);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px" title="${esc(d.holiday.name)}">${esc(d.holiday.name)}</div>` : ''}
                  </th>
                `).join('')}
              </tr>
            </thead>
            <tbody>
              ${team.map(u => `
                <tr>
                  <td style="padding:var(--space-2) var(--space-3);position:sticky;left:0;background:var(--color-surface);z-index:1;border-bottom:1px solid var(--color-border-light)">
                    <div style="display:flex;align-items:center;gap:var(--space-2)">
                      <div style="width:28px;height:28px;border-radius:var(--radius-full);background:${avColor(u.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:var(--font-weight-semibold);flex-shrink:0">${initials(u.full_name)}</div>
                      <div>
                        <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(u.full_name)}</div>
                        <div style="font-size:9px;color:var(--color-text-tertiary)">${esc(u.department?.name || '')}</div>
                      </div>
                    </div>
                  </td>
                  ${days.map(d => {
                    const leave = leaveMap[u.id]?.[d.dateStr];
                    const att = attMap[u.id]?.[d.dateStr];
                    const isHoliday = !!d.holiday;
                    const isOff = d.isSunday || d.isSaturday;

                    let content = '';
                    let bg = '';
                    let color = '';

                    if (leave) {
                      bg = 'var(--color-info-light)';
                      color = 'var(--color-info)';
                      content = `<span style="font-size:var(--text-xs);font-weight:var(--font-weight-semibold)">${esc(leave)}</span>`;
                    } else if (isHoliday) {
                      bg = 'var(--color-accent-light)';
                      content = '<span style="font-size:10px">🏖️</span>';
                    } else if (isOff) {
                      bg = 'var(--color-bg-tertiary)';
                      content = '';
                    } else if (att === 'present') {
                      content = '<span style="color:var(--color-success);font-size:var(--text-xs);font-weight:var(--font-weight-semibold)">P</span>';
                    } else if (att === 'late') {
                      bg = 'var(--color-warning-light)';
                      color = 'var(--color-warning)';
                      content = '<span style="font-size:var(--text-xs);font-weight:var(--font-weight-semibold)">L</span>';
                    } else if (att === 'absent') {
                      bg = 'var(--color-error-light)';
                      color = 'var(--color-error)';
                      content = '<span style="font-size:var(--text-xs);font-weight:var(--font-weight-semibold)">A</span>';
                    } else if (att === 'half_day') {
                      bg = 'var(--color-warning-light)';
                      content = '<span style="font-size:var(--text-xs);font-weight:var(--font-weight-semibold)">H</span>';
                    } else if (att === 'on_leave') {
                      bg = 'var(--color-info-light)';
                      color = 'var(--color-info)';
                      content = '<span style="font-size:var(--text-xs);font-weight:var(--font-weight-semibold)">LV</span>';
                    } else if (d.isToday) {
                      bg = 'var(--color-accent-light)';
                    }

                    return `<td style="padding:var(--space-1);text-align:center;border-bottom:1px solid var(--color-border-light);${bg ? 'background:' + bg + ';' : ''}${color ? 'color:' + color + ';' : ''}">${content}</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div style="display:flex;gap:var(--space-4);margin-top:var(--space-4);flex-wrap:wrap;font-size:var(--text-xs);color:var(--color-text-secondary)">
        <span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--color-success);vertical-align:middle;margin-right:4px"></span> Present</span>
        <span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--color-warning-light);border:1px solid var(--color-warning);vertical-align:middle;margin-right:4px"></span> Late</span>
        <span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--color-error-light);border:1px solid var(--color-error);vertical-align:middle;margin-right:4px"></span> Absent</span>
        <span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--color-info-light);border:1px solid var(--color-info);vertical-align:middle;margin-right:4px"></span> On Leave</span>
        <span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--color-accent-light);border:1px solid var(--color-accent);vertical-align:middle;margin-right:4px"></span> Holiday</span>
        <span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--color-bg-tertiary);border:1px solid var(--color-border);vertical-align:middle;margin-right:4px"></span> Weekend</span>
      </div>`;

    document.getElementById('planner-prev').addEventListener('click', () => {
      viewWeekStart.setDate(viewWeekStart.getDate() - 7);
      render();
    });
    document.getElementById('planner-next').addEventListener('click', () => {
      viewWeekStart.setDate(viewWeekStart.getDate() + 7);
      render();
    });
    document.getElementById('planner-today')?.addEventListener('click', () => {
      viewWeekStart = new Date(today);
      viewWeekStart.setDate(today.getDate() - today.getDay() + 1);
      viewWeekStart.setHours(0, 0, 0, 0);
      render();
    });
    document.getElementById('planner-dept').addEventListener('change', (e) => {
      filterDept = e.target.value;
      render();
    });
  }

  function fmt(d) {
    return d.toISOString().split('T')[0];
  }

  await render();
}
