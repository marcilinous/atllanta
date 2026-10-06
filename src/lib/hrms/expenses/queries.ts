// Read side of the new-stack expenses screens. Every loader takes the
// caller's PermissionContext (from featureContext, so both gates already
// passed) and reads inside withTransaction — under RLS as the caller, so the
// v1.15.1 rules decide whose claims are visible (the claimant, admins, the
// reporting line and a manager over the department).
import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { withTransaction } from "../../../db/transaction";
import { organizations, users } from "../../../db/schema/platform";
import { expenseCategories, expenses } from "../../../db/schema/hrms";
import type { PermissionContext } from "../../auth/permissions-core";

export interface CategoryOption {
  id: string;
  name: string;
  code: string;
}

export interface MyClaimRow {
  id: string;
  title: string;
  amount: number;
  currency: string;
  expenseDate: string;
  categoryName: string | null;
  description: string | null;
  status: string;
  reviewComment: string | null;
  hasReceipt: boolean;
  createdAt: string | null;
}

export interface StatusTotal {
  count: number;
  amount: number;
}

export interface MyExpensesData {
  currency: string;
  categories: CategoryOption[];
  totals: { pending: StatusTotal; approved: StatusTotal; reimbursed: StatusTotal };
  claims: MyClaimRow[];
}

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));

/** The organisation's currency (the legacy default is INR). */
export async function orgCurrency(ctx: PermissionContext): Promise<string> {
  const [org] = await withTransaction({ id: ctx.userId }, (tx) =>
    tx.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1)
  );
  return org?.currency || "INR";
}

export async function loadMyExpenses(ctx: PermissionContext): Promise<MyExpensesData> {
  const currency = await orgCurrency(ctx);
  return withTransaction({ id: ctx.userId }, async (tx) => {
    const categories = await tx
      .select({ id: expenseCategories.id, name: expenseCategories.name, code: expenseCategories.code })
      .from(expenseCategories)
      .where(and(eq(expenseCategories.orgId, ctx.orgId), eq(expenseCategories.isActive, true)))
      .orderBy(expenseCategories.name);

    // All of the caller's own claims feed the totals; the list shows the latest 50.
    const rows = await tx
      .select({
        id: expenses.id,
        title: expenses.title,
        amount: expenses.amount,
        currency: expenses.currency,
        expenseDate: expenses.expenseDate,
        categoryName: expenseCategories.name,
        description: expenses.description,
        status: expenses.status,
        reviewComment: expenses.reviewComment,
        receiptUrl: expenses.receiptUrl,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(and(eq(expenses.userId, ctx.userId), eq(expenses.orgId, ctx.orgId)))
      .orderBy(desc(expenses.createdAt));

    const totals = {
      pending: { count: 0, amount: 0 },
      approved: { count: 0, amount: 0 },
      reimbursed: { count: 0, amount: 0 },
    };
    for (const r of rows) {
      const bucket = totals[(r.status ?? "pending") as keyof typeof totals];
      if (bucket) {
        bucket.count += 1;
        bucket.amount += num(r.amount);
      }
    }

    return {
      currency,
      categories,
      totals,
      claims: rows.slice(0, 50).map((r) => ({
        id: r.id,
        title: r.title,
        amount: num(r.amount),
        currency: r.currency || currency,
        expenseDate: r.expenseDate,
        categoryName: r.categoryName ?? null,
        description: r.description,
        status: r.status ?? "pending",
        reviewComment: r.reviewComment,
        hasReceipt: Boolean(r.receiptUrl),
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      })),
    };
  });
}

export interface ReviewRow {
  id: string;
  personName: string;
  title: string;
  amount: number;
  currency: string;
  expenseDate: string;
  categoryName: string | null;
  description: string | null;
  hasReceipt: boolean;
  createdAt: string | null;
}

export interface ExpenseApprovalsData {
  canReimburse: boolean;
  pending: ReviewRow[];
  toReimburse: ReviewRow[];
}

/**
 * Claims the caller may act on. Pending: RLS limits them to people the caller
 * can see; never the caller's own, and an owner's or admin's claim only for an
 * owner/admin (owner decision 2026-10-07, option a) — the same rules
 * expenses_guard() enforces, so no one is offered a button the database will
 * refuse. To reimburse: owners and admins only, approved claims, not their own.
 */
export async function loadExpenseApprovals(ctx: PermissionContext): Promise<ExpenseApprovalsData> {
  const callerIsAdmin = ctx.role === "owner" || ctx.role === "admin";
  const currency = await orgCurrency(ctx);

  return withTransaction({ id: ctx.userId }, async (tx) => {
    const select = {
      id: expenses.id,
      fullName: users.fullName,
      email: users.email,
      title: expenses.title,
      amount: expenses.amount,
      currency: expenses.currency,
      expenseDate: expenses.expenseDate,
      categoryName: expenseCategories.name,
      description: expenses.description,
      receiptUrl: expenses.receiptUrl,
      createdAt: expenses.createdAt,
    };

    const pending = await tx
      .select(select)
      .from(expenses)
      .innerJoin(users, eq(users.id, expenses.userId))
      .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(
        and(
          eq(expenses.orgId, ctx.orgId),
          eq(expenses.status, "pending"),
          ne(expenses.userId, ctx.userId),
          callerIsAdmin ? undefined : inArray(users.role, ["manager", "member", "developer"])
        )
      )
      .orderBy(expenses.createdAt)
      .limit(100);

    const toReimburse = callerIsAdmin
      ? await tx
          .select(select)
          .from(expenses)
          .innerJoin(users, eq(users.id, expenses.userId))
          .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
          .where(and(eq(expenses.orgId, ctx.orgId), eq(expenses.status, "approved"), ne(expenses.userId, ctx.userId)))
          .orderBy(expenses.reviewedAt)
          .limit(100)
      : [];

    const toRow = (r: (typeof pending)[number]): ReviewRow => ({
      id: r.id,
      personName: r.fullName || r.email || "Unnamed",
      title: r.title,
      amount: num(r.amount),
      currency: r.currency || currency,
      expenseDate: r.expenseDate,
      categoryName: r.categoryName ?? null,
      description: r.description,
      hasReceipt: Boolean(r.receiptUrl),
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    });

    return { canReimburse: callerIsAdmin, pending: pending.map(toRow), toReimburse: toReimburse.map(toRow) };
  });
}
