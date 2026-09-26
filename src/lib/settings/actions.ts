"use server";

// Server Actions for the Phase 3 admin screens (app/(platform)/settings/).
//
// Every action follows the platform pattern (src/lib/platform/actions.ts):
// validate -> requireOrgAdmin -> transact as the caller (row + audit row)
// -> commit -> publish -> revalidate. Two differences from that file:
//
// - The org is never an input. It comes from the caller's own users row
//   (requireOrgAdmin), and every query is additionally filtered by it, so a
//   forged id from another org matches nothing even before RLS looks at it.
// - RLS (is_org_admin() on roles, role_permissions, org_modules and
//   feature_access) is still the boundary: withTransaction runs as the
//   caller, so a caller demoted between the check and the write is refused
//   by Postgres.
//
// Events publish after commit and are lost, not invented, if the process
// dies in between — the trade-off documented in src/lib/platform/actions.ts.

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { action, ActionError } from "../actions";
import { withTransaction } from "../../db/transaction";
import { featureAccess, orgModules, rolePermissions, roles, users } from "../../db/schema/platform";
import { getSupabaseServerClient } from "../supabase/server";
import { publishEvent } from "../events/publish";
import { requireOrgAdmin } from "../auth/admin";
import {
  grantRows,
  grantsFromRows,
  slugify,
  SYSTEM_ROLE_SLUGS,
} from "./catalogue";
import {
  setModuleEnabledSchema,
  createCustomRoleSchema,
  updateCustomRoleSchema,
  deleteCustomRoleSchema,
  setFeatureRuleSchema,
} from "./schemas";

async function publish(orgId: string, eventType: string, payload: Record<string, unknown>) {
  const supabase = await getSupabaseServerClient();
  await publishEvent(supabase, { eventType, orgId, payload });
}

/** Postgres unique_violation, however Drizzle/postgres.js wrapped it. */
function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

const NAME_TAKEN = { name: ["A role with this name already exists."] };

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export const setModuleEnabled = action(setModuleEnabledSchema, async (input) => {
  const admin = await requireOrgAdmin();

  const changed = await withTransaction({ id: admin.userId }, async (tx, audit) => {
    const [current] = await tx
      .select({ id: orgModules.id, isEnabled: orgModules.isEnabled })
      .from(orgModules)
      .where(and(eq(orgModules.orgId, admin.orgId), eq(orgModules.moduleKey, input.moduleKey)))
      .for("update");

    if (!current) {
      throw new ActionError("That module is not set up for your organisation yet. Contact support.");
    }
    if (current.isEnabled === input.enabled) return false;

    const rows = await tx
      .update(orgModules)
      .set({
        isEnabled: input.enabled,
        enabledBy: input.enabled ? admin.userId : null,
        enabledAt: input.enabled ? new Date() : null,
      })
      .where(and(eq(orgModules.id, current.id), eq(orgModules.orgId, admin.orgId)))
      .returning({ id: orgModules.id });
    if (rows.length === 0) {
      throw new ActionError("Only owners and admins can change these settings.");
    }

    await audit({
      orgId: admin.orgId,
      module: "platform",
      entityType: "org_module",
      entityId: current.id,
      action: input.enabled ? "enabled" : "disabled",
      oldValues: { module_key: input.moduleKey, is_enabled: current.isEnabled },
      newValues: { module_key: input.moduleKey, is_enabled: input.enabled },
    });
    return true;
  });

  if (changed) {
    await publish(admin.orgId, input.enabled ? "platform.module.enabled" : "platform.module.disabled", {
      module_key: input.moduleKey,
    });
  }
  revalidatePath("/settings/modules");
  return { moduleKey: input.moduleKey, enabled: input.enabled, changed };
});

// ---------------------------------------------------------------------------
// Custom roles
// ---------------------------------------------------------------------------

