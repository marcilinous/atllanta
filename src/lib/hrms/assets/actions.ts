"use server";

// Assets Server Actions for the new stack (Phase 4 item 3, v1.17.0 preview).
// Every action:
//   - passes both gates for People (CLAUDE.md §3): requireFeature("people",
//     "people", …) — the module is on for the org, the role grants the
//     permission, and feature_access lets this person see it — and is refused
//     to anyone but an owner or admin, the only people the database lets write;
//   - takes the org from the session, never from input; the creator and the
//     assigner are stamped by the database;
//   - writes inside withTransaction as the caller, so RLS and the v1.16.2
//     guards decide what is allowed (assigned only from unassigned, only to a
//     current member of the company; one open record per asset; the history is
//     only ever closed; nothing held is deleted). Assign and return change the
//     asset and its history in one transaction, in the order the guards expect;
//   - adds an audit row under module "people", and publishes after commit with
//     the legacy event names and payloads (people.asset.created / assigned /
//     returned).

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { action, ActionError } from "../../actions";
import { withTransaction } from "../../../db/transaction";
import { assetAssignments, assets } from "../../../db/schema/hrms";
import { users } from "../../../db/schema/platform";
import { getSupabaseServerClient } from "../../supabase/server";
import { publishEvent } from "../../events/publish";
import { requireFeature } from "../../auth/permissions";
import type { Permission } from "../../auth/modules";
import {
  assignAssetSchema,
  createAssetSchema,
  deleteAssetSchema,
  returnAssetSchema,
  updateAssetSchema,
} from "./schemas";

const revalidateAssets = (assetId?: string) => {
  revalidatePath("/hrms/assets");
  revalidatePath("/hrms/assets/register");
  if (assetId) revalidatePath(`/hrms/assets/register/${assetId}`);
};

async function publish(orgId: string, eventType: string, payload: Record<string, unknown>) {
  const supabase = await getSupabaseServerClient();
  await publishEvent(supabase, { eventType, orgId, payload });
}

/** Both gates for People, then owners and admins only. */
async function requireAssetAdmin(permission: Permission) {
  const ctx = await requireFeature("people", "people", permission);
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    throw new ActionError("Only an owner or admin can manage assets.");
  }
  return ctx;
}

