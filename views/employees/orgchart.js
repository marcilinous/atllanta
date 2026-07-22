import sb from '../../js/supabase.js';
import { getOrg } from '../../js/auth.js';
import { esc, initials, avColor } from '../../js/ui.js';
import { navigate } from '../../js/router.js';

export default async function orgChart(container) {
  const org = getOrg();
  if (!org) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No organization found</div></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">
      <div>
        <h1 class="page-title">Organization Chart</h1>
        <p class="page-subtitle">Team hierarchy based on reporting structure</p>
      </div>
      <button class="btn btn-secondary" id="back-to-employees">Back to Directory</button>
    </div>
    <div id="orgchart-content" style="padding:var(--space-4);color:var(--color-text-secondary)">Loading org chart...</div>
  `;

  document.getElementById('back-to-employees').addEventListener('click', () => navigate('employees'));

  const { data: employees, error } = await sb
    .from('users')
    .select('id, full_name, email, designation, role, status, reporting_manager_id, department:department_id(name)')
    .eq('org_id', org.id)
    .eq('status', 'active')
    .order('full_name');

  if (error) {
    const { data: members, error: membersErr } = await sb
      .from('memberships')
      .select('id, user_id, full_name, email, role')
      .eq('organization_id', org.id);
    if (membersErr) { console.error(membersErr); }
    if (!members?.length) {
      document.getElementById('orgchart-content').innerHTML = `<div class="empty-state"><div class="empty-state-title">No employees found</div><div class="empty-state-desc">Add employees to see the org chart.</div></div>`;
      return;
    }
    renderFlat(members.map(m => ({ id: m.user_id || m.id, full_name: m.full_name || m.email, email: m.email, role: m.role, designation: '', department: null, reporting_manager_id: null })));
    return;
  }

  if (!employees?.length) {
    document.getElementById('orgchart-content').innerHTML = `<div class="empty-state"><div class="empty-state-title">No employees found</div><div class="empty-state-desc">Add employees to see the org chart.</div></div>`;
    return;
  }

  const hasHierarchy = employees.some(e => e.reporting_manager_id);
  if (!hasHierarchy) {
    renderFlat(employees);
    return;
  }

  const byId = {};
  employees.forEach(e => byId[e.id] = { ...e, children: [] });

  const roots = [];
  employees.forEach(e => {
    if (e.reporting_manager_id && byId[e.reporting_manager_id]) {
      byId[e.reporting_manager_id].children.push(byId[e.id]);
    } else {
      roots.push(byId[e.id]);
    }
  });

  const content = document.getElementById('orgchart-content');
  content.innerHTML = `<div class="orgchart-tree">${roots.map(r => renderNode(r, 0)).join('')}</div>`;
  content.style.overflowX = 'auto';

  content.querySelectorAll('[data-emp-id]').forEach(el => {
    el.addEventListener('click', () => navigate('employees/profile?id=' + el.dataset.empId));
  });

  function renderNode(node, depth) {
    const indent = depth * 32;
    const roleColors = { owner: 'error', admin: 'warning', manager: 'info', member: 'neutral' };
    return `
      <div style="margin-left:${indent}px;margin-bottom:var(--space-1)">
        <div class="orgchart-node" data-emp-id="${node.id}" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3);border-radius:var(--radius-lg);cursor:pointer;transition:background var(--transition-fast)">
          ${depth > 0 ? `<div style="width:16px;border-left:2px solid var(--color-border);border-bottom:2px solid var(--color-border);height:20px;margin-left:-16px;flex-shrink:0"></div>` : ''}
          <div style="width:40px;height:40px;border-radius:var(--radius-full);background:${avColor(node.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold);font-size:var(--text-sm);flex-shrink:0">${initials(node.full_name)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-sm)">${esc(node.full_name)}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(node.designation || node.role || '')}${node.department?.name ? ' · ' + esc(node.department.name) : ''}</div>
          </div>
          <span class="badge badge-${roleColors[node.role] || 'neutral'}" style="flex-shrink:0">${esc(node.role || 'member')}</span>
          ${node.children.length ? `<span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${node.children.length} report${node.children.length !== 1 ? 's' : ''}</span>` : ''}
        </div>
        ${node.children.map(c => renderNode(c, depth + 1)).join('')}
      </div>`;
  }

  function renderFlat(emps) {
    const byDept = {};
    emps.forEach(e => {
      const dept = e.department?.name || 'Unassigned';
      if (!byDept[dept]) byDept[dept] = [];
      byDept[dept].push(e);
    });

    const content = document.getElementById('orgchart-content');
    content.innerHTML = Object.entries(byDept).map(([dept, members]) => `
      <div style="margin-bottom:var(--space-6)">
        <h3 style="font-size:var(--text-base);font-weight:var(--font-weight-semibold);margin-bottom:var(--space-3);color:var(--color-text-secondary)">${esc(dept)}</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:var(--space-3)">
          ${members.map(e => `
            <div class="card" data-emp-id="${e.id}" style="cursor:pointer;padding:var(--space-4)">
              <div style="display:flex;align-items:center;gap:var(--space-3)">
                <div style="width:40px;height:40px;border-radius:var(--radius-full);background:${avColor(e.full_name)};display:flex;align-items:center;justify-content:center;color:white;font-weight:var(--font-weight-semibold);font-size:var(--text-sm);flex-shrink:0">${initials(e.full_name)}</div>
                <div>
                  <div style="font-weight:var(--font-weight-semibold);font-size:var(--text-sm)">${esc(e.full_name)}</div>
                  <div style="font-size:var(--text-xs);color:var(--color-text-secondary)">${esc(e.designation || e.role || '')}</div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    content.querySelectorAll('[data-emp-id]').forEach(el => {
      el.addEventListener('click', () => navigate('employees/profile?id=' + el.dataset.empId));
    });
  }
}
