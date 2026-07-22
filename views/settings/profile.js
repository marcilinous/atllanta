import sb from '../../js/supabase.js';
import { getUser, getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, initials, avColor, openModal, closeModal } from '../../js/ui.js';
import { publishEvent } from '../../js/events.js';

export default async function profileSettings(container) {
  const user = getUser();
  const org = getOrg();
  const membership = getMembership();

  const { data: profile } = await sb
    .from('users')
    .select('*, department:department_id(name), team:team_id(name), manager:reporting_manager_id(full_name)')
    .eq('id', user.id)
    .maybeSingle();

  const name = profile?.full_name || user?.user_metadata?.full_name || '';
  const email = profile?.email || user?.email || '';
  const phone = profile?.phone || '';
  const av = avColor(name || email);
  const ini = initials(name || email);

  const savedTheme = localStorage.getItem('atllanta-theme') || 'light';

  container.innerHTML = `
    <div style="margin-bottom:var(--space-6)">
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Manage your personal preferences and account</p>
    </div>

    <div style="display:grid;gap:var(--space-4);max-width:640px">
      <!-- Profile Card -->
      <div class="card">
        <div class="card-header"><span class="card-title">Profile</span></div>
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-5);padding-bottom:var(--space-4);border-bottom:1px solid var(--color-border-light)">
            <div style="width:64px;height:64px;border-radius:var(--radius-full);background:${av};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xl);font-weight:var(--font-weight-bold);flex-shrink:0">${esc(ini)}</div>
            <div>
              <div style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold)">${esc(name)}</div>
              <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${esc(email)}</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-1)">${esc(profile?.designation || '—')} ${profile?.department?.name ? '&middot; ' + esc(profile.department.name) : ''}</div>
            </div>
          </div>

          <div style="display:grid;gap:var(--space-4)">
            <div class="form-group">
              <label class="form-label">Full Name</label>
              <input type="text" class="form-input" id="prof-name" value="${esc(name)}">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
              <div class="form-group">
                <label class="form-label">Email</label>
                <input type="email" class="form-input" value="${esc(email)}" disabled>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-1)">Email cannot be changed here</div>
              </div>
              <div class="form-group">
                <label class="form-label">Phone</label>
                <input type="tel" class="form-input" id="prof-phone" value="${esc(phone)}" placeholder="+91 98765 43210">
              </div>
            </div>
            <div style="display:flex;gap:var(--space-3);padding-top:var(--space-2)">
              <button class="btn btn-primary" id="save-profile">Save Changes</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Employment Info (read-only) -->
      <div class="card">
        <div class="card-header"><span class="card-title">Employment</span></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4)">
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Organization</div>
              <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(org?.name || '—')}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Role</div>
              <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(membership?.role || '—')}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Department</div>
              <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(profile?.department?.name || '—')}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Team</div>
              <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(profile?.team?.name || '—')}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Reporting Manager</div>
              <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${esc(profile?.manager?.full_name || '—')}</div>
            </div>
            <div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-1)">Date of Joining</div>
              <div style="font-size:var(--text-sm);font-weight:var(--font-weight-medium)">${profile?.date_of_joining ? new Date(profile.date_of_joining).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div>
            </div>
          </div>
          <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-4);padding-top:var(--space-3);border-top:1px solid var(--color-border-light)">Contact your admin to update employment details</div>
        </div>
      </div>

      <!-- Preferences -->
      <div class="card">
        <div class="card-header"><span class="card-title">Preferences</span></div>
        <div class="card-body">
          <div style="display:grid;gap:var(--space-4)">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-weight:var(--font-weight-medium)">Theme</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Choose your preferred appearance</div>
              </div>
              <select class="form-input" id="pref-theme" style="width:auto">
                <option value="light" ${savedTheme === 'light' ? 'selected' : ''}>Light</option>
                <option value="dark" ${savedTheme === 'dark' ? 'selected' : ''}>Dark</option>
              </select>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding-top:var(--space-3);border-top:1px solid var(--color-border-light)">
              <div>
                <div style="font-weight:var(--font-weight-medium)">Email Notifications</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Receive email alerts for approvals and updates</div>
              </div>
              <label style="position:relative;display:inline-block;width:44px;height:24px">
                <input type="checkbox" id="pref-email-notif" checked style="opacity:0;width:0;height:0">
                <span style="position:absolute;cursor:pointer;inset:0;background:var(--color-bg-tertiary);border-radius:var(--radius-full);transition:var(--transition-fast)" id="toggle-track"></span>
                <span style="position:absolute;content:'';width:18px;height:18px;left:3px;bottom:3px;background:white;border-radius:var(--radius-full);transition:var(--transition-fast);box-shadow:var(--shadow-sm)" id="toggle-thumb"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- Security -->
      <div class="card">
        <div class="card-header"><span class="card-title">Security</span></div>
        <div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:var(--font-weight-medium)">Password</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Update your account password</div>
            </div>
            <button class="btn btn-secondary btn-sm" id="change-pw-btn">Change Password</button>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:var(--space-4);padding-top:var(--space-3);border-top:1px solid var(--color-border-light)">
            <div>
              <div style="font-weight:var(--font-weight-medium)">Active Sessions</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">You are currently signed in</div>
            </div>
            <span class="badge badge-success"><span class="badge-dot"></span>Active</span>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('save-profile')?.addEventListener('click', async () => {
    const newName = document.getElementById('prof-name').value.trim();
    const newPhone = document.getElementById('prof-phone').value.trim();
    if (!newName) return toast('Name is required');

    const { error: authErr } = await sb.auth.updateUser({ data: { full_name: newName } });
    if (authErr) return toast('Failed to update: ' + authErr.message);

    const updates = { full_name: newName, phone: newPhone || null, updated_at: new Date().toISOString() };
    const { error } = await sb.from('users').update(updates).eq('id', user.id);
    if (error) return toast('Failed to save: ' + error.message);

    publishEvent('people.employee.updated', { employee_id: profile.id, org_id: profile.org_id });
    toast('Profile updated');
  });

  document.getElementById('pref-theme')?.addEventListener('change', (e) => {
    const theme = e.target.value;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('atllanta-theme', theme);
    const label = document.getElementById('theme-label');
    if (label) label.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  });

  const emailToggle = document.getElementById('pref-email-notif');
  const toggleTrack = document.getElementById('toggle-track');
  const toggleThumb = document.getElementById('toggle-thumb');

  function updateToggle() {
    if (emailToggle.checked) {
      toggleTrack.style.background = 'var(--color-accent)';
      toggleThumb.style.transform = 'translateX(20px)';
    } else {
      toggleTrack.style.background = 'var(--color-bg-tertiary)';
      toggleThumb.style.transform = 'translateX(0)';
    }
  }
  updateToggle();
  emailToggle?.addEventListener('change', updateToggle);

  document.getElementById('change-pw-btn')?.addEventListener('click', () => {
    const saved = localStorage.getItem('atllanta-email-notif');
    emailToggle.checked = saved !== 'false';

    const pwDiv = document.createElement('div');
    pwDiv.innerHTML = `
      <div style="display:grid;gap:var(--space-3)">
        <div class="form-group">
          <label class="form-label">New Password</label>
          <input type="password" class="form-input" id="new-pw" minlength="6" placeholder="Minimum 6 characters">
        </div>
        <div class="form-group">
          <label class="form-label">Confirm Password</label>
          <input type="password" class="form-input" id="confirm-pw" placeholder="Re-enter new password">
        </div>
        <button class="btn btn-primary" id="save-pw">Update Password</button>
      </div>`;

    openModal('Change Password', pwDiv);

    pwDiv.querySelector('#save-pw').addEventListener('click', async () => {
      const pw = pwDiv.querySelector('#new-pw').value;
      const confirm = pwDiv.querySelector('#confirm-pw').value;
      if (!pw || pw.length < 6) return toast('Password must be at least 6 characters');
      if (pw !== confirm) return toast('Passwords do not match');

      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) return toast('Failed: ' + error.message);
      toast('Password updated');
      closeModal();
    });
  });
}
