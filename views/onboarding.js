import sb from '../js/supabase.js';
import { getUser, getOrg, getMembership, loadUserProfile } from '../js/auth.js';
import { esc, toast } from '../js/ui.js';
import { navigate } from '../js/router.js';

export default async function onboarding(container) {
  const user = getUser();
  let step = 1;
  const totalSteps = 4;

  const orgData = { name: '', slug: '', timezone: 'Asia/Kolkata', currency: 'INR' };
  const leaveTypes = [
    { name: 'Casual Leave', code: 'CL', annual_quota: 12, is_paid: true },
    { name: 'Sick Leave', code: 'SL', annual_quota: 12, is_paid: true },
    { name: 'Earned Leave', code: 'EL', annual_quota: 15, is_paid: true },
  ];
  const invites = [];

  render();

  function render() {
    container.innerHTML = `
      <div style="max-width:640px;margin:var(--space-8) auto;padding:0 var(--space-4)">
        <div style="text-align:center;margin-bottom:var(--space-8)">
          <h1 style="font-size:var(--text-2xl);font-weight:var(--font-weight-bold);margin-bottom:var(--space-2)">Set up your workspace</h1>
          <p style="color:var(--color-text-secondary)">Step ${step} of ${totalSteps}</p>
          <div style="display:flex;gap:var(--space-2);margin-top:var(--space-4);justify-content:center">
            ${Array.from({ length: totalSteps }, (_, i) => `
              <div style="width:48px;height:4px;border-radius:var(--radius-full);background:${i < step ? 'var(--color-accent)' : 'var(--color-border)'}"></div>
            `).join('')}
          </div>
        </div>
        <div class="card" style="padding:var(--space-6)" id="step-content"></div>
      </div>
    `;
    const el = document.getElementById('step-content');
    if (step === 1) renderOrgStep(el);
    else if (step === 2) renderLeaveStep(el);
    else if (step === 3) renderInviteStep(el);
    else if (step === 4) renderDoneStep(el);
  }

  function renderOrgStep(el) {
    el.innerHTML = `
      <h2 style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold);margin-bottom:var(--space-4)">Organization Details</h2>
      <div style="display:grid;gap:var(--space-4)">
        <div class="form-group">
          <label class="form-label">Organization Name *</label>
          <input type="text" class="form-input" id="ob-name" value="${esc(orgData.name)}" placeholder="e.g. Acme Corp">
        </div>
        <div class="form-group">
          <label class="form-label">Slug (URL identifier)</label>
          <input type="text" class="form-input" id="ob-slug" value="${esc(orgData.slug)}" placeholder="e.g. acme-corp">
          <div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-1)">Auto-generated from name if left blank</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4)">
          <div class="form-group">
            <label class="form-label">Timezone</label>
            <select class="form-input" id="ob-tz">
              <option value="Asia/Kolkata" ${orgData.timezone === 'Asia/Kolkata' ? 'selected' : ''}>Asia/Kolkata (IST)</option>
              <option value="America/New_York" ${orgData.timezone === 'America/New_York' ? 'selected' : ''}>America/New_York (EST)</option>
              <option value="America/Los_Angeles" ${orgData.timezone === 'America/Los_Angeles' ? 'selected' : ''}>America/Los_Angeles (PST)</option>
              <option value="Europe/London" ${orgData.timezone === 'Europe/London' ? 'selected' : ''}>Europe/London (GMT)</option>
              <option value="Asia/Dubai" ${orgData.timezone === 'Asia/Dubai' ? 'selected' : ''}>Asia/Dubai (GST)</option>
              <option value="Asia/Singapore" ${orgData.timezone === 'Asia/Singapore' ? 'selected' : ''}>Asia/Singapore (SGT)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Currency</label>
            <select class="form-input" id="ob-currency">
              <option value="INR" ${orgData.currency === 'INR' ? 'selected' : ''}>INR (₹)</option>
              <option value="USD" ${orgData.currency === 'USD' ? 'selected' : ''}>USD ($)</option>
              <option value="EUR" ${orgData.currency === 'EUR' ? 'selected' : ''}>EUR (€)</option>
              <option value="GBP" ${orgData.currency === 'GBP' ? 'selected' : ''}>GBP (£)</option>
              <option value="AED" ${orgData.currency === 'AED' ? 'selected' : ''}>AED (د.إ)</option>
            </select>
          </div>
        </div>
        <button class="btn btn-primary" id="ob-next" style="margin-top:var(--space-2)">Next</button>
      </div>
    `;

    const nameInput = el.querySelector('#ob-name');
    const slugInput = el.querySelector('#ob-slug');
    nameInput.addEventListener('input', () => {
      if (!slugInput.dataset.manual) {
        slugInput.value = nameInput.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      }
    });
    slugInput.addEventListener('input', () => { slugInput.dataset.manual = '1'; });

    el.querySelector('#ob-next').addEventListener('click', () => {
      orgData.name = nameInput.value.trim();
      orgData.slug = slugInput.value.trim() || orgData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      orgData.timezone = el.querySelector('#ob-tz').value;
      orgData.currency = el.querySelector('#ob-currency').value;
      if (!orgData.name) return toast('Organization name is required');
      step = 2;
      render();
    });
  }

  function renderLeaveStep(el) {
    el.innerHTML = `
      <h2 style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold);margin-bottom:var(--space-2)">Configure Leave Types</h2>
      <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-4)">Defaults are pre-filled. You can change these later in Settings.</p>
      <div id="leave-types-list" style="display:grid;gap:var(--space-3)">
        ${leaveTypes.map((lt, i) => `
          <div style="display:flex;gap:var(--space-3);align-items:center;padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-lg)">
            <div style="flex:1">
              <input type="text" class="form-input" value="${esc(lt.name)}" data-idx="${i}" data-field="name" style="margin-bottom:var(--space-1)">
            </div>
            <div style="width:80px">
              <input type="text" class="form-input" value="${esc(lt.code)}" data-idx="${i}" data-field="code" placeholder="Code" style="text-align:center">
            </div>
            <div style="width:80px">
              <input type="number" class="form-input" value="${lt.annual_quota}" data-idx="${i}" data-field="annual_quota" placeholder="Days" style="text-align:center">
            </div>
            <label style="display:flex;align-items:center;gap:var(--space-1);font-size:var(--text-xs);white-space:nowrap">
              <input type="checkbox" ${lt.is_paid ? 'checked' : ''} data-idx="${i}" data-field="is_paid"> Paid
            </label>
          </div>
        `).join('')}
      </div>
      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4)">
        <button class="btn btn-secondary" id="ob-back">Back</button>
        <button class="btn btn-primary" id="ob-next" style="flex:1">Next</button>
      </div>
    `;

    el.querySelectorAll('input[data-idx]').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = +inp.dataset.idx;
        const field = inp.dataset.field;
        if (field === 'is_paid') leaveTypes[idx][field] = inp.checked;
        else if (field === 'annual_quota') leaveTypes[idx][field] = +inp.value;
        else leaveTypes[idx][field] = inp.value;
      });
    });

    el.querySelector('#ob-back').addEventListener('click', () => { step = 1; render(); });
    el.querySelector('#ob-next').addEventListener('click', () => { step = 3; render(); });
  }

  function renderInviteStep(el) {
    el.innerHTML = `
      <h2 style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold);margin-bottom:var(--space-2)">Invite Team Members</h2>
      <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-4)">You can skip this and invite people later from Settings.</p>
      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4)">
        <input type="email" class="form-input" id="invite-email" placeholder="colleague@company.com" style="flex:1">
        <select class="form-input" id="invite-role" style="width:120px">
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
          <option value="member" selected>Member</option>
        </select>
        <button class="btn btn-secondary" id="invite-add">Add</button>
      </div>
      <div id="invite-list"></div>
      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4)">
        <button class="btn btn-secondary" id="ob-back">Back</button>
        <button class="btn btn-primary" id="ob-next" style="flex:1">${invites.length ? 'Create Workspace' : 'Skip & Create Workspace'}</button>
      </div>
    `;

    renderInviteList();

    el.querySelector('#invite-add').addEventListener('click', () => {
      const email = el.querySelector('#invite-email').value.trim();
      const role = el.querySelector('#invite-role').value;
      if (!email) return;
      if (invites.some(i => i.email === email)) return toast('Already added');
      invites.push({ email, role });
      el.querySelector('#invite-email').value = '';
      renderInviteList();
      el.querySelector('#ob-next').textContent = 'Create Workspace';
    });

    el.querySelector('#ob-back').addEventListener('click', () => { step = 2; render(); });
    el.querySelector('#ob-next').addEventListener('click', () => createWorkspace());

    function renderInviteList() {
      const list = el.querySelector('#invite-list');
      if (!invites.length) {
        list.innerHTML = `<div style="text-align:center;padding:var(--space-4);color:var(--color-text-tertiary);font-size:var(--text-sm)">No team members added yet</div>`;
        return;
      }
      list.innerHTML = invites.map((inv, i) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
          <div>
            <span style="font-size:var(--text-sm)">${esc(inv.email)}</span>
            <span class="badge badge-neutral" style="margin-left:var(--space-2)">${esc(inv.role)}</span>
          </div>
          <button class="btn btn-ghost btn-sm" data-remove="${i}">&times;</button>
        </div>
      `).join('');
      list.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          invites.splice(+btn.dataset.remove, 1);
          renderInviteList();
          if (!invites.length) el.querySelector('#ob-next').textContent = 'Skip & Create Workspace';
        });
      });
    }
  }

  async function createWorkspace() {
    const el = document.getElementById('step-content');
    el.innerHTML = `<div style="text-align:center;padding:var(--space-8)"><div style="color:var(--color-text-secondary)">Creating your workspace...</div></div>`;

    const org = getOrg();
    if (org) {
      const { error } = await sb.from('organizations').update({
        name: orgData.name,
        slug: orgData.slug,
        timezone: orgData.timezone,
        currency: orgData.currency,
      }).eq('id', org.id);

      if (error) {
        toast('Failed to update org: ' + error.message);
        step = 1;
        render();
        return;
      }

      for (const lt of leaveTypes) {
        const { error: ltErr } = await sb.from('leave_types').upsert({
          org_id: org.id,
          name: lt.name,
          code: lt.code,
          annual_quota: lt.annual_quota,
          is_paid: lt.is_paid,
          is_active: true,
        }, { onConflict: 'org_id,code' });
        if (ltErr) toast('Leave type error: ' + ltErr.message);
      }

      for (const inv of invites) {
        const { error: invErr } = await sb.from('memberships').insert({
          organization_id: org.id,
          user_id: null,
          email: inv.email,
          role: inv.role,
          status: 'invited',
        }).select().maybeSingle();
        if (invErr) toast('Invite error: ' + invErr.message);
      }
    }

    await loadUserProfile();
    step = 4;
    render();
  }

  function renderDoneStep(el) {
    el.innerHTML = `
      <div style="text-align:center;padding:var(--space-4)">
        <div style="font-size:48px;margin-bottom:var(--space-4)">&#10003;</div>
        <h2 style="font-size:var(--text-xl);font-weight:var(--font-weight-bold);margin-bottom:var(--space-2)">You're all set!</h2>
        <p style="color:var(--color-text-secondary);margin-bottom:var(--space-6)">Your workspace "${esc(orgData.name)}" is ready. Start by adding employees or posting your first job.</p>
        <div style="display:flex;gap:var(--space-3);justify-content:center">
          <button class="btn btn-primary" id="ob-go-dashboard">Go to Dashboard</button>
          <button class="btn btn-secondary" id="ob-go-employees">Add Employees</button>
          <button class="btn btn-secondary" id="ob-go-jobs">Post a Job</button>
        </div>
      </div>
    `;

    el.querySelector('#ob-go-dashboard').addEventListener('click', () => navigate('dashboard'));
    el.querySelector('#ob-go-employees').addEventListener('click', () => navigate('employees'));
    el.querySelector('#ob-go-jobs').addEventListener('click', () => navigate('recruitment'));
  }
}