/** The innermost Postgres error (code and message), however Drizzle/postgres.js wrapped it. */
function pgError(err: unknown): { code?: string; message?: string } | null {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return { code, message: (e as { message?: string }).message };
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

function hasPgCode(err: unknown, code: string): boolean {
  return pgError(err)?.code === code;
}

// The v1.16.2 guards' own refusals are written for people; pass them through.
const GUARD_MESSAGES = new Set([
  "Return this asset before deleting it",
  "Add the asset first, then assign it",
  "Return this asset before assigning it again",
  "That person is not a current member of this company",
  "Assign the asset to this person first",
  "Mark the asset returned first",
]);

/** Turn a database refusal into a plain message; anything else is rethrown. */
function refusal(err: unknown, fallback: string): never {
  if (hasPgCode(err, "42501")) {
    const message = pgError(err)?.message ?? "";
    throw new ActionError(GUARD_MESSAGES.has(message) ? `${message}.` : fallback);
  }
  if (hasPgCode(err, "23505")) throw new ActionError("This asset already has an open assignment. Return it first.");
  if (hasPgCode(err, "23514")) throw new ActionError(fallback);
  throw err;
}

// ---------------------------------------------------------------------------
// Add an asset (always unassigned)
// ---------------------------------------------------------------------------

export const createAsset = action(createAssetSchema, async (input) => {
  const ctx = await requireAssetAdmin("create");

  let created: { id: string };
  try {
    created = await withTransaction({ id: ctx.userId }, async (tx, audit) => {
      const [row] = await tx
        .insert(assets)
        .values({
          orgId: ctx.orgId,
          name: input.name,
          type: input.type,
          serialNumber: input.serialNumber ?? null,
          purchaseDate: input.purchaseDate ?? null,
          purchaseCost: input.purchaseCost ?? null,
          warrantyEnd: input.warrantyEnd ?? null,
          notes: input.notes ?? null,
          status: "available",
        })
        .returning({ id: assets.id });
      await audit({
        orgId: ctx.orgId,
        module: "people",
        entityType: "asset",
        entityId: row.id,
        action: "created",
        newValues: { name: input.name, type: input.type, serial_number: input.serialNumber ?? null },
      });
      return row;
    });
  } catch (err) {
    refusal(err, "This asset could not be added.");
  }

  await publish(ctx.orgId, "people.asset.created", {
    asset_id: created.id,
    name: input.name,
    type: input.type,
  });
  revalidateAssets(created.id);
  return { id: created.id };
});

// ---------------------------------------------------------------------------
// Edit an asset's details (and its status, while nobody holds it)
// ---------------------------------------------------------------------------

export const updateAsset = action(updateAssetSchema, async (input) => {
  const ctx = await requireAssetAdmin("edit");

  try {
    await withTransaction({ id: ctx.userId }, async (tx, audit) => {
      const [current] = await tx
        .select({ status: assets.status, name: assets.name, type: assets.type })
        .from(assets)
        .where(and(eq(assets.id, input.assetId), eq(assets.orgId, ctx.orgId)))
        .limit(1);
      if (!current) throw new ActionError("That asset was not found.");

      // A held asset stays "assigned": returning it is its own action.
      const status = current.status === "assigned" ? current.status : input.status;
      await tx
        .update(assets)
        .set({
          name: input.name,
          type: input.type,
          serialNumber: input.serialNumber ?? null,
          purchaseDate: input.purchaseDate ?? null,
          purchaseCost: input.purchaseCost ?? null,
          warrantyEnd: input.warrantyEnd ?? null,
          notes: input.notes ?? null,
          status,
          updatedAt: new Date(),
        })
        .where(and(eq(assets.id, input.assetId), eq(assets.orgId, ctx.orgId)));

      await audit({
        orgId: ctx.orgId,
        module: "people",
        entityType: "asset",
        entityId: input.assetId,
        action: "updated",
        oldValues: { name: current.name, type: current.type, status: current.status },
        newValues: { name: input.name, type: input.type, status },
      });
    });
  } catch (err) {
    refusal(err, "This asset could not be saved.");
  }

  revalidateAssets(input.assetId);
  return { id: input.assetId };
});

// ---------------------------------------------------------------------------
// Assign an unassigned asset to a current member of the company
// ---------------------------------------------------------------------------

export const assignAsset = action(assignAssetSchema, async (input) => {
  const ctx = await requireAssetAdmin("edit");

  let result: { id: string; name: string; personName: string };
  try {
    result = await withTransaction({ id: ctx.userId }, async (tx, audit) => {
      // 1. The asset gets its holder (assets_guard() checks the person).
      const [updated] = await tx
        .update(assets)
        .set({ status: "assigned", assignedTo: input.userId, assignedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(assets.id, input.assetId),
            eq(assets.orgId, ctx.orgId),
            inArray(assets.status, ["available", "maintenance"])
          )
        )
        .returning({ id: assets.id, name: assets.name });
      if (!updated) throw new ActionError("This asset can't be assigned now. It may be held, retired or removed.");

      // 2. Its history record, for that same person (the assigner and the time
      //    are stamped by asset_assignments_guard()).
      await tx.insert(assetAssignments).values({
        orgId: ctx.orgId,
        assetId: updated.id,
        userId: input.userId,
        notes: input.notes ?? null,
      });

      const [p] = await tx
        .select({ fullName: users.fullName, email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      const personName = p?.fullName || p?.email || "Unnamed";

      await audit({
        orgId: ctx.orgId,
        module: "people",
        entityType: "asset",
        entityId: updated.id,
        action: "assigned",
        newValues: { assigned_to: input.userId, assigned_name: personName, notes: input.notes ?? null },
      });
      return { ...updated, personName };
    });
  } catch (err) {
    refusal(err, "This asset could not be assigned.");
  }

  await publish(ctx.orgId, "people.asset.assigned", {
    asset_id: result.id,
    name: result.name,
    assigned_to: input.userId,
    assigned_name: result.personName,
  });
  revalidateAssets(result.id);
  return { id: result.id };
});

// ---------------------------------------------------------------------------
// Mark a held asset returned
// ---------------------------------------------------------------------------

export const returnAsset = action(returnAssetSchema, async (input) => {
  const ctx = await requireAssetAdmin("edit");

  let result: { id: string; name: string };
  try {
    result = await withTransaction({ id: ctx.userId }, async (tx, audit) => {
      const [current] = await tx
        .select({ holderId: assets.assignedTo })
        .from(assets)
        .where(and(eq(assets.id, input.assetId), eq(assets.orgId, ctx.orgId)))
        .limit(1);

      // 1. The asset is cleared.
      const [updated] = await tx
        .update(assets)
        .set({ status: "available", assignedTo: null, assignedAt: null, updatedAt: new Date() })
        .where(and(eq(assets.id, input.assetId), eq(assets.orgId, ctx.orgId), eq(assets.status, "assigned")))
        .returning({ id: assets.id, name: assets.name });
      if (!updated) throw new ActionError("This asset isn't assigned to anyone.");

      // 2. Its open record is closed (returned_at is stamped by the guard).
      await tx
        .update(assetAssignments)
        .set({ returnedAt: new Date() })
        .where(
          and(
            eq(assetAssignments.assetId, updated.id),
            eq(assetAssignments.orgId, ctx.orgId),
            isNull(assetAssignments.returnedAt)
          )
        );

      await audit({
        orgId: ctx.orgId,
        module: "people",
        entityType: "asset",
        entityId: updated.id,
        action: "returned",
        oldValues: { assigned_to: current?.holderId ?? null },
        newValues: { status: "available" },
      });
      return updated;
    });
  } catch (err) {
    refusal(err, "This asset could not be marked returned.");
  }

  await publish(ctx.orgId, "people.asset.returned", {
    asset_id: result.id,
    name: result.name,
  });
  revalidateAssets(result.id);
  return { id: result.id };
});

// ---------------------------------------------------------------------------
// Delete an asset nobody holds (its history goes with it)
// ---------------------------------------------------------------------------

export const deleteAsset = action(deleteAssetSchema, async (input) => {
  const ctx = await requireAssetAdmin("delete");

  try {
    await withTransaction({ id: ctx.userId }, async (tx, audit) => {
      const rows = await tx
        .delete(assets)
        .where(and(eq(assets.id, input.assetId), eq(assets.orgId, ctx.orgId), ne(assets.status, "assigned")))
        .returning({ id: assets.id, name: assets.name, type: assets.type, serialNumber: assets.serialNumber });
      if (rows.length === 0) throw new ActionError("Return this asset before deleting it, or it may already be gone.");

      await audit({
        orgId: ctx.orgId,
        module: "people",
        entityType: "asset",
        entityId: input.assetId,
        action: "deleted",
        oldValues: { name: rows[0].name, type: rows[0].type, serial_number: rows[0].serialNumber },
      });
    });
  } catch (err) {
    refusal(err, "This asset could not be deleted.");
  }

  revalidateAssets();
  return { id: input.assetId };
});
