// Hand-written Zod schemas for the platform mutations (Phase 2 item 2), kept
// in sync with the real columns in src/db/schema/platform.ts by hand — that
// file is the source of truth (verified against the live database), this
// file just narrows what a form is allowed to submit. A column with no DB
// length limit still gets a sane cap here so a client can't push an
// unbounded string through to Postgres.
//
// Every free-text field is trimmed and rejected if empty after trimming —
// a name of all whitespace is not a name.
import { z } from "zod";

const orgId = z.uuid("Enter a valid organisation id.");

const name = z
  .string()
  .trim()
  .min(1, "A name is required.")
  .max(200, "Name must be 200 characters or fewer.");

export const renameOrganizationSchema = z.object({
  orgId,
  name,
});
export type RenameOrganizationInput = z.infer<typeof renameOrganizationSchema>;

export const createDepartmentSchema = z.object({
  orgId,
  name,
  // Not every department has a head yet.
  headId: z.uuid("Enter a valid head id.").nullish(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
