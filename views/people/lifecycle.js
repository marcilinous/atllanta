import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate, initials, avColor } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

const STAGES = ['onboarding', 'probation', 'confirmed', 'on_notice', 'exited'];

function stageBadge(s) {
  const map = { onboarding: 'info', probation: 'warning', confirmed: 'success', on_notice: 'error', exited: 'neutral' };
  return `<span class="badge badge-${map[s] || 'neutral'}">${esc(s)}</span>`;
}

export default async function lifecycleView(container) {
  const user = await getUser();
  const org = await getOrg();
  const membership = await getMembership();
  const role = membership?.role || 'member';
  const isAdmin = ['owner', 'admin'].includes(role);

  if (!isAdmin) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <h3 class="empty-state-title">Access Denied</h3>
        <p class="empty-state-desc">Employee lifecycle management is available to admins only.</p>
      </div>`;
    return;
  }

  let activeStage = 'all';

  async function loadEmployees() {
    const { data, error } = await sb
      .from('users')
      .select('id, full_name, email, designation, status, date_of_joining, department:department_id(name)')
      .order('full_name');
    if (error) { toast(error.message, 'error'); return []; }
    return data || [];
  }

  async function loadEvents() {
    const { data, error } = await sb
      .from('events')
      .select('*')
      .like('event_type', 'people.lifecycle.%')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return [];
    return data || [];
  }

  function getLifecycleStage(emp, events) {
    const empEvents = events.filter(e => e.payload?.employee_id === emp.id);
    if (empEvents.length) {
      const latest = empEvents[0];
      if (latest.payload?.stage) return latest.payload.stage;
    }
    if (emp.status === 'exited') return 'exited';
    if (emp.status === 'on_notice') return 'on_notice';
    if (!emp.date_of_joining) return 'onboarding';
    const doj = new Date(emp.date_of_joining);
    const months = (Date.now() - doj.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (months < 6) return 'probation';
    return 'confirmed';
  }

  async function render() {
    const [employees, events] = await Promise.all([loadEmployees(), loadEvents()]);

    const enriched = employees.map(emp => ({
      ...emp,
      stage: getLifecycleStage(emp, events)
    }));

    const filtered = activeStage === 'all' ? enriched : enriched.filter(e => e.stage === activeStage);

    const counts = {};
    STAGES.forEach(s => { counts[s] = enriched.filter(e => e.stage === s).length; });

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6);flex-wrap:wrap;gap:var(--space-3)">
        <div>
          <h1 class="page-title">Employee Lifecycle</h1>
          <p class="page-subtitle">Track employee journey from onboarding to exit</p>
        </div>
      </div>

      <div class="stat-grid" style="margin-bottom:var(--space-6)">
        ${STAGES.map(s => `
          <div class="stat-card" style="cursor:pointer;${activeStage === s ? 'border-color:var(--color-accent)' : ''}" data-stage="${s}">
            <div class="stat-label">${esc(s.replace('_', ' '))}</div>
            <div class="stat-value">${counts[s]}</div>
          </div>
        `).join('')}
      </div>

      <div class="tabs" style="margin-bottom:var(--space-4)">
        <button class="tab ${activeStage === 'all' ? 'active' : ''}" data-stage="all">All (${enriched.length})</button>
        ${STAGES.map(s => `<button class="tab ${activeStage === s ? 'active' : ''}" data-stage="${s}">${esc(s.replace('_', ' '))} (${counts[s]})</button>`).join('')}
      </div>

      <div id="lifecycle-list"></div>
    `;

    const listEl = container.querySelector('#lifecycle-list');

    if (!filtered.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👥</div>
          <h3 class="empty-state-title">No employees in this stage</h3>
        </div>`;
    } else {
      listEl.innerHTML = `
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Employee</th><th>Department</th><th>Designation</th><th>Joined</th><th>Stage</th><th></th>
          </tr></thead>
          <tbody>${filtered.map(emp => {
            const bg = avColor(emp.full_name || emp.email);
            const ini = initials(emp.full_name || emp.email);
            return `<tr>
              <td>
                <div style="display:flex;align-items:center;gap:var(--space-2)">
                  <div style="width:28px;height:28px;border-radius:var(--radius-full);background:${bg};display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:var(--font-weight-semibold);flex-shrink:0">${esc(ini)}</div>
                  <div>
                    <div style="font-weight:var(--font-weight-medium)">${esc(emp.full_name)}</div>
                    <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${esc(emp.email)}</div>
                  </div>
                </div>
              </td>
              <td>${esc(emp.department?.name || '--')}</td>
              <td>${esc(emp.designation || '--')}</td>
              <td>${emp.date_of_joining ? formatDate(emp.date_of_joining) : '--'}</td>
              <td>${stageBadge(emp.stage)}</td>
              <td><button class="btn btn-ghost btn-sm change-stage-btn" data-id="${emp.id}" data-name="${esc(emp.full_name)}" data-current="${emp.stage}">Change</button></td>
            </tr>`;
          }).join('')}
          </tbody>
        </table></div>`;
    }

    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeStage = tab.dataset.stage;
        render();
      });
    });

    container.querySelectorAll('.stat-card[data-stage]').forEach(card => {
      card.addEventListener('click', () => {
        activeStage = card.dataset.stage;
        render();
      });
    });

    container.querySelectorAll('.change-stage-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const empId = btn.dataset.id;
        const empName = btn.dataset.name;
        const current = btn.dataset.current;

        openModal('Update Stage — ' + empName, `
          <form id="stage-form">
            <div class="form-group">
              <label class="form-label">New Stage</label>
              <select class="form-input" name="stage" required>
                ${STAGES.map(s => `<option value="${s}" ${s === current ? 'selected' : ''}>${esc(s.replace('_', ' '))}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Notes</label>
              <textarea class="form-input" name="notes" rows="3" placeholder="Optional notes about this transition"></textarea>
            </div>
            <div style="display:flex;gap:var(--space-3);justify-content:flex-end;margin-top:var(--space-4)">
              <button type="button" class="btn btn-secondary" id="cancel-stage">Cancel</button>
              <button type="submit" class="btn btn-primary">Update</button>
            </div>
          </form>
        `);

        document.getElementById('cancel-stage').addEventListener('click', closeModal);
        document.getElementById('stage-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const newStage = fd.get('stage');
          const notes = fd.get('notes') || '';

          if (newStage === 'exited' || newStage === 'on_notice') {
            const statusMap = { exited: 'exited', on_notice: 'on_notice' };
            await sb.from('users').update({ status: statusMap[newStage] }).eq('id', empId);
          } else if (current === 'exited' || current === 'on_notice') {
            await sb.from('users').update({ status: 'active' }).eq('id', empId);
          }

          await publishEvent('people.lifecycle.updated', {
            employee_id: empId,
            employee_name: empName,
            stage: newStage,
            previous_stage: current,
            notes
          });

          toast('Stage updated');
          closeModal();
          await render();
        });
      });
    });
  }

  await render();
}
