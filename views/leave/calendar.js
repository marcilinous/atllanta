import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc } from '../../js/ui.js';

export default async function leaveCalendar(container) {
  const org = getOrg();
  const membership = getMembership();
  if (!org) { container.innerHTML = '<p>Please select an organization.</p>'; return; }

  const now = new Date();
  let currentMonth = now.getMonth();
  let currentYear = now.getFullYear();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Team Leave Calendar</h1>
        <p class="page-subtitle">View team leave schedule at a glance</p>
      </div>
      <div style="display:flex;gap:var(--space-2);align-items:center">
        <button class="btn btn-ghost btn-sm" id="cal-prev">&larr;</button>
        <span id="cal-month-label" style="font-weight:var(--font-weight-semibold);min-width:150px;text-align:center"></span>
        <button class="btn btn-ghost btn-sm" id="cal-next">&rarr;</button>
      </div>
    </div>
    <div class="card">
      <div class="card-body" id="cal-body" style="overflow-x:auto">
        <div class="skeleton skeleton-text"></div>
      </div>
    </div>
  `;

  async function render() {
    const label = document.getElementById('cal-month-label');
    const body = document.getElementById('cal-body');
    if (!label || !body) return;

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    label.textContent = `${monthNames[currentMonth]} ${currentYear}`;

    const startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const endDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${daysInMonth}`;

    const { data: leaves } = await sb
      .from('leave_requests')
      .select('*, requester:user_id(full_name, email), leave_type:leave_type_id(name, code)')
      .eq('status', 'approved')
      .lte('start_date', endDate)
      .gte('end_date', startDate);

    const { data: holidays } = await sb
      .from('holidays')
      .select('name, date')
      .eq('year', currentYear)
      .gte('date', startDate)
      .lte('date', endDate);

    const holidayMap = {};
    (holidays || []).forEach(h => { holidayMap[h.date] = h.name; });

    if (!leaves?.length && !holidays?.length) {
      body.innerHTML = `<div style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-8)">No approved leaves or holidays this month</div>`;
      return;
    }

    const people = {};
    (leaves || []).forEach(l => {
      const name = l.requester?.full_name || l.requester?.email || 'Unknown';
      if (!people[name]) people[name] = [];
      const s = new Date(l.start_date);
      const e = new Date(l.end_date);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) {
          people[name].push({ date: ds, type: l.leave_type?.code || '?' });
        }
      }
    });

    const dayHeaders = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(currentYear, currentMonth, d);
      const day = dt.toLocaleDateString('en', { weekday: 'short' }).charAt(0);
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isHoliday = !!holidayMap[dateStr];
      dayHeaders.push(`<th style="padding:4px 6px;font-size:10px;text-align:center;${isWeekend || isHoliday ? 'background:var(--color-bg-tertiary);' : ''}" title="${isHoliday ? holidayMap[dateStr] : ''}">${d}<br>${day}</th>`);
    }

    const rows = Object.entries(people).map(([name, dates]) => {
      const dateSet = {};
      dates.forEach(d => { dateSet[d.date] = d.type; });
      const cells = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const lt = dateSet[dateStr];
        const isHoliday = !!holidayMap[dateStr];
        const bg = lt ? 'var(--color-accent-light)' : isHoliday ? 'var(--color-warning-light)' : '';
        cells.push(`<td style="padding:4px 6px;text-align:center;font-size:10px;background:${bg}">${lt || (isHoliday ? 'H' : '')}</td>`);
      }
      return `<tr><td style="padding:4px 8px;font-size:var(--text-sm);white-space:nowrap;font-weight:var(--font-weight-medium)">${esc(name)}</td>${cells.join('')}</tr>`;
    });

    body.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:var(--text-xs)">
        <thead><tr><th style="padding:4px 8px;text-align:left;font-size:var(--text-sm)">Employee</th>${dayHeaders.join('')}</tr></thead>
        <tbody>${rows.length ? rows.join('') : `<tr><td colspan="${daysInMonth + 1}" style="text-align:center;padding:var(--space-4);color:var(--color-text-tertiary)">No leaves this month</td></tr>`}</tbody>
      </table>
    `;
  }

  document.getElementById('cal-prev')?.addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    render();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    render();
  });

  render();
}
