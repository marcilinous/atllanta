import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, openModal, closeModal, formatDate } from '../../js/ui.js';

const TEMPLATES = [
  { key: 'offer', title: 'Offer Letter', icon: '📋', desc: 'Generate an offer letter for a new hire' },
  { key: 'experience', title: 'Experience Letter', icon: '📜', desc: 'Certificate of work experience' },
  { key: 'relieving', title: 'Relieving Letter', icon: '📤', desc: 'Relieving letter upon resignation' },
  { key: 'salary_cert', title: 'Salary Certificate', icon: '💰', desc: 'Certificate of current compensation' },
  { key: 'employment_verify', title: 'Employment Verification', icon: '✅', desc: 'Verify employment status and details' }
];

function templateBody(key, emp, org, today) {
  const name = emp.full_name || '';
  const designation = emp.designation || 'Employee';
  const doj = emp.date_of_joining ? formatDate(emp.date_of_joining) : '__________';
  const orgName = org.name || 'The Company';
  const dateStr = formatDate(today);

  const bodies = {
    offer: `Date: ${dateStr}\n\nDear ${name},\n\nWe are pleased to offer you the position of ${designation} at ${orgName}. Your expected date of joining is ${doj}.\n\nPlease review the terms and conditions enclosed and confirm your acceptance at your earliest convenience.\n\nWe look forward to welcoming you to the team.\n\nSincerely,\n${orgName}`,
    experience: `Date: ${dateStr}\n\nTo Whom It May Concern,\n\nThis is to certify that ${name} has been employed with ${orgName} as ${designation} since ${doj}.\n\nDuring their tenure, they have demonstrated excellent performance and professionalism.\n\nWe wish them all the best in their future endeavors.\n\nSincerely,\n${orgName}`,
    relieving: `Date: ${dateStr}\n\nDear ${name},\n\nThis is to confirm that you have been relieved from your duties as ${designation} at ${orgName} effective today.\n\nAll dues have been settled and you are free to join any other organization.\n\nWe wish you success in your future career.\n\nSincerely,\n${orgName}`,
    salary_cert: `Date: ${dateStr}\n\nTo Whom It May Concern,\n\nThis is to certify that ${name} is employed with ${orgName} as ${designation} since ${doj}.\n\nTheir current compensation details are as per company records.\n\nThis certificate is issued upon request for whatever purpose it may serve.\n\nSincerely,\n${orgName}`,
    employment_verify: `Date: ${dateStr}\n\nTo Whom It May Concern,\n\nThis is to verify that ${name} is currently employed at ${orgName} holding the position of ${designation}.\n\nThey have been with the organization since ${doj}.\n\nThis letter is issued upon the employee's request.\n\nSincerely,\n${orgName}`
  };
  return bodies[key] || '';
}

