"use server";

// Attendance Server Actions for the new stack (Phase 4 item 3). Same shape
// as leave: both gates via requireFeature("me", "me", …); the org, the
// person, "now" and "today" (in the org's time zone) come from the server;
// writes run as the caller under RLS and the v1.9.1 guards
// (attendance_guard, attendance_regularizations_guard); an audit row per
// change; events published after commit with the payload shapes the legacy
// processors read.
//
// One behaviour change from the legacy screens: approving a correction
// updates the request and applies the corrected times to the attendance row
// in ONE transaction — the legacy approval screens do it as two separate
// writes that can half-fail. And the request publishes
// `attendance.regularization.created`, the event the processors handle (the
// legacy dashboard publishes `…requested`, which nothing handles, so the
// manager was never notified).

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { action, ActionError } from "../../actions";
import { withTransaction } from "../../../db/transaction";
import { attendance, attendanceRegularizations } from "../../../db/schema/hrms";
import { getSupabaseServerClient } from "../../supabase/server";
import { publishEvent } from "../../events/publish";
import { requireFeature } from "../../auth/permissions";
import { orgTimeZone } from "./queries";
import {
  dayIn,
  decideCorrectionSchema,
  hoursBetween,
  locationSchema,
  onOrNearDay,
  requestCorrectionSchema,
} from "./schemas";

const PATHS = ["/hrms/attendance", "/hrms/attendance/approvals"];

async function publish(orgId: string, eventType: string, payload: Record<string, unknown>) {
  const supabase = await getSupabaseServerClient();
  await publishEvent(supabase, { eventType, orgId, payload });
}

/** Walks Drizzle/postgres.js error wrapping. */
function pgError(err: unknown): { code?: string; message?: string } {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return { code, message: String((e as { message?: unknown }).message ?? "") };
    e = (e as { cause?: unknown }).cause;
  }
  return {};
}

/** The database's own refusals, said plainly. Anything else is rethrown. */
function explain(err: unknown): never {
  const { code, message = "" } = pgError(err);
  if (message.includes("LOCATION_REQUIRED")) {
    throw new ActionError("Allow location access — attendance is recorded at your workplace.");
  }
  if (message.includes("OUTSIDE_ALLOTTED_LOCATION")) {
    throw new ActionError("You need to be at one of your organisation's workplaces to do that.");
  }
  if (code === "23505") throw new ActionError("You have already checked in today.");
  if (code === "42501") throw new ActionError(message.replace(/^.*?:\s*/, "") || "That isn't allowed.");
  throw err;
}

// ---------------------------------------------------------------------------
// Check in / check out
// ---------------------------------------------------------------------------

export const checkIn = action(locationSchema, async (input) => {
  const ctx = await requireFeature("me", "me", "create");
  const today = dayIn(await orgTimeZone(ctx));
  const now = new Date();

  const row = await withTransaction({ id: ctx.userId }, async (tx, audit) => {
    let inserted: { id: string };
    try {
      [inserted] = await tx
        .insert(attendance)
        .values({
          orgId: ctx.orgId,
          userId: ctx.userId,
          date: today,
          checkIn: now,
          status: "present",
          checkInLat: input.lat == null ? null : String(input.lat),
          checkInLng: input.lng == null ? null : String(input.lng),
        })
        .returning({ id: attendance.id });
    } catch (err) {
      explain(err);
    }
    await audit({
      orgId: ctx.orgId,
      module: "attendance",
      entityType: "attendance",
      entityId: inserted.id,
      action: "check_in",
      newValues: { date: today, check_in: now.toISOString() },
    });
    return inserted;
  });

  await publish(ctx.orgId, "attendance.checkin.completed", {
    user_id: ctx.userId,
    org_id: ctx.orgId,
    check_in_time: now.toISOString(),
  });
  for (const p of PATHS) revalidatePath(p);
  return { id: row.id, checkIn: now.toISOString() };
});

export const checkOut = action(locationSchema, async (input) => {
  const ctx = await requireFeature("me", "me", "edit");
  const today = dayIn(await orgTimeZone(ctx));
  const now = new Date();

  const result = await withTransaction({ id: ctx.userId }, async (tx, audit) => {
    const [open] = await tx
      .select({ id: attendance.id, checkIn: attendance.checkIn, checkOut: attendance.checkOut })
      .from(attendance)
      .where(and(eq(attendance.userId, ctx.userId), eq(attendance.orgId, ctx.orgId), eq(attendance.date, today)))
      .limit(1);
    if (!open || !open.checkIn) throw new ActionError("You haven't checked in today.");
    if (open.checkOut) throw new ActionError("You have already checked out today.");

    const totalHours = hoursBetween(open.checkIn, now);
    let rows: { id: string }[];
    try {
      rows = await tx
        .update(attendance)
        .set({
          checkOut: now,
          totalHours: String(totalHours),
          checkOutLat: input.lat == null ? null : String(input.lat),
          checkOutLng: input.lng == null ? null : String(input.lng),
        })
        .where(and(eq(attendance.id, open.id), eq(attendance.userId, ctx.userId), isNull(attendance.checkOut)))
        .returning({ id: attendance.id });
    } catch (err) {
      explain(err);
    }
    if (rows.length === 0) throw new ActionError("You have already checked out today.");
    await audit({
      orgId: ctx.orgId,
      module: "attendance",
      entityType: "attendance",
      entityId: open.id,
      action: "check_out",
      newValues: { check_out: now.toISOString(), total_hours: totalHours },
    });
    return { id: open.id, totalHours };
  });

  for (const p of PATHS) revalidatePath(p);
  return { ...result, checkOut: now.toISOString() };
});

