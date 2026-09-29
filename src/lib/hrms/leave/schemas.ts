// Zod input schemas for the leave Server Actions. The org, the person and the
// number of days are never inputs: they come from the session and the server.
import { z } from "zod";
import { parseDay } from "./days.ts";

const day = z
  .string()
  .refine((v) => parseDay(v) !== null, "Enter a valid date.");

export const applyLeaveSchema = z
  .object({
    leaveTypeId: z.uuid("Choose a leave type."),
    startDate: day,
    endDate: day,
    halfDay: z.boolean().default(false),
    reason: z
      .string()
      .trim()
      .max(500, "Reason must be 500 characters or fewer.")
      .transform((s) => (s.length === 0 ? null : s))
      .nullish(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "The end date must be on or after the start date.",
    path: ["endDate"],
  });
export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;

export const cancelLeaveSchema = z.object({
  requestId: z.uuid("Choose a leave request."),
});

export const decideLeaveSchema = z.object({
  requestId: z.uuid("Choose a leave request."),
  decision: z.enum(["approve", "reject"]),
  comment: z
    .string()
    .trim()
    .max(500, "Comment must be 500 characters or fewer.")
    .transform((s) => (s.length === 0 ? null : s))
    .nullish(),
});
export type DecideLeaveInput = z.infer<typeof decideLeaveSchema>;

// A supporting document (e.g. for Sick leave): up to 4 MB, a PDF or an image.
// Vercel caps a function request body at 4.5 MB, and the document travels in
// the Server Action's form body (next.config.mjs raises Next's own 1 MB
// default to match), so 4 MB leaves room for the other fields.
export const LEAVE_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;
export const LEAVE_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;
