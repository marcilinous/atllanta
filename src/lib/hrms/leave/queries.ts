// Read side of the new-stack leave screens. Every loader takes the caller's
// PermissionContext (from featureContext, so both gates already passed) and
// reads inside withTransaction — under RLS as the caller.
import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { withTransaction } from "../../../db/transaction";
import { users } from "../../../db/schema/platform";
import { leaveBalances, leaveRequests, leaveTypes } from "../../../db/schema/hrms";
import type { PermissionContext } from "../../auth/permissions-core";

export interface LeaveTypeOption {
  id: string;
  name: string;
  code: string;
  requiresDocument: boolean;
  maxConsecutiveDays: number | null;
}

export interface BalanceRow {
  leaveTypeId: string;
  name: string;
  balance: number;
  used: number;
  pending: number;
}

export interface MyRequestRow {
  id: string;
  typeName: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  reason: string | null;
  reviewComment: string | null;
  createdAt: string | null;
}

export interface MyLeaveData {
  year: number;
  types: LeaveTypeOption[];
  balances: BalanceRow[];
  requests: MyRequestRow[];
}

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));

export async function loadMyLeave(ctx: PermissionContext): Promise<MyLeaveData> {
  const year = new Date().getUTCFullYear();
  return withTransaction({ id: ctx.userId }, async (tx) => {
    const types = await tx
      .select({
        id: leaveTypes.id,
        name: leaveTypes.name,
        code: leaveTypes.code,
        requiresDocument: leaveTypes.requiresDocument,
        maxConsecutiveDays: leaveTypes.maxConsecutiveDays,
      })
      .from(leaveTypes)
      .where(and(eq(leaveTypes.orgId, ctx.orgId), eq(leaveTypes.isActive, true)))
      .orderBy(leaveTypes.name);

    const balances = await tx
      .select({ leaveTypeId: leaveBalances.leaveTypeId, balance: leaveBalances.balance, used: leaveBalances.used })
      .from(leaveBalances)
      .where(and(eq(leaveBalances.userId, ctx.userId), eq(leaveBalances.year, year)));

    const requests = await tx
      .select({
        id: leaveRequests.id,
        typeName: leaveTypes.name,
        leaveTypeId: leaveRequests.leaveTypeId,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        days: leaveRequests.days,
        status: leaveRequests.status,
        reason: leaveRequests.reason,
        reviewComment: leaveRequests.reviewComment,
        createdAt: leaveRequests.createdAt,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(eq(leaveRequests.userId, ctx.userId), eq(leaveRequests.orgId, ctx.orgId)))
      .orderBy(desc(leaveRequests.createdAt))
      .limit(30);

    const pendingByType = new Map<string, number>();
    for (const r of requests) {
      if (r.status === "pending" && r.startDate.startsWith(String(year))) {
        pendingByType.set(r.leaveTypeId, (pendingByType.get(r.leaveTypeId) ?? 0) + num(r.days));
      }
    }

    return {
      year,
      types: types.map((t) => ({
        id: t.id,
        name: t.name,
        code: t.code,
        requiresDocument: t.requiresDocument === true,
        maxConsecutiveDays: t.maxConsecutiveDays ?? null,
      })),
      balances: types
        .map((t) => {
          const b = balances.find((x) => x.leaveTypeId === t.id);
          if (!b) return null;
          return { leaveTypeId: t.id, name: t.name, balance: num(b.balance), used: num(b.used), pending: pendingByType.get(t.id) ?? 0 };
        })
        .filter((b): b is BalanceRow => b !== null),
      requests: requests.map((r) => ({
        id: r.id,
        typeName: r.typeName,
        startDate: r.startDate,
        endDate: r.endDate,
        days: num(r.days),
        status: r.status ?? "pending",
        reason: r.reason,
        reviewComment: r.reviewComment,
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      })),
    };
  });
}

export interface ApprovalRow {
  id: string;
  personName: string;
  typeName: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  hasDocument: boolean;
  createdAt: string | null;
}

/**
 * Pending requests the caller may decide: RLS limits them to people the
 * caller can see (admins: everyone; managers: their department and
 * reporting line). Never the caller's own, and an owner's or admin's leave
 * only for an owner/admin (owner decision 2026-09-29, option a) — the same
 * rules leave_requests_guard() enforces, so no one is offered a button that
 * the database will refuse.
 */
export async function loadLeaveApprovals(ctx: PermissionContext): Promise<ApprovalRow[]> {
  const callerIsAdmin = ctx.role === "owner" || ctx.role === "admin";
  return withTransaction({ id: ctx.userId }, async (tx) => {
    const rows = await tx
      .select({
        id: leaveRequests.id,
        fullName: users.fullName,
        email: users.email,
        requesterRole: users.role,
        typeName: leaveTypes.name,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        days: leaveRequests.days,
        reason: leaveRequests.reason,
        documentUrl: leaveRequests.documentUrl,
        createdAt: leaveRequests.createdAt,
      })
      .from(leaveRequests)
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          eq(leaveRequests.orgId, ctx.orgId),
          eq(leaveRequests.status, "pending"),
          ne(leaveRequests.userId, ctx.userId),
          callerIsAdmin ? undefined : inArray(users.role, ["manager", "member", "developer"])
        )
      )
      .orderBy(leaveRequests.startDate)
      .limit(100);

    return rows.map((r) => ({
      id: r.id,
      personName: r.fullName || r.email || "Unnamed",
      typeName: r.typeName,
      startDate: r.startDate,
      endDate: r.endDate,
      days: num(r.days),
      reason: r.reason,
      hasDocument: Boolean(r.documentUrl),
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    }));
  });
}
