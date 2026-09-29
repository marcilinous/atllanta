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
  { key: 'recruitment', label: 'Recruitment (hiring)' },
  { key: 'crm', label: 'CRM' },
  { key: 'crm_leads', label: 'CRM · Leads' },
  { key: 'crm_pipeline', label: 'CRM · Pipeline (deals)' },
  { key: 'documents', label: 'Documents' },
  { key: 'finance', label: 'Finance' },
  { key: 'reports', label: 'Reports' },
  { key: 'analytics', label: 'Analytics (self-serve)' },
  { key: 'helpdesk', label: 'Helpdesk' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'ai', label: 'AI assistant' },
];

// Route base -> feature key (mirrors router.js nav aliases).
const ALIAS = {
  employees: 'people', lifecycle: 'people', assets: 'people', letters: 'people',
  approvals: 'inbox',
  leave: 'me', attendance: 'me',
  audit: 'admin',
};

// CRM sub-routes map to their own key. The two generic screens gate with the
// base CRM; everything else on this line is the RTcompu partner vertical and
// gates with the partner pack (see PARTNER_FEATURES).
const CRM_SUB = {
  leads: 'crm_leads',
  opportunities: 'crm_pipeline',
  // Gen-2 partner screens (RTcompu distribution model).
  partners: 'crm_partners', partner: 'crm_partners',
  'field-sales': 'crm_field_sales',
  'log-visit': 'crm_visits',
  prospects: 'crm_prospects',
  events: 'crm_events',
  exports: 'crm_exports',
  pjp: 'crm_pjp',
  sales: 'crm_sales',
  reports: 'crm_reports',
};

// The RT partner vertical pack — only orgs with partner_crm_enabled see these.
const PARTNER_FEATURES = new Set([
  'crm_partners', 'crm_field_sales', 'crm_visits', 'crm_prospects',
  'crm_events', 'crm_exports', 'crm_pjp', 'crm_sales', 'crm_reports',
]);
// Generic CRM keys gated by crm_enabled (the standard baseline).
const GENERIC_CRM = new Set(['crm', 'crm_leads', 'crm_pipeline']);

// Phase 3 Step 3: feature key -> org_modules key. Must equal FEATURE_MODULE
// in src/lib/auth/permissions-core.ts (tests/feature-gating.test.mjs checks).
// Keys not listed here (dashboard, reports, admin, settings, ...) are not
// modules and are never hidden by this gate.
export const MODULE_OF = {
  people: 'people', me: 'me', inbox: 'inbox', documents: 'documents',
  finance: 'finance', announcements: 'announcements', recruitment: 'recruitment',
  crm: 'crm', crm_partner: 'crm_partner', analytics: 'analytics',
  helpdesk: 'helpdesk', projects: 'projects', ai: 'ai',
  crm_leads: 'crm', crm_pipeline: 'crm',
  crm_partners: 'crm_partner', crm_field_sales: 'crm_partner', crm_visits: 'crm_partner',
  crm_prospects: 'crm_partner', crm_events: 'crm_partner', crm_exports: 'crm_partner',
  crm_pjp: 'crm_partner', crm_sales: 'crm_partner', crm_reports: 'crm_partner',
};

export function featureForRoute(path) {
  const parts = (path || '').split('?')[0].split('/');
  const base = parts[0];
  if (base === 'crm') return CRM_SUB[parts[1] || ''] || 'crm';
  return ALIAS[base] || base;
}

const KNOWN = new Set(FEATURES.map(f => f.key));

// Module state: which feature keys are hidden for the current user.
let _disallowed = new Set();
let _bypass = true;        // admins bypass all per-role gating
let _loaded = false;
let _crmEnabled = true;    // platform gate: generic CRM enabled for this org?
let _partnerPack = false;  // platform gate: RT partner vertical pack enabled?

// Platform gates, set per organization at bootstrap. Unlike per-role access,
// these are NOT bypassed by an org's own admins.
// Module gate (Phase 3 Step 3): the org's switched-on org_modules keys, set
// at bootstrap. null = not loaded, and then the gate is not applied — this is
// a navigation gate on top of RLS, so failing open only restores the pre-1.5
// behaviour, while failing closed would hide every module from a whole org.
let _enabledModules = null;
export function setEnabledModules(keys) {
  _enabledModules = Array.isArray(keys) ? new Set(keys) : null;
}
export async function loadOrgModules(orgId) {
  if (!orgId) { setEnabledModules(null); return; }
  // index.html awaits this during bootstrap: it must never throw, or a network
  // hiccup would stop the whole app from loading.
  try {
    const { data, error } = await sb
      .from('org_modules')
      .select('module_key')
      .eq('org_id', orgId)
      .eq('is_enabled', true);
    if (error || !Array.isArray(data)) throw new Error(error?.message || 'unexpected response');
    setEnabledModules(data.map(r => r.module_key));
  } catch (e) {
    console.warn('[features] org modules unavailable; module gate not applied', e?.message);
    setEnabledModules(null);
  }
}

export function setCrmEnabled(v) { _crmEnabled = v !== false; }
export function setPartnerPack(v) { _partnerPack = v === true; }
export function hasPartnerPack() { return _partnerPack; }

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
  // Platform gates first (admins do NOT bypass these).
  if (GENERIC_CRM.has(key) && !_crmEnabled) return false;
  if (PARTNER_FEATURES.has(key) && !_partnerPack) return false;
  if (_enabledModules && MODULE_OF[key] && !_enabledModules.has(MODULE_OF[key])) return false;
  if (!_loaded || _bypass) return true;
  if (!KNOWN.has(key)) return true;   // unknown/uncontrolled routes stay open
  return !_disallowed.has(key);
}

export function isRouteAllowed(path) {
  // The CRM hub (#/crm) fronts both generic CRM and the partner pack, so it
  // opens if either is allowed — the same rule as the sidebar CRM button.
  const clean = (path || '').split('?')[0].replace(/\/$/, '');
  if (clean === 'crm') return isFeatureAllowed('crm') || isFeatureAllowed('crm_partners');
  return isFeatureAllowed(featureForRoute(path));
}
