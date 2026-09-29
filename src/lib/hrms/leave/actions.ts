"use server";

// Leave Server Actions for the new stack (Phase 4 item 3, starting with
// leave). Every action:
//   - passes both gates (CLAUDE.md §3; Phase 3 item 4 carried forward):
//     requireFeature("me", "me", …) — the `me` module is on for the org, the
//     role grants the permission, and feature_access lets this person see it;
//   - takes the org and the person from the session, never from input, and
//     works out the days on the server;
//   - writes inside withTransaction as the caller, so RLS and the v1.7.1
//     leave_requests_guard() decide what is allowed (nobody approves their
//     own leave; an owner's/admin's leave needs an admin/owner);
//   - adds an audit row, and publishes after commit with the payload shape
//     the legacy event processors already read.
// Holiday-aware day counting and the sandwich warning stay as in the legacy
// app (weekends only; the warning is shown by the screen, not enforced).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { action, ActionError, type ActionResponse } from "../../actions";
import { withTransaction } from "../../../db/transaction";
import { leaveBalances, leaveRequests, leaveTypes } from "../../../db/schema/hrms";
import { getSupabaseServerClient } from "../../supabase/server";
import { publishEvent } from "../../events/publish";
import { requireFeature } from "../../auth/permissions";
import { leaveDays } from "./days";
import {
  applyLeaveSchema,
  cancelLeaveSchema,
  decideLeaveSchema,
  LEAVE_DOCUMENT_MAX_BYTES,
  LEAVE_DOCUMENT_TYPES,
} from "./schemas";

const LEAVE_PATHS = ["/hrms/leave", "/hrms/leave/approvals"];

async function publish(orgId: string, eventType: string, payload: Record<string, unknown>) {
  const supabase = await getSupabaseServerClient();
  await publishEvent(supabase, { eventType, orgId, payload });
}

/** A Postgres error with this SQLSTATE, however Drizzle/postgres.js wrapped it. */
function hasPgCode(err: unknown, code: string): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    if ((e as { code?: unknown }).code === code) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

const fieldError = (field: string, message: string) =>
  new ActionError("Please check the highlighted fields.", { [field]: [message] });

function safeFileName(name: string): string {
  const cleaned = name.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "document").slice(-80);
}

// ---------------------------------------------------------------------------
// Request leave
// ---------------------------------------------------------------------------

const applyWithDocumentSchema = applyLeaveSchema.and(
  z.object({ document: z.instanceof(File).nullable() })
);