export default async function lettersView(container) {
  const user = await getUser();
  const org = await getOrg();
  const membership = await getMembership();
  const role = membership?.role || 'member';

  if (!['owner', 'admin'].includes(role)) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <h3 class="empty-state-title">Access Denied</h3>
        <p class="empty-state-desc">Letter generation is available to admins only.</p>
      </div>`;
    return;
  }

  async function loadUsers() {
    const { data, error } = await sb
      .from('users')
      .select('id, full_name, email, designation, date_of_joining')
      .eq('status', 'active')
      .order('full_name');
    if (error) { toast(error.message, 'error'); return []; }
    return data || [];
  }

  async function loadGenerated() {
    const { data, error } = await sb
      .from('events')
      .select('*, actor:actor_id(full_name)')
      .eq('event_type', 'people.letter.generated')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) { toast(error.message, 'error'); return []; }
    return data || [];
  }

  async function showGenerateModal(tmpl) {
    const users = await loadUsers();
    const html = `
      <form id="generate-letter-form">
        <div class="form-group">
          <label class="form-label">Employee</label>
          <select class="form-input" id="letter-employee" name="employee_id" required>
            <option value="">-- Select Employee --</option>
            ${users.map(u => `<option value="${u.id}">${esc(u.full_name)} (${esc(u.email)})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Preview</label>
          <textarea class="form-input" id="letter-preview" name="letter_body" rows="12" style="font-family:var(--font-mono);font-size:var(--text-sm);white-space:pre-wrap;" readonly placeholder="Select an employee to preview the letter"></textarea>
        </div>
        <div style="display:flex;gap:var(--space-3);justify-content:flex-end;margin-top:var(--space-4);">
          <button type="button" class="btn btn-secondary" id="cancel-letter">Cancel</button>
          <button type="submit" class="btn btn-primary">Generate</button>
        </div>
      </form>`;
    openModal(tmpl.title, html);

    const empSelect = document.getElementById('letter-employee');
    const preview = document.getElementById('letter-preview');
    const today = new Date().toISOString();

    empSelect.addEventListener('change', () => {
      const selected = users.find(u => u.id === empSelect.value);
      if (selected) {
        preview.value = templateBody(tmpl.key, selected, org, today);
      } else {
        preview.value = '';
      }
    });

    document.getElementById('cancel-letter').addEventListener('click', closeModal);
    document.getElementById('generate-letter-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const empId = empSelect.value;
      const body = preview.value;
      if (!empId) { toast('Please select an employee', 'error'); return; }
      const selected = users.find(u => u.id === empId);

      const { error } = await sb.from('events').insert({
        org_id: org.id,
        event_type: 'people.letter.generated',
        actor_id: user.id,
        payload: {
          template: tmpl.key,
          template_title: tmpl.title,
          employee_id: empId,
          employee_name: selected?.full_name || '',
          letter_body: body
        },
        status: 'completed'
      });
      if (error) { toast(error.message, 'error'); return; }
      toast('Letter generated');
      closeModal();
      await render();
    });
  }

  async function render() {
    const generated = await loadGenerated();

    container.innerHTML = `
      <div style="margin-bottom:var(--space-6);">
        <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);color:var(--color-text-primary);margin:0 0 var(--space-1);">Letters & Templates</h1>
        <p style="font-size:var(--text-base);color:var(--color-text-secondary);margin:0;">Generate employee letters</p>
      </div>
      <h2 style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold);color:var(--color-text-primary);margin:0 0 var(--space-4);">Templates</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--space-4);margin-bottom:var(--space-8);">
        ${TEMPLATES.map(t => `
          <div class="card tmpl-card" data-key="${t.key}" style="cursor:pointer;">
            <div class="card-body" style="display:flex;flex-direction:column;gap:var(--space-3);align-items:flex-start;">
              <span style="font-size:var(--text-2xl);">${t.icon}</span>
              <h3 class="card-title" style="margin:0;color:var(--color-text-primary);">${esc(t.title)}</h3>
              <p style="margin:0;font-size:var(--text-sm);color:var(--color-text-secondary);">${esc(t.desc)}</p>
              <span class="btn btn-ghost btn-sm" style="margin-top:auto;">Generate &rarr;</span>
            </div>
          </div>`).join('')}
      </div>
      <h2 style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold);color:var(--color-text-primary);margin:0 0 var(--space-4);">Generated Letters</h2>
      <div id="generated-list"></div>`;

    const listEl = container.querySelector('#generated-list');

    if (!generated.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📄</div>
          <h3 class="empty-state-title">No letters generated yet</h3>
          <p class="empty-state-desc">Select a template above to generate a letter.</p>
        </div>`;
    } else {
      listEl.innerHTML = `
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Template</th><th>Employee</th><th>Generated By</th><th>Date</th><th>Actions</th>
          </tr></thead>
          <tbody>${generated.map(g => `
            <tr>
              <td>${esc(g.payload?.template_title || g.payload?.template || '--')}</td>
              <td>${esc(g.payload?.employee_name || '--')}</td>
              <td>${esc(g.actor?.full_name || '--')}</td>
              <td>${formatDate(g.created_at)}</td>
              <td><button class="btn btn-ghost btn-sm view-letter" data-id="${g.id}">View</button></td>
            </tr>`).join('')}
          </tbody>
        </table></div>`;
    }

    container.querySelectorAll('.tmpl-card').forEach(card => {
      card.addEventListener('click', () => {
        const tmpl = TEMPLATES.find(t => t.key === card.dataset.key);
        if (tmpl) showGenerateModal(tmpl);
      });
    });

    container.querySelectorAll('.view-letter').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = generated.find(x => x.id === btn.dataset.id);
        if (!g) return;
        const body = g.payload?.letter_body || 'No content.';
        openModal(g.payload?.template_title || 'Letter', `
          <div style="white-space:pre-wrap;font-family:var(--font-mono);font-size:var(--text-sm);color:var(--color-text-primary);line-height:var(--line-height-relaxed);">${esc(body)}</div>
          <div style="margin-top:var(--space-4);display:flex;justify-content:flex-end;">
            <button class="btn btn-secondary btn-sm" id="close-letter-view">Close</button>
          </div>`);
        document.getElementById('close-letter-view').addEventListener('click', closeModal);
      });
    });
  }

  await render();
}