export const createCustomRole = action(createCustomRoleSchema, async (input) => {
  const admin = await requireOrgAdmin();

  const baseSlug = slugify(input.name);
  if ((SYSTEM_ROLE_SLUGS as readonly string[]).includes(baseSlug)) {
    throw new ActionError("Please check the highlighted fields.", {
      name: ["That name belongs to a built-in role. Choose another."],
    });
  }
  // A name with no ASCII letters or digits still needs a unique slug.
  const slug = baseSlug || `role-${crypto.randomUUID().slice(0, 8)}`;
  const rows = grantRows(input.grants);

  const role = await withTransaction({ id: admin.userId }, async (tx, audit) => {
      const [clash] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(
          and(
            eq(roles.orgId, admin.orgId),
            sql`(lower(${roles.name}) = lower(${input.name}) or ${roles.slug} = ${slug})`
          )
        )
        .limit(1);
      if (clash) throw new ActionError("Please check the highlighted fields.", NAME_TAKEN);

      let created: { id: string; name: string; slug: string };
      try {
        [created] = await tx
          .insert(roles)
          .values({
            orgId: admin.orgId,
            name: input.name,
            slug,
            isSystem: false,
            description: input.description ?? null,
            createdBy: admin.userId,
          })
          .returning({ id: roles.id, name: roles.name, slug: roles.slug });
      } catch (err) {
        // Two admins creating the same name at once: the second loses the
        // race on unique (org_id, slug). Caught here, inside the
        // transaction, because withTransaction replaces any other error
        // with a generic one; throwing still rolls the transaction back.
        if (isUniqueViolation(err)) throw new ActionError("Please check the highlighted fields.", NAME_TAKEN);
        throw err;
      }

      if (rows.length > 0) {
        await tx.insert(rolePermissions).values(
          rows.map((r) => ({ orgId: admin.orgId, roleId: created.id, moduleKey: r.moduleKey, permission: r.permission }))
        );
      }

      await audit({
        orgId: admin.orgId,
        module: "platform",
        entityType: "role",
        entityId: created.id,
        action: "created",
        newValues: { name: created.name, slug: created.slug, description: input.description ?? null, grants: input.grants },
      });
      return created;
    });

  await publish(admin.orgId, "platform.role.created", { role_id: role.id, name: role.name, slug: role.slug });
  revalidatePath("/settings/roles");
  return { id: role.id };
});

export const updateCustomRole = action(updateCustomRoleSchema, async (input) => {
  const admin = await requireOrgAdmin();
  const nextRows = grantRows(input.grants);

  const result = await withTransaction({ id: admin.userId }, async (tx, audit) => {
    const [current] = await tx
      .select({ id: roles.id, name: roles.name, description: roles.description })
      .from(roles)
      .where(and(eq(roles.id, input.roleId), eq(roles.orgId, admin.orgId), eq(roles.isSystem, false)))
      .for("update");
    if (!current) throw new ActionError("That role was not found. It may have been deleted.");

    const [clash] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(eq(roles.orgId, admin.orgId), ne(roles.id, current.id), sql`lower(${roles.name}) = lower(${input.name})`)
      )
      .limit(1);
    if (clash) throw new ActionError("Please check the highlighted fields.", NAME_TAKEN);

    const oldGrantRows = await tx
      .select({ moduleKey: rolePermissions.moduleKey, permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.roleId, current.id), eq(rolePermissions.orgId, admin.orgId)));
    const oldGrants = grantsFromRows(oldGrantRows);

    const nextDescription = input.description ?? null;
    const detailsChanged = current.name !== input.name || (current.description ?? null) !== nextDescription;
    const grantsChanged =
      JSON.stringify(grantRows(oldGrants)) !== JSON.stringify(nextRows);
    if (!detailsChanged && !grantsChanged) return { id: current.id, name: current.name, changed: false };

    if (detailsChanged) {
      // The slug stays as created: it is an identifier, not a label.
      const updated = await tx
        .update(roles)
        .set({ name: input.name, description: nextDescription })
        .where(and(eq(roles.id, current.id), eq(roles.orgId, admin.orgId), eq(roles.isSystem, false)))
        .returning({ id: roles.id });
      if (updated.length === 0) throw new ActionError("Only owners and admins can change these settings.");
    }

    if (grantsChanged) {
      await tx
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, current.id), eq(rolePermissions.orgId, admin.orgId)));
      if (nextRows.length > 0) {
        await tx.insert(rolePermissions).values(
          nextRows.map((r) => ({ orgId: admin.orgId, roleId: current.id, moduleKey: r.moduleKey, permission: r.permission }))
        );
      }
    }

    await audit({
      orgId: admin.orgId,
      module: "platform",
      entityType: "role",
      entityId: current.id,
      action: "updated",
      oldValues: { name: current.name, description: current.description ?? null, grants: oldGrants },
      newValues: { name: input.name, description: nextDescription, grants: input.grants },
    });
    return { id: current.id, name: input.name, changed: true };
  });

  if (result.changed) {
    await publish(admin.orgId, "platform.role.updated", { role_id: result.id, name: result.name });
  }
  revalidatePath("/settings/roles");
  revalidatePath(`/settings/roles/${result.id}`);
  return { id: result.id, changed: result.changed };
});

