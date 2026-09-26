import "server-only";
import { eq, and, or } from "drizzle-orm";
import { withTransaction } from "../../db/transaction";
import { users, orgModules, rolePermissions, featureAccess } from "../../db/schema/platform";
import { getSessionUser } from "../supabase/server";
import { ActionError } from "../actions";
import { MODULE_KEYS, PERMISSIONS, type ModuleKey, type Permission } from "./modules";
import {
  isSystemRole,
  can,
  type PermissionContext,
  type FeatureRule,
  type SystemRole,
} from "./permissions-core";

/**
 * Loads the caller's permission context under RLS: which modules their org
 * has enabled, their custom role's per-module grants (if any), and the
 * feature_access rules that apply to their role or to them by user id.
 * Returns null if the caller has no usable users row (no org, or a role
 * that isn't one of the five system roles).
 */
export async function loadPermissionContext(caller: { id: string }): Promise<PermissionContext | null> {
  return withTransaction(caller, async (tx) => {
    const [userRow] = await tx
      .select({ orgId: users.orgId, role: users.role, customRoleId: users.customRoleId })
      .from(users)
      .where(eq(users.id, caller.id))
      .limit(1);

    if (!userRow || !userRow.orgId || !isSystemRole(userRow.role)) {
      return null;
    }
    const orgId = userRow.orgId;
    const role: SystemRole = userRow.role;

    const moduleRows = await tx
      .select({ moduleKey: orgModules.moduleKey })
      .from(orgModules)
      .where(and(eq(orgModules.orgId, orgId), eq(orgModules.isEnabled, true)));

    const enabledModules = new Set<ModuleKey>();
    for (const row of moduleRows) {
      if ((MODULE_KEYS as readonly string[]).includes(row.moduleKey)) {
        enabledModules.add(row.moduleKey as ModuleKey);
      }
    }

    const customGrants = new Map<ModuleKey, Set<Permission>>();
    if (userRow.customRoleId) {
      const grantRows = await tx
        .select({ moduleKey: rolePermissions.moduleKey, permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, userRow.customRoleId));

      for (const row of grantRows) {
        // Defensive: ignore any module_key/permission value that no longer
        // matches the current MODULE_KEYS/PERMISSIONS constants.
        if (!(MODULE_KEYS as readonly string[]).includes(row.moduleKey)) continue;
        if (!(PERMISSIONS as readonly string[]).includes(row.permission)) continue;
        const moduleKey = row.moduleKey as ModuleKey;
        const permission = row.permission as Permission;
        if (!customGrants.has(moduleKey)) customGrants.set(moduleKey, new Set());
        customGrants.get(moduleKey)!.add(permission);
      }
    }

    const featureRows = await tx
      .select({
        subjectType: featureAccess.subjectType,
        subjectKey: featureAccess.subjectKey,
        featureKey: featureAccess.featureKey,
        allowed: featureAccess.allowed,
      })
      .from(featureAccess)
      .where(
        and(
          eq(featureAccess.orgId, orgId),
          or(
            and(eq(featureAccess.subjectType, "role"), eq(featureAccess.subjectKey, role)),
            and(eq(featureAccess.subjectType, "user"), eq(featureAccess.subjectKey, caller.id))
          )
        )
      );

    const featureRules: FeatureRule[] = featureRows.map((row) => ({
      subjectType: row.subjectType as "role" | "user",
      subjectKey: row.subjectKey,
      featureKey: row.featureKey,
      allowed: row.allowed,
    }));

    return {
      userId: caller.id,
      orgId,
      role,
      customRoleId: userRow.customRoleId ?? null,
      enabledModules,
      customGrants,
      featureRules,
    };
  });
}

/**
 * Guard for use inside an `action()` handler: loads the session user, loads
 * their permission context, and throws `ActionError` (whose message is the
 * user-facing string an action returns as `error`) if they are signed out or
 * lack `permission` on `module`. The AI Assistant path must call this same
 * function rather than re-implementing permission checks (CLAUDE.md §3.5).
 */
export async function requirePermission(module: ModuleKey, permission: Permission): Promise<PermissionContext> {
  const user = await getSessionUser();
  if (!user) {
    throw new ActionError("You must be signed in to do that.");
  }
  const ctx = await loadPermissionContext(user);
  if (!ctx || !can(ctx, module, permission)) {
    throw new ActionError("You don't have access to do that.");
  }
  return ctx;
}
