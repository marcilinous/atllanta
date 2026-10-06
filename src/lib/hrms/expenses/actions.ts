"use server";

// Expenses Server Actions for the new stack (Phase 4 item 3, v1.16.0
// preview). Every action:
//   - passes both gates for Finance (CLAUDE.md §3): requireFeature("finance",
//     "finance", …) — the module is on for the org, the role grants the
//     permission, and feature_access lets this person see it;
//   - takes the org, the person and the currency from the session and the
//     organisation, never from input;
//   - writes inside withTransaction as the caller, so RLS and the v1.15.1
//     expenses_guard() decide what is allowed (a claim never changes after it
//     is submitted; nobody reviews their own; an owner's/admin's claim needs an
//     admin; only owners/admins reimburse; the reviewer is stamped by the
//     database);
//   - adds an audit row, and publishes after commit with the payload shapes
//     the legacy event processors already read (finance.expense.created /
//     finance.expense.approved — the legacy screen publishes nothing else).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { action, ActionError, type ActionResponse } from "../../actions";
import { withTransaction } from "../../../db/transaction";
import { expenseCategories, expenses } from "../../../db/schema/hrms";
import { getSupabaseServerClient } from "../../supabase/server";
import { publishEvent } from "../../events/publish";
import { requireFeature } from "../../auth/permissions";
import { orgCurrency } from "./queries";
import {
  decideExpenseSchema,
  receiptLinkSchema,
  RECEIPT_MAX_BYTES,
  RECEIPT_TYPES,
  reimburseExpenseSchema,
  submitExpenseSchema,
  withdrawExpenseSchema,
} from "./schemas";

const EXPENSE_PATHS = ["/hrms/expenses", "/hrms/expenses/approvals"];

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
  return (cleaned || "receipt").slice(-80);
}

// ---------------------------------------------------------------------------
// Submit a claim
// ---------------------------------------------------------------------------

const submitWithReceiptSchema = submitExpenseSchema.and(z.object({ receipt: z.instanceof(File).nullable() }));