export const deleteCustomRole = action(deleteCustomRoleSchema, async (input) => {
  const admin = await requireOrgAdmin();

  const deleted = await withTransaction({ id: admin.userId }, async (tx, audit) => {
    const [current] = await tx
      .select({ id: roles.id, name: roles.name, slug: roles.slug })
      .from(roles)
      .where(and(eq(roles.id, input.roleId), eq(roles.orgId, admin.orgId), eq(roles.isSystem, false)))
      .for("update");
    if (!current) throw new ActionError("That role was not found. It may have been deleted.");

    // Deleting a role clears users.custom_role_id (on delete set null), and
    // users_guard_admin_fields() refuses any change to your own role — so
    // Postgres would reject this with a generic error. Say why instead.
    const [self] = await tx
      .select({ customRoleId: users.customRoleId })
      .from(users)
      .where(eq(users.id, admin.userId))
      .limit(1);
    if (self?.customRoleId === current.id) {
      throw new ActionError("You can't delete a role that is assigned to you. Ask another owner or admin.");
    }

    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.orgId, admin.orgId), eq(users.customRoleId, current.id)));

    const removed = await tx
      .delete(roles)
      .where(and(eq(roles.id, current.id), eq(roles.orgId, admin.orgId), eq(roles.isSystem, false)))
      .returning({ id: roles.id });
    if (removed.length === 0) throw new ActionError("Only owners and admins can change these settings.");

    await audit({
      orgId: admin.orgId,
      module: "platform",
      entityType: "role",
      entityId: current.id,
      action: "deleted",
      oldValues: { name: current.name, slug: current.slug, assigned_users: n },
    });
    return current;
  });

  await publish(admin.orgId, "platform.role.deleted", { role_id: deleted.id, name: deleted.name });
  revalidatePath("/settings/roles");
  return { id: deleted.id };
});

// ---------------------------------------------------------------------------
// Feature access (the restored legacy editor)
// ---------------------------------------------------------------------------

export const setFeatureRule = action(setFeatureRuleSchema, async (input) => {
  const admin = await requireOrgAdmin();

  await withTransaction({ id: admin.userId }, async (tx, audit) => {
    if (input.subjectType === "user") {
      // The person must be in the caller's org. Owners and admins bypass
      // feature rules, so a rule for one would be dead weight.
      const [person] = await tx
        .select({ role: users.role })
        .from(users)
        .where(and(eq(users.id, input.subjectKey), eq(users.orgId, admin.orgId)))
        .limit(1);
      if (!person) throw new ActionError("That person was not found in your organisation.");
      if (person.role === "owner" || person.role === "admin") {
        throw new ActionError("Owners and admins always see everything.");
      }
    }

    const where = and(
      eq(featureAccess.orgId, admin.orgId),
      eq(featureAccess.subjectType, input.subjectType),
      eq(featureAccess.subjectKey, input.subjectKey),
      eq(featureAccess.featureKey, input.featureKey)
    );
    const [before] = await tx
      .select({ id: featureAccess.id, allowed: featureAccess.allowed })
      .from(featureAccess)
      .where(where)
      .limit(1);

    // No row means "visible" for a role and "follow the role" for a person,
    // so a role's "visible" and a person's "default" both clear the rule.
    const clears = input.value === "default" || (input.subjectType === "role" && input.value === "visible");
    const allowed = input.value === "visible";

    // audit_logs.entity_id is NOT NULL: the rule's own row id is the entity.
    let ruleId: string;
    if (clears) {
      if (!before) return;
      await tx.delete(featureAccess).where(where);
      ruleId = before.id;
    } else {
      if (before && before.allowed === allowed) return;
      const [saved] = await tx
        .insert(featureAccess)
        .values({
          orgId: admin.orgId,
          subjectType: input.subjectType,
          subjectKey: input.subjectKey,
          featureKey: input.featureKey,
          allowed,
        })
        .onConflictDoUpdate({
          target: [featureAccess.orgId, featureAccess.subjectType, featureAccess.subjectKey, featureAccess.featureKey],
          set: { allowed, updatedAt: new Date() },
        })
        .returning({ id: featureAccess.id });
      ruleId = saved.id;
    }

    await audit({
      orgId: admin.orgId,
      module: "platform",
      entityType: "feature_access",
      entityId: ruleId,
      action: clears ? "cleared" : allowed ? "granted" : "hidden",
      oldValues: before ? { allowed: before.allowed } : null,
      newValues: {
        subject_type: input.subjectType,
        subject_key: input.subjectKey,
        feature_key: input.featureKey,
        allowed: clears ? null : allowed,
      },
    });
  });

  revalidatePath("/settings/access");
  return { featureKey: input.featureKey, value: input.value };
});