// ---------------------------------------------------------------------------
// Corrections (regularisations)
// ---------------------------------------------------------------------------

export const requestCorrection = action(requestCorrectionSchema, async (input) => {
  const ctx = await requireFeature("me", "me", "create");

  const created = await withTransaction({ id: ctx.userId }, async (tx, audit) => {
    const [day] = await tx
      .select({ id: attendance.id, date: attendance.date })
      .from(attendance)
      .where(and(eq(attendance.id, input.attendanceId), eq(attendance.userId, ctx.userId), eq(attendance.orgId, ctx.orgId)))
      .limit(1);
    if (!day) throw new ActionError("That day was not found in your attendance.");

    for (const [field, value] of [
      ["requestedCheckIn", input.requestedCheckIn],
      ["requestedCheckOut", input.requestedCheckOut],
    ] as const) {
      if (value && !onOrNearDay(value, day.date)) {
        throw new ActionError("Please check the highlighted fields.", { [field]: ["Pick a time on that day."] });
      }
    }

    const [open] = await tx
      .select({ id: attendanceRegularizations.id })
      .from(attendanceRegularizations)
      .where(and(eq(attendanceRegularizations.attendanceId, day.id), eq(attendanceRegularizations.status, "pending")))
      .limit(1);
    if (open) throw new ActionError("You already asked for a correction to this day.");

    const [reg] = await tx
      .insert(attendanceRegularizations)
      .values({
        orgId: ctx.orgId,
        userId: ctx.userId,
        attendanceId: day.id,
        reason: input.reason,
        requestedCheckIn: input.requestedCheckIn ? new Date(input.requestedCheckIn) : null,
        requestedCheckOut: input.requestedCheckOut ? new Date(input.requestedCheckOut) : null,
      })
      .returning({ id: attendanceRegularizations.id });
    await audit({
      orgId: ctx.orgId,
      module: "attendance",
      entityType: "regularization",
      entityId: reg.id,
      action: "created",
      newValues: { date: day.date, reason: input.reason },
    });
    return reg;
  });

  await publish(ctx.orgId, "attendance.regularization.created", {
    regularization_id: created.id,
    user_id: ctx.userId,
    org_id: ctx.orgId,
  });
  for (const p of PATHS) revalidatePath(p);
  return { id: created.id };
});

export const decideCorrection = action(decideCorrectionSchema, async (input) => {
  const ctx = await requireFeature("me", "me", "approve");
  const status = input.decision === "approve" ? "approved" : "rejected";

  const reg = await withTransaction({ id: ctx.userId }, async (tx, audit) => {
    const [r] = await tx
      .select({
        id: attendanceRegularizations.id,
        userId: attendanceRegularizations.userId,
        attendanceId: attendanceRegularizations.attendanceId,
        requestedCheckIn: attendanceRegularizations.requestedCheckIn,
        requestedCheckOut: attendanceRegularizations.requestedCheckOut,
      })
      .from(attendanceRegularizations)
      .where(and(eq(attendanceRegularizations.id, input.regularizationId), eq(attendanceRegularizations.orgId, ctx.orgId)))
      .limit(1);
    if (!r) throw new ActionError("That request was not found.");
    if (r.userId === ctx.userId) throw new ActionError("You can't approve or reject your own correction.");

    let decided: { id: string }[];
    try {
      decided = await tx
        .update(attendanceRegularizations)
        // reviewed_by / reviewed_at are stamped by the database guard.
        .set({ status })
        .where(and(eq(attendanceRegularizations.id, r.id), eq(attendanceRegularizations.status, "pending")))
        .returning({ id: attendanceRegularizations.id });
    } catch (err) {
      explain(err);
    }
    if (decided.length === 0) throw new ActionError("That request has already been decided.");

    let applied: Record<string, unknown> | null = null;
    if (status === "approved") {
      const [day] = await tx
        .select({ checkIn: attendance.checkIn, checkOut: attendance.checkOut })
        .from(attendance)
        .where(and(eq(attendance.id, r.attendanceId), eq(attendance.orgId, ctx.orgId)))
        .limit(1);
      if (!day) throw new ActionError("That day's attendance was not found.");
      const checkIn = r.requestedCheckIn ?? day.checkIn;
      const checkOut = r.requestedCheckOut ?? day.checkOut;
      const totalHours = checkIn && checkOut ? String(hoursBetween(checkIn, checkOut)) : null;
      try {
        await tx
          .update(attendance)
          .set({ checkIn, checkOut, totalHours, ...(checkIn && checkOut ? { status: "present" } : {}) })
          .where(and(eq(attendance.id, r.attendanceId), eq(attendance.orgId, ctx.orgId)));
      } catch (err) {
        explain(err);
      }
      applied = { check_in: checkIn?.toISOString() ?? null, check_out: checkOut?.toISOString() ?? null, total_hours: totalHours };
    }

    await audit({
      orgId: ctx.orgId,
      module: "attendance",
      entityType: "regularization",
      entityId: r.id,
      action: status,
      oldValues: { status: "pending" },
      newValues: { status, applied },
    });
    return r;
  });

  if (status === "approved") {
    await publish(ctx.orgId, "attendance.regularization.approved", {
      regularization_id: reg.id,
      user_id: reg.userId,
      org_id: ctx.orgId,
    });
  }
  for (const p of PATHS) revalidatePath(p);
  return { id: reg.id, status };
});