const submitAction = action(submitWithReceiptSchema, async (input) => {
  const ctx = await requireFeature("finance", "finance", "create");
  const org = { currency: await orgCurrency(ctx) };

  // 1. Check the category before anything is uploaded or written.
  if (input.categoryId) {
    const categoryId = input.categoryId;
    const [category] = await withTransaction({ id: ctx.userId }, (tx) =>
      tx
        .select({ id: expenseCategories.id })
        .from(expenseCategories)
        .where(
          and(
            eq(expenseCategories.id, categoryId),
            eq(expenseCategories.orgId, ctx.orgId),
            eq(expenseCategories.isActive, true)
          )
        )
        .limit(1)
    );
    if (!category) throw fieldError("categoryId", "Choose one of your company's categories.");
  }

  // 2. The receipt, uploaded as the caller (storage policies scope it to
  //    expenses/{org}/).
  let receiptPath: string | null = null;
  const supabase = await getSupabaseServerClient();
  if (input.receipt) {
    const file = input.receipt;
    if (file.size > RECEIPT_MAX_BYTES) throw fieldError("receipt", "The receipt must be 4 MB or smaller.");
    if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) {
      throw fieldError("receipt", "Attach a PDF or a photo (JPG, PNG, WEBP or HEIC).");
    }
    const path = `expenses/${ctx.orgId}/${ctx.userId}/${Date.now()}_${safeFileName(file.name)}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      console.error("[expenses] receipt upload failed", error.message);
      throw fieldError("receipt", "The receipt could not be uploaded. Please try again.");
    }
    receiptPath = path;
  }

  // 3. The claim and its audit row.
  let created: { id: string };
  try {
    created = await withTransaction({ id: ctx.userId }, async (tx, audit) => {
      const [row] = await tx
        .insert(expenses)
        .values({
          orgId: ctx.orgId,
          userId: ctx.userId,
          categoryId: input.categoryId ?? null,
          title: input.title,
          amount: input.amount,
          currency: org.currency,
          expenseDate: input.expenseDate,
          receiptUrl: receiptPath,
          description: input.description ?? null,
        })
        .returning({ id: expenses.id });
      await audit({
        orgId: ctx.orgId,
        module: "finance",
        entityType: "expense",
        entityId: row.id,
        action: "created",
        newValues: { title: input.title, amount: input.amount, currency: org.currency, expense_date: input.expenseDate },
      });
      return row;
    });
  } catch (err) {
    // Don't leave an orphaned receipt behind.
    if (receiptPath) await supabase.storage.from("documents").remove([receiptPath]);
    throw err;
  }

  await publish(ctx.orgId, "finance.expense.created", {
    expense_id: created.id,
    org_id: ctx.orgId,
    amount: Number(input.amount),
    title: input.title,
  });
  for (const p of EXPENSE_PATHS) revalidatePath(p);
  return { id: created.id };
});

/** Submit a claim. Takes FormData so a receipt can come with it. */
export async function submitExpense(formData: FormData): Promise<ActionResponse<{ id: string }>> {
  const receipt = formData.get("receipt");
  return submitAction({
    title: formData.get("title") ?? "",
    amount: formData.get("amount") ?? "",
    expenseDate: formData.get("expenseDate") ?? "",
    categoryId: formData.get("categoryId") ?? "",
    description: formData.get("description") ?? null,
    receipt: receipt instanceof File && receipt.size > 0 ? receipt : null,
  });
}

// ---------------------------------------------------------------------------
// Withdraw your own pending claim
// ---------------------------------------------------------------------------

export const withdrawExpense = action(withdrawExpenseSchema, async (input) => {
  const ctx = await requireFeature("finance", "finance", "edit");

  const removed = await withTransaction({ id: ctx.userId }, async (tx, audit) => {
    const rows = await tx
      .delete(expenses)
      .where(
        and(
          eq(expenses.id, input.expenseId),
          eq(expenses.orgId, ctx.orgId),
          eq(expenses.userId, ctx.userId),
          eq(expenses.status, "pending")
        )
      )
      .returning({ id: expenses.id, title: expenses.title, amount: expenses.amount, receiptUrl: expenses.receiptUrl });
    if (rows.length === 0) throw new ActionError("That claim can no longer be withdrawn.");

    await audit({
      orgId: ctx.orgId,
      module: "finance",
      entityType: "expense",
      entityId: input.expenseId,
      action: "withdrawn",
      oldValues: { status: "pending", title: rows[0].title, amount: rows[0].amount },
    });
    return rows[0];
  });

  // The receipt has no claim any more; the uploader may remove it (best effort).
  if (removed.receiptUrl) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.storage.from("documents").remove([removed.receiptUrl]);
    if (error) console.error("[expenses] receipt removal failed", error.message);
  }

  for (const p of EXPENSE_PATHS) revalidatePath(p);
  return { id: input.expenseId };
});

// ---------------------------------------------------------------------------
// Approve or reject someone else's pending claim
// ---------------------------------------------------------------------------

export const decideExpense = action(decideExpenseSchema, async (input) => {
  const ctx = await requireFeature("finance", "finance", "approve");
  const status = input.decision === "approve" ? "approved" : "rejected";

  const claim = await withTransaction({ id: ctx.userId }, async (tx, audit) => {
    const [found] = await tx
      .select({ id: expenses.id, userId: expenses.userId, amount: expenses.amount })
      .from(expenses)
      .where(and(eq(expenses.id, input.expenseId), eq(expenses.orgId, ctx.orgId)))
      .limit(1);
    if (!found) throw new ActionError("That claim was not found.");
    const claim = found;
    if (claim.userId === ctx.userId) throw new ActionError("You can't approve or reject your own claim.");

    let rows: { id: string }[];
    try {
      rows = await tx
        .update(expenses)
        // reviewed_by / reviewed_at are stamped by expenses_guard().
        .set({ status, reviewComment: input.comment ?? null })
        .where(and(eq(expenses.id, claim.id), eq(expenses.orgId, ctx.orgId), eq(expenses.status, "pending")))
        .returning({ id: expenses.id });
    } catch (err) {
      // The guard refuses with 42501 (not this person's approver, or an
      // owner's/admin's claim for a non-admin). Say so plainly.
      if (hasPgCode(err, "42501")) throw new ActionError("You can't approve or reject this claim.");
      throw err;
    }
    if (rows.length === 0) throw new ActionError("That claim has already been decided or withdrawn.");

    await audit({
      orgId: ctx.orgId,
      module: "finance",
      entityType: "expense",
      entityId: claim.id,
      action: status,
      oldValues: { status: "pending" },
      newValues: { status, review_comment: input.comment ?? null },
    });
    return claim;
  });

  if (status === "approved") {
    await publish(ctx.orgId, "finance.expense.approved", {
      expense_id: claim.id,
      org_id: ctx.orgId,
      user_id: claim.userId,
      amount: Number(claim.amount),
    });
  }
  for (const p of EXPENSE_PATHS) revalidatePath(p);
  return { id: claim.id, status };
});

// ---------------------------------------------------------------------------
// Mark an approved claim reimbursed (owners and admins)
// ---------------------------------------------------------------------------

export const reimburseExpense = action(reimburseExpenseSchema, async (input) => {
  const ctx = await requireFeature("finance", "finance", "approve");
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    throw new ActionError("Only an owner or admin can mark a claim reimbursed.");
  }

  await withTransaction({ id: ctx.userId }, async (tx, audit) => {
    let rows: { id: string }[];
    try {
      rows = await tx
        .update(expenses)
        // reimbursed_at is stamped by expenses_guard().
        .set({ status: "reimbursed" })
        .where(and(eq(expenses.id, input.expenseId), eq(expenses.orgId, ctx.orgId), eq(expenses.status, "approved")))
        .returning({ id: expenses.id });
    } catch (err) {
      if (hasPgCode(err, "42501")) throw new ActionError("You can't mark this claim reimbursed.");
      throw err;
    }
    if (rows.length === 0) throw new ActionError("That claim isn't waiting to be reimbursed.");

    await audit({
      orgId: ctx.orgId,
      module: "finance",
      entityType: "expense",
      entityId: input.expenseId,
      action: "reimbursed",
      oldValues: { status: "approved" },
      newValues: { status: "reimbursed" },
    });
  });

  for (const p of EXPENSE_PATHS) revalidatePath(p);
  return { id: input.expenseId };
});

// ---------------------------------------------------------------------------
// A short-lived link to a claim's receipt
// ---------------------------------------------------------------------------

export const getReceiptLink = action(receiptLinkSchema, async (input) => {
  const ctx = await requireFeature("finance", "finance", "view");

  // Read under RLS as the caller: only a claim they may see has a path here.
  const [row] = await withTransaction({ id: ctx.userId }, (tx) =>
    tx
      .select({ receiptUrl: expenses.receiptUrl })
      .from(expenses)
      .where(and(eq(expenses.id, input.expenseId), eq(expenses.orgId, ctx.orgId)))
      .limit(1)
  );
  const path = row?.receiptUrl;
  if (!path) throw new ActionError("That claim has no receipt.");

  // Signed as the caller, so the storage read policy applies too.
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    console.error("[expenses] receipt link failed", error?.message);
    throw new ActionError("The receipt could not be opened. Please try again.");
  }
  return { url: data.signedUrl };
});
