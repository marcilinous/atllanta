"use server";

import { action, ActionError } from "../actions";
import { withTransaction } from "../../db/transaction";
import { organizations, departments } from "../../db/schema/platform";
import { eq } from "drizzle-orm";
import { getSessionUser, getSupabaseServerClient } from "../supabase/server";
import { publishEvent } from "../events/publish";
import { renameOrganizationSchema, createDepartmentSchema } from "./schemas";

export const renameOrganization = action(renameOrganizationSchema, async (input) => {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    throw new ActionError("You must be signed in to do that.");
  }

  const updated = await withTransaction(sessionUser, async (tx, audit) => {
    // orgId comes from the client and is never trusted as authorisation on
    // its own — RLS is what decides whether this row is visible to this
    // caller. If it filters the update out, `.returning()` comes back empty
    // and that looks identical to "doesn't exist", which is the point: we
    // don't leak which one it was. RLS applies here because withTransaction
    // runs this transaction as the caller (role `authenticated`), see
    // src/db/as-caller.ts.
    const rows = await tx
      .update(organizations)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(organizations.id, input.orgId))
      .returning({ id: organizations.id, name: organizations.name });

    if (rows.length === 0) {
      throw new ActionError("Organisation not found or you do not have access to it.");
    }

    const org = rows[0];

    await audit({
      orgId: org.id,
      module: "platform",
      entityType: "organization",
      entityId: org.id,
      action: "renamed",
      newValues: { name: org.name },
    });

    return org;
  });

  // Publish only after the transaction above has committed. A Drizzle
  // transaction cannot roll back an RPC call, so publishing inside it would
  // risk an event for a write that then rolled back. The trade-off we accept
  // instead: if the process dies right here, between commit and publish, the
  // event is lost, not invented. Nothing recovers it automatically today --
  // the drain worker claims from the events table, so an event that never
  // got published is invisible to it; the audit row written above is the
  // only record that the change happened. Do not "fix" this by moving the
  // publish inside the transaction above.
  const supabase = await getSupabaseServerClient();
  await publishEvent(supabase, {
    eventType: "platform.organization.renamed",
    orgId: updated.id,
    payload: { name: updated.name },
  });

  return { id: updated.id };
});

export const createDepartment = action(createDepartmentSchema, async (input) => {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    throw new ActionError("You must be signed in to do that.");
  }

  const department = await withTransaction(sessionUser, async (tx, audit) => {
    // Same rule as renameOrganization: no app-level "does this user belong
    // to this org" check here. If RLS's WITH CHECK rejects the insert,
    // Postgres itself refuses it; the empty-rows branch below is only a
    // defensive fallback for the rare case it comes back empty some other way.
    const rows = await tx
      .insert(departments)
      .values({
        orgId: input.orgId,
        name: input.name,
        headId: input.headId ?? null,
      })
      .returning({
        id: departments.id,
        name: departments.name,
        orgId: departments.orgId,
        headId: departments.headId,
      });

    if (rows.length === 0) {
      throw new ActionError("Could not create that department. Check your access to this organisation.");
    }

    const dept = rows[0];

    await audit({
      orgId: dept.orgId,
      module: "platform",
      entityType: "department",
      entityId: dept.id,
      action: "created",
      newValues: { name: dept.name, headId: dept.headId },
    });

    return dept;
  });

  // Publish after commit for the same reason, and under the same trade-off,
  // as renameOrganization above — see the comment there. Do not move this
  // inside the transaction.
  const supabase = await getSupabaseServerClient();
  await publishEvent(supabase, {
    eventType: "platform.department.created",
    orgId: department.orgId,
    payload: { name: department.name, headId: department.headId },
  });

  return { id: department.id };
});
