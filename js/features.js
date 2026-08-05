// Feature access — admin/HR-configurable module visibility.
//
// Controls which top-level modules appear in the sidebar and which in-app
// routes a user may open. It's a navigation/UX gate on top of RLS, not a
// replacement for it: data stays protected by row-level security regardless.
//
// Feature keys line up with the sidebar's data-view values; router.js aliases
// sub-routes (attendance, employees, ...) onto the same keys, reused here.

import sb from './supabase.js';

// Toggleable modules. `locked` features are always visible (so no one is
// stranded). Order is display order in the config UI.
export const FEATURES = [
  { key: 'dashboard', label: 'Dashboard', locked: true },
  { key: 'me', label: 'My attendance & leave' },
  { key: 'inbox', label: 'Approvals inbox' },
  { key: 'people', label: 'People & Employees' },
  { key: 'crm', label: 'CRM' },
  { key: 'documents', label: 'Documents' },
  { key: 'finance', label: 'Finance' },
  { key: 'reports', label: 'Reports' },
];

// Route base -> feature key (mirrors router.js nav aliases).
const ALIAS = {
  employees: 'people', recruitment: 'people', lifecycle: 'people', assets: 'people', letters: 'people',
  approvals: 'inbox',
  leave: 'me', attendance: 'me',
  announcements: 'admin', audit: 'admin',
};

export function featureForRoute(path) {
  const base = (path || '').split('/')[0].split('?')[0];
  return ALIAS[base] || base;
}

const KNOWN = new Set(FEATURES.map(f => f.key));

// Module state: which feature keys are hidden for the current user.
let _disallowed = new Set();
let _bypass = true;        // admins bypass all gating
let _loaded = false;

// Compute the current user's hidden features from stored rules. Owners/admins
// bypass entirely. Precedence: user override > role default > visible.
export async function loadFeatureAccess({ orgId, userId, role, isAdmin }) {
  _disallowed = new Set();
  _bypass = !!isAdmin;
  _loaded = true;
  if (isAdmin || !orgId || !userId) return;

  const { data, error } = await sb
    .from('feature_access')
    .select('subject_type, subject_key, feature_key, allowed')
    .eq('org_id', orgId)
    .or(`and(subject_type.eq.role,subject_key.eq.${role}),and(subject_type.eq.user,subject_key.eq.${userId})`);
  if (error || !data) return;

  const roleRule = {}, userRule = {};
  for (const r of data) {
    if (r.subject_type === 'role') roleRule[r.feature_key] = r.allowed;
    else userRule[r.feature_key] = r.allowed;
  }
  for (const f of FEATURES) {
    if (f.locked) continue;
    const eff = (f.key in userRule) ? userRule[f.key] : (f.key in roleRule ? roleRule[f.key] : true);
    if (!eff) _disallowed.add(f.key);
  }
}

export function isFeatureAllowed(key) {
  if (!_loaded || _bypass) return true;
  if (!KNOWN.has(key)) return true;   // unknown/uncontrolled routes stay open
  return !_disallowed.has(key);
}

export function isRouteAllowed(path) {
  return isFeatureAllowed(featureForRoute(path));
}
