// What the Phase 3 admin screens (app/(platform)/settings/) show and accept:
// the 13 org_modules keys with their labels, the legacy feature_access keys
// the access editor may write, and the roles that editor configures.
//
// No `server-only` import: tests import this file directly with node:test,
// and client components render the labels.

import { MODULE_KEYS, PERMISSIONS, type ModuleKey, type Permission } from "../auth/modules.ts";

export { MODULE_KEYS, PERMISSIONS };
export type { ModuleKey, Permission };

export const MODULE_LABELS: Record<ModuleKey, { label: string; description: string }> = {
  people: { label: "People", description: "Employees, lifecycle, assets and letters." },
  me: { label: "My attendance & leave", description: "Check-in, attendance and leave for each person." },
  inbox: { label: "Approvals inbox", description: "Leave, expense and regularisation approvals." },
  documents: { label: "Documents", description: "The company document store." },
  finance: { label: "Finance", description: "Expenses and expense categories." },
  announcements: { label: "Announcements", description: "Company notices and the noticeboard." },
  recruitment: { label: "Recruitment", description: "Jobs, candidates, matching and interviews." },
  crm: { label: "CRM", description: "Leads, contacts, pipeline and activities." },
  crm_partner: { label: "Partner CRM", description: "The partner and field-sales pack." },
  analytics: { label: "Analytics", description: "Self-serve questions and dashboards." },
  helpdesk: { label: "Helpdesk", description: "Tickets and round-robin assignment." },
  projects: { label: "Projects", description: "Projects, milestones and tasks." },
  ai: { label: "AI assistant", description: "The assistant and AI features." },
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
};

// The feature keys the legacy access editor offered (public/js/features.js
// FEATURES, minus the locked `dashboard`), in the same order and with the
// same labels. The legacy nav reads these rows, so the editor must write
// exactly these keys. tests/settings-catalogue.test.mjs fails if the two
// lists drift apart. Rows with any other key (e.g. old `crm_contacts` rows)
// are left untouched.
export const ACCESS_FEATURES = [
  { key: "me", label: "My attendance & leave" },
  { key: "inbox", label: "Approvals inbox" },
  { key: "people", label: "People & Employees" },
  { key: "recruitment", label: "Recruitment (hiring)" },
  { key: "crm", label: "CRM" },
  { key: "crm_leads", label: "CRM · Leads" },
  { key: "crm_pipeline", label: "CRM · Pipeline (deals)" },
  { key: "documents", label: "Documents" },
  { key: "finance", label: "Finance" },
  { key: "reports", label: "Reports" },
  { key: "analytics", label: "Analytics (self-serve)" },
  { key: "helpdesk", label: "Helpdesk" },
  { key: "announcements", label: "Announcements" },
  { key: "ai", label: "AI assistant" },
] as const;
export type AccessFeatureKey = (typeof ACCESS_FEATURES)[number]["key"];
export const ACCESS_FEATURE_KEYS = ACCESS_FEATURES.map((f) => f.key) as unknown as readonly [
  AccessFeatureKey,
  ...AccessFeatureKey[],
];

// Owners and admins bypass feature_access (public/js/features.js `_bypass`),
// so rules are only ever written for the other system roles.
export const ACCESS_ROLES = [
  { key: "manager", label: "Manager" },
  { key: "developer", label: "Developer" },
  { key: "member", label: "Member" },
] as const;
export type AccessRoleKey = (typeof ACCESS_ROLES)[number]["key"];

export const SYSTEM_ROLE_SLUGS = ["owner", "admin", "developer", "manager", "member"] as const;

/**
 * A URL-safe slug for a custom role name: lower-case ASCII letters, digits
 * and single hyphens. Returns "" when the name has none of those (e.g. a
 * name written only in another script) — the caller picks a fallback.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export interface ModuleGrant {
  moduleKey: ModuleKey;
  permissions: Permission[];
}

/**
 * Flattens grants into role_permissions rows, in a stable order (module key
 * order, then permission order) so two equal grant sets compare equal.
 */
export function grantRows(grants: readonly ModuleGrant[]): { moduleKey: ModuleKey; permission: Permission }[] {
  const byModule = new Map<ModuleKey, Set<Permission>>();
  for (const g of grants) {
    const set = byModule.get(g.moduleKey) ?? new Set<Permission>();
    for (const p of g.permissions) set.add(p);
    byModule.set(g.moduleKey, set);
  }
  const rows: { moduleKey: ModuleKey; permission: Permission }[] = [];
  for (const moduleKey of MODULE_KEYS) {
    const set = byModule.get(moduleKey);
    if (!set) continue;
    for (const permission of PERMISSIONS) {
      if (set.has(permission)) rows.push({ moduleKey, permission });
    }
  }
  return rows;
}

/** The inverse of grantRows: role_permissions rows back into per-module grants. */
export function grantsFromRows(rows: readonly { moduleKey: string; permission: string }[]): ModuleGrant[] {
  const known = rows.filter(
    (r) =>
      (MODULE_KEYS as readonly string[]).includes(r.moduleKey) &&
      (PERMISSIONS as readonly string[]).includes(r.permission)
  ) as { moduleKey: ModuleKey; permission: Permission }[];
  const byModule = new Map<ModuleKey, Permission[]>();
  for (const r of grantRows(known.map((k) => ({ moduleKey: k.moduleKey, permissions: [k.permission] })))) {
    const list = byModule.get(r.moduleKey) ?? [];
    list.push(r.permission);
    byModule.set(r.moduleKey, list);
  }
  return [...byModule.entries()].map(([moduleKey, permissions]) => ({ moduleKey, permissions }));
}
