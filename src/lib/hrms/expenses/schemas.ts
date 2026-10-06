// Zod input schemas for the expenses Server Actions. The org, the person, the
// currency and the reviewer are never inputs: they come from the session, the
// organisation and the database (expenses_guard(), v1.15.1).
import { z } from "zod";

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((s) => (s.length === 0 ? null : s))
    .nullish();

/** "YYYY-MM-DD" that is a real calendar date. */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Enter a valid date.");

export const EXPENSE_MAX_AMOUNT = 10_000_000;

export const submitExpenseSchema = z.object({
  title: z.string().trim().min(1, "Give the claim a title.").max(200, "Title must be 200 characters or fewer."),
  // Typed as text in the form; at most two decimals, more than 0.
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 450 or 450.50.")
    .refine((v) => Number(v) > 0, "The amount must be more than 0.")
    .refine((v) => Number(v) <= EXPENSE_MAX_AMOUNT, "That amount is too large for one claim."),
  expenseDate: day,
  categoryId: z
    .union([z.uuid("Choose a category."), z.literal("")])
    .transform((v) => (v === "" ? null : v))
    .nullish(),
  description: optionalText(1000, "Note"),
});
export type SubmitExpenseInput = z.infer<typeof submitExpenseSchema>;

export const withdrawExpenseSchema = z.object({
  expenseId: z.uuid("Choose a claim."),
});

export const decideExpenseSchema = z.object({
  expenseId: z.uuid("Choose a claim."),
  decision: z.enum(["approve", "reject"]),
  comment: optionalText(500, "Comment"),
});
export type DecideExpenseInput = z.infer<typeof decideExpenseSchema>;

export const reimburseExpenseSchema = z.object({
  expenseId: z.uuid("Choose a claim."),
});

export const receiptLinkSchema = z.object({
  expenseId: z.uuid("Choose a claim."),
});

// A receipt: up to 4 MB, a PDF or an image — the same limits as a leave
// document (Vercel caps a request at 4.5 MB; next.config.mjs raises the Server
// Action body limit to match).
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
export const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;
