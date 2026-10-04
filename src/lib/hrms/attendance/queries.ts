// Read side of the new-stack attendance screens. Every loader takes the
// caller's PermissionContext (both gates already passed) and reads inside
// withTransaction — under RLS as the caller.
import "server-only";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { withTransaction } from "../../../db/transaction";
import { organizations, users } from "../../../db/schema/platform";
import { attendance, attendanceRegularizations } from "../../../db/schema/hrms";
import type { PermissionContext } from "../../auth/permissions-core";
import { dayIn } from "./schemas";

export interface AttendanceDay {
  id: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  totalHours: number | null;
  pendingCorrection: boolean;
}

export interface CorrectionRow {
  id: string;
  date: string;
  reason: string;
  requestedCheckIn: string | null;
  requestedCheckOut: string | null;
  status: string;
}

export interface MyAttendanceData {
  timeZone: string;
  today: string;
  todayRow: AttendanceDay | null;
  days: AttendanceDay[];
  corrections: CorrectionRow[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function orgTimeZone(ctx: PermissionContext): Promise<string> {
  const [org] = await withTransaction({ id: ctx.userId }, (tx) =>
    tx.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1)
  );
  return org?.timezone || "Asia/Kolkata";
}

export async function loadMyAttendance(ctx: PermissionContext): Promise<MyAttendanceData> {
  const timeZone = await orgTimeZone(ctx);
  const today = dayIn(timeZone);
  const since = dayIn(timeZone, new Date(Date.now() - 30 * 86_400_000));

  return withTransaction({ id: ctx.userId }, async (tx) => {
    const rows = await tx
      .select({
        id: attendance.id,
        date: attendance.date,
        checkIn: attendance.checkIn,
        checkOut: attendance.checkOut,
        status: attendance.status,
        totalHours: attendance.totalHours,
      })
      .from(attendance)
      .where(and(eq(attendance.userId, ctx.userId), eq(attendance.orgId, ctx.orgId), gte(attendance.date, since)))
      .orderBy(desc(attendance.date));

    const regs = await tx
      .select({
        id: attendanceRegularizations.id,
        attendanceId: attendanceRegularizations.attendanceId,
        reason: attendanceRegularizations.reason,
        requestedCheckIn: attendanceRegularizations.requestedCheckIn,
        requestedCheckOut: attendanceRegularizations.requestedCheckOut,
        status: attendanceRegularizations.status,
        date: attendance.date,
      })
      .from(attendanceRegularizations)
      .innerJoin(attendance, eq(attendance.id, attendanceRegularizations.attendanceId))
      .where(and(eq(attendanceRegularizations.userId, ctx.userId), eq(attendanceRegularizations.orgId, ctx.orgId)))
      .orderBy(desc(attendanceRegularizations.createdAt))
      .limit(30);

    const pending = new Set(regs.filter((r) => r.status === "pending").map((r) => r.attendanceId));
    const days: AttendanceDay[] = rows.map((r) => ({
      id: r.id,
      date: r.date,
      checkIn: iso(r.checkIn),
      checkOut: iso(r.checkOut),
      status: r.status ?? "present",
      totalHours: r.totalHours == null ? null : Number(r.totalHours),
      pendingCorrection: pending.has(r.id),
    }));

    return {
      timeZone,
      today,
      todayRow: days.find((d) => d.date === today) ?? null,
      days,
      corrections: regs.map((r) => ({
        id: r.id,
        date: r.date,
        reason: r.reason,
        requestedCheckIn: iso(r.requestedCheckIn),
        requestedCheckOut: iso(r.requestedCheckOut),
        status: r.status ?? "pending",
      })),
    };
  });
}

export interface CorrectionApprovalRow {
  id: string;
  personName: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  requestedCheckIn: string | null;
  requestedCheckOut: string | null;
  reason: string;
}

export interface TeamTodayRow {
  userId: string;
  name: string;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
}

export interface AttendanceApprovalsData {
  timeZone: string;
  today: string;
  pending: CorrectionApprovalRow[];
  teamToday: TeamTodayRow[];
}

/**
 * Pending corrections the caller may decide (RLS: people they can see;
 * never their own; an owner's/admin's only for an admin — the same rules
 * attendance_regularizations_guard() enforces), and who has checked in today.
 */
export async function loadAttendanceApprovals(ctx: PermissionContext): Promise<AttendanceApprovalsData> {
  const timeZone = await orgTimeZone(ctx);
  const today = dayIn(timeZone);
  const callerIsAdmin = ctx.role === "owner" || ctx.role === "admin";

  return withTransaction({ id: ctx.userId }, async (tx) => {
    const pending = await tx
      .select({
        id: attendanceRegularizations.id,
        fullName: users.fullName,
        email: users.email,
        date: attendance.date,
        checkIn: attendance.checkIn,
        checkOut: attendance.checkOut,
        requestedCheckIn: attendanceRegularizations.requestedCheckIn,
        requestedCheckOut: attendanceRegularizations.requestedCheckOut,
        reason: attendanceRegularizations.reason,
      })
      .from(attendanceRegularizations)
      .innerJoin(attendance, eq(attendance.id, attendanceRegularizations.attendanceId))
      .innerJoin(users, eq(users.id, attendanceRegularizations.userId))
      .where(
        and(
          eq(attendanceRegularizations.orgId, ctx.orgId),
          eq(attendanceRegularizations.status, "pending"),
          ne(attendanceRegularizations.userId, ctx.userId),
          callerIsAdmin ? undefined : inArray(users.role, ["manager", "member", "developer"])
        )
      )
      .orderBy(attendance.date)
      .limit(100);

    const team = await tx
      .select({
        userId: attendance.userId,
        fullName: users.fullName,
        email: users.email,
        checkIn: attendance.checkIn,
        checkOut: attendance.checkOut,
        status: attendance.status,
      })
      .from(attendance)
      .innerJoin(users, eq(users.id, attendance.userId))
      .where(and(eq(attendance.orgId, ctx.orgId), eq(attendance.date, today)))
      .orderBy(attendance.checkIn)
      .limit(500);

    return {
      timeZone,
      today,
      pending: pending.map((r) => ({
        id: r.id,
        personName: r.fullName || r.email || "Unnamed",
        date: r.date,
        checkIn: iso(r.checkIn),
        checkOut: iso(r.checkOut),
        requestedCheckIn: iso(r.requestedCheckIn),
        requestedCheckOut: iso(r.requestedCheckOut),
        reason: r.reason,
      })),
      teamToday: team.map((r) => ({
        userId: r.userId,
        name: r.fullName || r.email || "Unnamed",
        checkIn: iso(r.checkIn),
        checkOut: iso(r.checkOut),
        status: r.status ?? "present",
      })),
    };
  });
}
