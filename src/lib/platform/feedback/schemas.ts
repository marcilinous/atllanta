// Feedback input (v1.15.0). The sender, company and role never come from
// input — submit_feedback() stamps them. No `server-only`: tests import it.
import { z } from "zod";

export const FEEDBACK_KINDS = [
  { key: "idea", label: "Idea" },
  { key: "problem", label: "Problem" },
  { key: "praise", label: "Praise" },
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]["key"];

/** An on-site path to come back to, or null (blocks //host, schemes, junk). */
export function safeFrom(value: string | null | undefined): string | null {
  if (!value || value.length > 300 || value.includes("\\")) return null;
  return value.startsWith("/") && !value.startsWith("//") ? value : null;
}

export const submitFeedbackSchema = z.object({
  kind: z.enum(["idea", "problem", "praise"], { message: "Choose Idea, Problem or Praise." }),
  rating: z.number().int().min(1).max(5).nullable(),
  message: z
    .string()
    .trim()
    .min(1, "Write a message of up to 2,000 characters.")
    .max(2000, "Write a message of up to 2,000 characters."),
  page: z.string().max(300).nullable(),
});

export const markReadSchema = z.object({
  id: z.string().uuid("Choose an entry."),
  read: z.boolean(),
});

export interface FeedbackRow {
  id: string;
  createdAt: string;
  kind: FeedbackKind;
  rating: number | null;
  message: string;
  page: string | null;
  readAt: string | null;
  userName: string | null;
  userEmail: string | null;
  role: string | null;
  orgName: string | null;
}
