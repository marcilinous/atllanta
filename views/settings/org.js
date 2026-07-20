import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';

export default async function settingsOrg(container) {
  const org = getOrg();
  const membership = getMembership();
  const isAdmin = membership && ['owner', 'admin', 'super_admin', 'agency_admin'].includes(membership.role);

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Organization and account settings</p>
    </div>
    <div class="tabs">
      <button class="tab active" data-tab="org">Organization</button>
      <button class="tab" data-tab="members">Members</button>
      <button class="tab" data-tab="departments">Departments</button>
    </div>
    <div id="settings-content"></div>
  `;

  const contentEl = document.getElementById('settings-content');

  if (!org) {
    contentEl.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Create Organization</span></div>
        <div class="card-body">
          <form id="create-org-form">
            <div class="form-group">
              <label class="form-label">Organization Name</label>
              <input type="text" class="form-input" id="org-name" required placeholder="Your company name">
            </div>
            <div class="form-group">
              <label class="form-label">Timezone</label>
              <select class="form-input" id="org-tz">
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="America/New_York">America/New_York (EST)</option>
                <option value="Europe/London">Europe/London (GMT)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST)</option>
              </select>
            </div>
            <button type="submit" class="btn btn-primary">Create Organization</button>
          </form>
        </div>
      </div>
    `;
    return;
  }

  contentEl.innerHTML = `
    <div class="card">
      <div class="card-header"><span class="card-title">Organization Details</span></div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input type="text" class="form-input" value="${esc(org.name)}" ${isAdmin ? '' : 'disabled'} id="org-name-edit">
        </div>
        <div class="form-group">
          <label class="form-label">Timezone</label>
          <input type="text" class="form-input" value="${esc(org.timezone || 'Asia/Kolkata')}" disabled>
        </div>
        <div class="form-group">
          <label class="form-label">Currency</label>
          <input type="text" class="form-input" value="${esc(org.currency || 'INR')}" disabled>
        </div>
        ${isAdmin ? '<button class="btn btn-primary" id="save-org">Save Changes</button>' : ''}
      </div>
    </div>
  `;

  if (isAdmin) {
    document.getElementById('save-org')?.addEventListener('click', async () => {
      const newName = document.getElementById('org-name-edit').value.trim();
      if (!newName) return;
      const { error } = await sb.from('organizations').update({ name: newName }).eq('id', org.id);
      if (error) alert('Error: ' + error.message);
      else alert('Organization updated!');
    });
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
