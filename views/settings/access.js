import sb from '../../js/supabase.js';
import { getOrg, getMembership } from '../../js/auth.js';
import { esc, toast, initials, avColor } from '../../js/ui.js';
import { logAction } from '../../js/audit.js';
import { FEATURES } from '../../js/features.js';

// Admin/HR-head screen: control which OS modules each role — and each
// individual employee — can see. UI/navigation gate on top of RLS.
const ROLES = [
  { key: 'manager', label: 'Manager' },
  { key: 'member', label: 'Member' },
];
const CONFIGURABLE = FEATURES.filter(f => !f.locked);

export default async function settingsAccess(container) {
  const org = getOrg();
  const m = getMembership();
  const canManage = m && (['owner', 'admin'].includes(m.role) || m.hr_level === 'head');

  if (!org) { container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No organization</div></div>`; return; }
  if (!canManage) {
    container.innerHTML = `<div style="margin-bottom:var(--space-4)"><a href="#/settings" class="btn btn-ghost btn-sm">← Settings</a></div>
      <div class="empty-state" style="padding:var(--space-8)"><div class="empty-state-title">Admins & HR heads only</div>
      <div class="empty-state-desc">You don't have permission to manage feature access.</div></div>`;
    return;
  }

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)"><a href="#/settings" class="btn btn-ghost btn-sm">← Settings</a></div>
    <div class="page-header">
      <h1 class="page-title">Feature access</h1>
      <p class="page-subtitle">Choose which modules each role and person can see. This hides sections from the app; your data stays protected by security rules either way. Changes take effect on the member's next page load.</p>
    </div>
    <div class="card" style="margin-bottom:var(--space-5)">
      <div class="card-header"><span class="card-title">By role</span></div>
      <div class="card-body" style="overflow-x:auto">
        <div style="font-size:var(--text-xs);color:var(--color-text-secondary);margin-bottom:var(--space-3)">Owners and admins always see everything. Ticked = visible.</div>
        <table class="table" id="role-matrix">
          <thead><tr><th>Module</th>${ROLES.map(r => `<th style="text-align:center">${esc(r.label)}</th>`).join('')}</tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <span class="card-title">Per employee</span>
        <select class="form-input" id="emp-select" style="max-width:280px;height:34px"><option value="">Select an employee…</option></select>
      </div>
      <div id="emp-overrides" class="card-body">
        <div style="color:var(--color-text-tertiary);font-size:var(--text-sm)">Pick an employee to override what they see, beyond their role.</div>
      </div>
    </div>
  `;

  // Load current rules + staff.
  const [{ data: rules }, { data: users }] = await Promise.all([
    sb.from('feature_access').select('subject_type, subject_key, feature_key, allowed').eq('org_id', org.id),
    sb.from('users').select('id, full_name, email, role').eq('org_id', org.id).eq('status', 'active').order('full_name'),
  ]);
  const roleRule = {};   // roleRule[role][feature] = bool
  const userRule = {};   // userRule[userId][feature] = bool
  ROLES.forEach(r => roleRule[r.key] = {});
  (rules || []).forEach(r => {
    if (r.subject_type === 'role') { (roleRule[r.subject_key] ||= {})[r.feature_key] = r.allowed; }
    else { (userRule[r.subject_key] ||= {})[r.feature_key] = r.allowed; }
  });

  async function setRule(subject_type, subject_key, feature_key, allowed) {
    const { error } = await sb.from('feature_access').upsert(
      { org_id: org.id, subject_type, subject_key, feature_key, allowed, updated_at: new Date().toISOString() },
      { onConflict: 'org_id,subject_type,subject_key,feature_key' }
    );
    if (error) { toast('Could not save: ' + error.message); return false; }
    await logAction('platform', 'feature_access', null, allowed ? 'granted' : 'hidden', null, { subject_type, subject_key, feature_key });
    return true;
  }
  async function clearRule(subject_type, subject_key, feature_key) {
    const { error } = await sb.from('feature_access').delete()
      .eq('org_id', org.id).eq('subject_type', subject_type).eq('subject_key', subject_key).eq('feature_key', feature_key);
    if (error) { toast('Could not clear: ' + error.message); return false; }
    return true;
  }

  // --- Role matrix ---
  const tbody = container.querySelector('#role-matrix tbody');
  tbody.innerHTML = CONFIGURABLE.map(f => `<tr>
    <td style="font-weight:var(--font-weight-medium)">${esc(f.label)}</td>
    ${ROLES.map(r => {
      const checked = roleRule[r.key][f.key] !== false; // default visible
      return `<td style="text-align:center"><input type="checkbox" data-role="${r.key}" data-feature="${f.key}" ${checked ? 'checked' : ''}></td>`;
    }).join('')}
  </tr>`).join('');
  tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const ok = await setRule('role', cb.dataset.role, cb.dataset.feature, cb.checked);
      if (!ok) { cb.checked = !cb.checked; return; }
      (roleRule[cb.dataset.role] ||= {})[cb.dataset.feature] = cb.checked;
      toast('Saved');
    });
  });

  // --- Per-employee overrides ---
  const empSel = container.querySelector('#emp-select');
  empSel.innerHTML = `<option value="">Select an employee…</option>` +
    (users || []).filter(u => !['owner', 'admin'].includes(u.role))
      .map(u => `<option value="${u.id}">${esc(u.full_name || u.email)}</option>`).join('');

  const overridesEl = container.querySelector('#emp-overrides');
  empSel.addEventListener('change', () => {
    const uid = empSel.value;
    if (!uid) { overridesEl.innerHTML = `<div style="color:var(--color-text-tertiary);font-size:var(--text-sm)">Pick an employee to override what they see, beyond their role.</div>`; return; }
    const u = (users || []).find(x => x.id === uid);
    const rules = userRule[uid] || {};
    overridesEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-4)">
        <div style="width:32px;height:32px;border-radius:var(--radius-full);background:${avColor(u.full_name || u.email || '')};display:flex;align-items:center;justify-content:center;color:white;font-size:var(--text-xs);font-weight:var(--font-weight-semibold)">${initials(u.full_name || u.email || '?')}</div>
        <div><div style="font-weight:var(--font-weight-medium)">${esc(u.full_name || u.email)}</div><div style="font-size:var(--text-xs);color:var(--color-text-secondary)">Role: ${esc(u.role)}</div></div>
      </div>
      <div style="display:grid;gap:var(--space-2)">
        ${CONFIGURABLE.map(f => {
          const v = f.key in rules ? (rules[f.key] ? 'visible' : 'hidden') : 'default';
          return `<div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border-light)">
            <span style="font-size:var(--text-sm)">${esc(f.label)}</span>
            <select class="form-input" data-ovr="${f.key}" style="height:30px;width:auto;font-size:var(--text-xs)">
              <option value="default" ${v === 'default' ? 'selected' : ''}>Default (role)</option>
              <option value="visible" ${v === 'visible' ? 'selected' : ''}>Always visible</option>
              <option value="hidden" ${v === 'hidden' ? 'selected' : ''}>Hidden</option>
            </select>
          </div>`;
        }).join('')}
      </div>`;
    overridesEl.querySelectorAll('[data-ovr]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const feature = sel.dataset.ovr;
        let ok;
        if (sel.value === 'default') { ok = await clearRule('user', uid, feature); if (ok && userRule[uid]) delete userRule[uid][feature]; }
        else { const allowed = sel.value === 'visible'; ok = await setRule('user', uid, feature, allowed); if (ok) (userRule[uid] ||= {})[feature] = allowed; }
        if (ok) toast('Saved');
      });
    });
  });
}
