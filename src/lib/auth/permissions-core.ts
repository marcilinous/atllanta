import type { ModuleKey, Permission } from "./modules.ts";

/**
 * Permission resolution order:
 * 1. Module gate – if the module is not enabled for the org, no permissions.
 * 2. Custom-role override – if the custom role defines permissions for this module, use them.
 * 3. System-role default – fallback to the role-based default set.
 *
 * After module-level permissions are decided, feature rules are evaluated
 * (see `canSeeFeature`). This file is the single source of truth for the new
 * permission stack and is mirrored in SQL by the `module_enabled()` function.
 */

export type SystemRole = "owner" | "admin" | "developer" | "manager" | "member";

export interface FeatureRule {
  subjectType: "role" | "user";
  subjectKey: string;
  featureKey: string;
  allowed: boolean;
}

export interface PermissionContext {
  userId: string;
  orgId: string;
  role: SystemRole;
  customRoleId: string | null;
  enabledModules: ReadonlySet<ModuleKey>;
  customGrants: ReadonlyMap<ModuleKey, ReadonlySet<Permission>>;
  featureRules: readonly FeatureRule[];
}

export const SYSTEM_ROLE_DEFAULTS: Record<SystemRole, ReadonlySet<Permission>> = {
  owner: new Set(["view", "create", "edit", "delete", "approve"]),
  admin: new Set(["view", "create", "edit", "delete", "approve"]),
  manager: new Set(["view", "create", "edit", "approve"]),
  member: new Set(["view", "create", "edit"]),
  // provisional — mirrors member until the owner defines developer's module
  // access; its technical powers (API keys, webhooks, integrations —
  // CLAUDE.md §3.5) are capabilities, not module permissions.
  developer: new Set(["view", "create", "edit"]),
};

export function isSystemRole(x: unknown): x is SystemRole {
  return (
    typeof x === "string" &&
    (x === "owner" || x === "admin" || x === "developer" || x === "manager" || x === "member")
  );
}

/**
 * Resolves the effective permission set for `module` under `ctx`:
 * a disabled module denies everything (owners included); a custom role's
 * grants for a module override the system-role default entirely (not
 * merged with it); otherwise the caller's system-role default applies.
 */
export function permissionsFor(ctx: PermissionContext, module: ModuleKey): ReadonlySet<Permission> {
  if (!ctx.enabledModules.has(module)) {
    return new Set<Permission>();
  }
  if (ctx.customGrants.has(module)) {
    return ctx.customGrants.get(module)!;
  }
  return SYSTEM_ROLE_DEFAULTS[ctx.role];
}

export function can(ctx: PermissionContext, module: ModuleKey, permission: Permission): boolean {
  return permissionsFor(ctx, module).has(permission);
}

// Legacy `feature_access` fine-grained keys. Every module key maps to
// itself; the remaining keys are legacy sub-screens that fold into `crm`
// (generic CRM) or `crm_partner` (the RT partner vertical pack).
export const FEATURE_MODULE: Record<string, ModuleKey> = {
  people: "people",
  me: "me",
  inbox: "inbox",
  documents: "documents",
  finance: "finance",
  announcements: "announcements",
  recruitment: "recruitment",
  crm: "crm",
  crm_partner: "crm_partner",
  analytics: "analytics",
  helpdesk: "helpdesk",
  projects: "projects",
  ai: "ai",
  crm_leads: "crm",
  crm_pipeline: "crm",
  crm_partners: "crm_partner",
  crm_field_sales: "crm_partner",
  crm_visits: "crm_partner",
  crm_prospects: "crm_partner",
  crm_events: "crm_partner",
  crm_exports: "crm_partner",
  crm_pjp: "crm_partner",
  crm_sales: "crm_partner",
  crm_reports: "crm_partner",
};

export const ALWAYS_ON = new Set(["dashboard", "reports"]);

/**
 * Legacy feature-key visibility check. `dashboard`/`reports` are always on;
 * an unknown key is allowed (legacy behaviour); otherwise the module gate
 * must pass first, then owner/admin bypass per-role/user rules (but not the
 * module gate), then a `user` rule wins over a `role` rule, else default true.
 */
export function canSeeFeature(ctx: PermissionContext, featureKey: string): boolean {
  if (ALWAYS_ON.has(featureKey)) {
    return true;
  }
  const moduleKey = FEATURE_MODULE[featureKey];
  if (moduleKey === undefined) {
    return true; // legacy: unknown keys allowed
  }
  if (!can(ctx, moduleKey, "view")) {
    return false;
  }
  if (ctx.role === "owner" || ctx.role === "admin") {
    return true; // legacy `_bypass`: admins skip per-role rules, not module gates
  }
  const userRule = ctx.featureRules.find(
    (r) => r.subjectType === "user" && r.subjectKey === ctx.userId && r.featureKey === featureKey
  );
  if (userRule !== undefined) {
    return userRule.allowed;
  }
  const roleRule = ctx.featureRules.find(
    (r) => r.subjectType === "role" && r.subjectKey === ctx.role && r.featureKey === featureKey
  );
  if (roleRule !== undefined) {
    return roleRule.allowed;
  }
  return true;
}
