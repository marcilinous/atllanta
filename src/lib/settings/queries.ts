// Read side of the Phase 3 admin screens. Every loader takes the OrgAdmin
// from getOrgAdmin() (so the org is the caller's own, never a URL or form
// value) and reads inside withTransaction, i.e. under RLS as the caller.
import "server-only";
import { and, asc, eq, inArray, isNotNull, ne, count } from "drizzle-orm";
import { withTransaction } from "../../db/transaction";
import { featureAccess, orgModules, rolePermissions, roles, users } from "../../db/schema/platform";
import type { OrgAdmin } from "../auth/admin";
import { SYSTEM_ROLE_DEFAULTS, isSystemRole } from "../auth/permissions-core";
import {
  MODULE_KEYS,
  PERMISSIONS,
  ACCESS_FEATURE_KEYS,
  grantsFromRows,
  type ModuleKey,
  type ModuleGrant,
  type Permission,
} from "./catalogue";

export interface ModuleRow {
  moduleKey: ModuleKey;
  isEnabled: boolean;
  enabledAt: string | null;
}

export async function loadModules(admin: OrgAdmin): Promise<ModuleRow[]> {
  const rows = await withTransaction({ id: admin.userId }, (tx) =>
    tx
      .select({ moduleKey: orgModules.moduleKey, isEnabled: orgModules.isEnabled, enabledAt: orgModules.enabledAt })
      .from(orgModules)
      .where(eq(orgModules.orgId, admin.orgId))
  );
  const byKey = new Map(rows.map((r) => [r.moduleKey, r]));
  // Display in MODULE_KEYS order; a key with no seeded row is shown as off
  // (and the toggle will say so if it cannot be switched).
  return MODULE_KEYS.map((moduleKey) => {
    const r = byKey.get(moduleKey);
    return {
      moduleKey,
      isEnabled: r?.isEnabled ?? false,
      enabledAt: r?.enabledAt ? r.enabledAt.toISOString() : null,
    };
  });
}

export interface SystemRoleSummary {
  slug: string;
  name: string;
  defaults: Permission[];
  memberCount: number;
}

export interface CustomRoleSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  grants: ModuleGrant[];
  memberCount: number;
}

export async function loadRoles(
  admin: OrgAdmin
): Promise<{ system: SystemRoleSummary[]; custom: CustomRoleSummary[] }> {
  return withTransaction({ id: admin.userId }, async (tx) => {
    const roleRows = await tx
      .select({
        id: roles.id,
        name: roles.name,
        slug: roles.slug,
        isSystem: roles.isSystem,
        description: roles.description,
      })
      .from(roles)
      .where(eq(roles.orgId, admin.orgId))
      .orderBy(asc(roles.name));

    const customIds = roleRows.filter((r) => !r.isSystem).map((r) => r.id);
    const grantRowsForOrg = customIds.length
      ? await tx
          .select({ roleId: rolePermissions.roleId, moduleKey: rolePermissions.moduleKey, permission: rolePermissions.permission })
          .from(rolePermissions)
          .where(and(eq(rolePermissions.orgId, admin.orgId), inArray(rolePermissions.roleId, customIds)))
      : [];

    const systemCounts = await tx
      .select({ role: users.role, n: count() })
      .from(users)
      .where(and(eq(users.orgId, admin.orgId), ne(users.status, "exited")))
      .groupBy(users.role);
    const customCounts = await tx
      .select({ roleId: users.customRoleId, n: count() })
      .from(users)
      .where(and(eq(users.orgId, admin.orgId), isNotNull(users.customRoleId), ne(users.status, "exited")))
      .groupBy(users.customRoleId);

    const systemCount = new Map(systemCounts.map((c) => [c.role, Number(c.n)]));
    const customCount = new Map(customCounts.map((c) => [c.roleId, Number(c.n)]));

    const order = ["owner", "admin", "developer", "manager", "member"];
    const system = roleRows
      .filter((r) => r.isSystem && isSystemRole(r.slug))
      .sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug))
      .map((r) => ({
        slug: r.slug,
        name: r.name,
        defaults: PERMISSIONS.filter((p) => SYSTEM_ROLE_DEFAULTS[r.slug as keyof typeof SYSTEM_ROLE_DEFAULTS].has(p)),
        memberCount: systemCount.get(r.slug) ?? 0,
      }));

    const custom = roleRows
      .filter((r) => !r.isSystem)
      .map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        grants: grantsFromRows(grantRowsForOrg.filter((g) => g.roleId === r.id)),
        memberCount: customCount.get(r.id) ?? 0,
      }));

    return { system, custom };
  });
}

export async function loadCustomRole(admin: OrgAdmin, roleId: string): Promise<CustomRoleSummary | null> {
  const { custom } = await loadRoles(admin);
  return custom.find((r) => r.id === roleId) ?? null;
}

export interface AccessPerson {
  id: string;
  name: string;
  role: string;
}

export interface AccessData {
  // roleRules[role][feature] = allowed (absent = visible)
  roleRules: Record<string, Record<string, boolean>>;
  // userRules[userId][feature] = allowed (absent = follows role)
  userRules: Record<string, Record<string, boolean>>;
  people: AccessPerson[];
}

export async function loadAccess(admin: OrgAdmin): Promise<AccessData> {
  return withTransaction({ id: admin.userId }, async (tx) => {
    const rules = await tx
      .select({
        subjectType: featureAccess.subjectType,
        subjectKey: featureAccess.subjectKey,
        featureKey: featureAccess.featureKey,
        allowed: featureAccess.allowed,
      })
      .from(featureAccess)
      .where(and(eq(featureAccess.orgId, admin.orgId), inArray(featureAccess.featureKey, [...ACCESS_FEATURE_KEYS])));

    const people = await tx
      .select({ id: users.id, fullName: users.fullName, email: users.email, role: users.role })
      .from(users)
      .where(and(eq(users.orgId, admin.orgId), eq(users.status, "active")))
      .orderBy(asc(users.fullName));

    const roleRules: AccessData["roleRules"] = {};
    const userRules: AccessData["userRules"] = {};
    for (const r of rules) {
      const bucket = r.subjectType === "role" ? roleRules : userRules;
      (bucket[r.subjectKey] ??= {})[r.featureKey] = r.allowed;
    }

    return {
      roleRules,
      userRules,
      // Owners and admins bypass feature rules, so they are not listed.
      people: people
        .filter((p) => p.role !== "owner" && p.role !== "admin")
        .map((p) => ({ id: p.id, name: p.fullName || p.email || "Unnamed", role: p.role ?? "member" })),
    };
  });
}