const applyAction = action(applyWithDocumentSchema, async (input) => {
  const ctx = await requireFeature("me", "me", "create");

  const days = leaveDays(input.startDate, input.endDate, input.halfDay);
  if (days <= 0) throw fieldError("endDate", "There are no working days in the dates you chose.");
  const year = Number(input.startDate.slice(0, 4));

  // 1. Check everything before anything is uploaded or written.
  const type = await withTransaction({ id: ctx.userId }, async (tx) => {
    const [t] = await tx
      .select({
        id: leaveTypes.id,
        name: leaveTypes.name,
        requiresDocument: leaveTypes.requiresDocument,
        maxConsecutiveDays: leaveTypes.maxConsecutiveDays,
      })
      .from(leaveTypes)
      .where(and(eq(leaveTypes.id, input.leaveTypeId), eq(leaveTypes.orgId, ctx.orgId), eq(leaveTypes.isActive, true)))
      .limit(1);
    if (!t) throw fieldError("leaveTypeId", "Choose a leave type.");

    if (t.maxConsecutiveDays && days > t.maxConsecutiveDays) {
      throw fieldError("endDate", `${t.name} allows at most ${t.maxConsecutiveDays} days in a row.`);
    }
    if (t.requiresDocument && !input.document) {
      throw fieldError("document", `${t.name} needs a supporting document.`);
    }

    // New on the new stack: no overlap with your own pending or approved leave.
    const [overlap] = await tx
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.userId, ctx.userId),
          eq(leaveRequests.orgId, ctx.orgId),
          inArray(leaveRequests.status, ["pending", "approved"]),
          lte(leaveRequests.startDate, input.endDate),
          gte(leaveRequests.endDate, input.startDate)
        )
      )
      .limit(1);
    if (overlap) throw fieldError("startDate", "You already have leave requested or approved on some of these dates.");

    // The legacy rule: only checked when a balance exists for that year.
    const [bal] = await tx
      .select({ balance: leaveBalances.balance })
      .from(leaveBalances)
      .where(
        and(eq(leaveBalances.userId, ctx.userId), eq(leaveBalances.leaveTypeId, t.id), eq(leaveBalances.year, year))
      )
      .limit(1);
    if (bal) {
      const [{ pending }] = await tx
        .select({ pending: sql<string>`coalesce(sum(${leaveRequests.days}), 0)` })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.userId, ctx.userId),
            eq(leaveRequests.leaveTypeId, t.id),
            eq(leaveRequests.status, "pending"),
            gte(leaveRequests.startDate, `${year}-01-01`),
            lte(leaveRequests.startDate, `${year}-12-31`)
          )
        );
      const available = Number(bal.balance ?? 0) - Number(pending ?? 0);
      if (days > available) {
        throw fieldError("leaveTypeId", `Not enough ${t.name} left: ${Math.max(available, 0)} day(s) available.`);
      }
    }
    return t;
  });

  // 2. The document, uploaded as the caller (storage policies scope it to
  //    leave-docs/{org}/{self}/).
  let documentPath: string | null = null;
  const supabase = await getSupabaseServerClient();
  if (input.document) {
    const file = input.document;
    if (file.size > LEAVE_DOCUMENT_MAX_BYTES) throw fieldError("document", "The document must be 4 MB or smaller.");
    if (!(LEAVE_DOCUMENT_TYPES as readonly string[]).includes(file.type)) {
      throw fieldError("document", "Attach a PDF or a photo (JPG, PNG, WEBP or HEIC).");
    }
    const path = `leave-docs/${ctx.orgId}/${ctx.userId}/${Date.now()}_${safeFileName(file.name)}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      console.error("[leave] document upload failed", error.message);
      throw fieldError("document", "The document could not be uploaded. Please try again.");
    }
    documentPath = path;
  }

  // 3. The request and its audit row.
  let created: { id: string };
  try {
    created = await withTransaction({ id: ctx.userId }, async (tx, audit) => {
      const [row] = await tx
        .insert(leaveRequests)
        .values({
          orgId: ctx.orgId,
          userId: ctx.userId,
          leaveTypeId: type.id,
          startDate: input.startDate,
          endDate: input.endDate,
          days: String(days),
          reason: input.reason ?? null,
          documentUrl: documentPath,
        })
        .returning({ id: leaveRequests.id });
      await audit({
        orgId: ctx.orgId,
        module: "leave",
        entityType: "leave_request",
        entityId: row.id,
        action: "created",
        newValues: { start_date: input.startDate, end_date: input.endDate, days, leave_type: type.name },
      });
      return row;
    });
  } catch (err) {
    // Don't leave an orphaned document behind.
    if (documentPath) await supabase.storage.from("documents").remove([documentPath]);
    throw err;
  }

  await publish(ctx.orgId, "leave.request.created", {
    leave_request_id: created.id,
    user_id: ctx.userId,
    org_id: ctx.orgId,
  });
  for (const p of LEAVE_PATHS) revalidatePath(p);
  return { id: created.id, days };
});

/** Request leave. Takes FormData so a supporting document can come with it. */
export async function applyForLeave(formData: FormData): Promise<ActionResponse<{ id: string; days: number }>> {
  const doc = formData.get("document");
  return applyAction({
    leaveTypeId: formData.get("leaveTypeId"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    halfDay: formData.get("halfDay") === "true" || formData.get("halfDay") === "on",
    reason: formData.get("reason") ?? null,
    document: doc instanceof File && doc.size > 0 ? doc : null,
  });
}

// ---------------------------------------------------------------------------
// Cancel your own pending request
// ---------------------------------------------------------------------------

export const cancelLeaveRequest = action(cancelLeaveSchema, async (input) => {
  const ctx = await requireFeature("me", "me", "edit");

  await withTransaction({ id: ctx.userId }, async (tx, audit) => {
    const rows = await tx
      .update(leaveRequests)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(leaveRequests.id, input.requestId),
          eq(leaveRequests.orgId, ctx.orgId),
          eq(leaveRequests.userId, ctx.userId),
          eq(leaveRequests.status, "pending")
        )
      )
      .returning({ id: leaveRequests.id });
    if (rows.length === 0) throw new ActionError("That request can no longer be cancelled.");

    await audit({
      orgId: ctx.orgId,
      module: "leave",
      entityType: "leave_request",
      entityId: input.requestId,
      action: "cancelled",
      oldValues: { status: "pending" },
      newValues: { status: "cancelled" },
    });
  });

  for (const p of LEAVE_PATHS) revalidatePath(p);
  return { id: input.requestId };
});

// ---------------------------------------------------------------------------
// Approve or reject someone else's pending request
// ---------------------------------------------------------------------------

export const decideLeaveRequest = action(decideLeaveSchema, async (input) => {
  const ctx = await requireFeature("me", "me", "approve");
  const status = input.decision === "approve" ? "approved" : "rejected";

  const request = await withTransaction({ id: ctx.userId }, async (tx, audit) => {
    const [req] = await tx
      .select({
        id: leaveRequests.id,
        userId: leaveRequests.userId,
        leaveTypeId: leaveRequests.leaveTypeId,
        days: leaveRequests.days,
      })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.id, input.requestId), eq(leaveRequests.orgId, ctx.orgId)))
      .limit(1);
    if (!req) throw new ActionError("That request was not found.");
    if (req.userId === ctx.userId) throw new ActionError("You can't approve or reject your own leave.");

    let rows: { id: string }[];
    try {
      rows = await tx
        .update(leaveRequests)
        // reviewed_by / reviewed_at are stamped by leave_requests_guard().
        .set({ status, reviewComment: input.comment ?? null })
        .where(and(eq(leaveRequests.id, req.id), eq(leaveRequests.orgId, ctx.orgId), eq(leaveRequests.status, "pending")))
        .returning({ id: leaveRequests.id });
    } catch (err) {
      // The guard refuses with 42501 (someone else's approver, or an
      // owner's/admin's leave for a non-admin). Say so plainly.
      if (hasPgCode(err, "42501")) throw new ActionError("You can't approve or reject this leave request.");
      throw err;
    }
    if (rows.length === 0) throw new ActionError("That request has already been decided or withdrawn.");

    await audit({
      orgId: ctx.orgId,
      module: "leave",
      entityType: "leave_request",
      entityId: req.id,
      action: status,
      oldValues: { status: "pending" },
      newValues: { status, review_comment: input.comment ?? null },
    });
    return req;
  });

  if (status === "approved") {
    await publish(ctx.orgId, "leave.request.approved", {
      leave_request_id: request.id,
      user_id: request.userId,
      org_id: ctx.orgId,
      days: request.days,
      leave_type_id: request.leaveTypeId,
      approved_by: ctx.userId,
    });
  } else {
    await publish(ctx.orgId, "leave.request.rejected", {
      leave_request_id: request.id,
      user_id: request.userId,
      org_id: ctx.orgId,
    });
  }
  for (const p of LEAVE_PATHS) revalidatePath(p);
  return { id: request.id, status };
});
