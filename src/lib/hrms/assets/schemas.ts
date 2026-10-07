// Zod input schemas for the assets Server Actions. The org, the creator, the
// assigner and the assignment times are never inputs: they come from the
// session and the database (assets_guard() / asset_assignments_guard(),
// v1.16.2). Assigning is its own action, so no edit can set a holder.
import { z } from "zod";

// The same lists as ASSET_TYPES / ASSET_STATUSES in src/db/schema/hrms.ts
// (the live CHECK constraints); kept here so this file has no database imports.
// tests/assets-new-stack.test.mjs holds the two equal.
export const ASSET_TYPES = ["Laptop", "Phone", "Access Card", "Monitor", "Keyboard", "Mouse", "Headset", "Other"] as const;
export const ASSET_STATUSES = ["available", "assigned", "maintenance", "retired"] as const;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((s) => (s.length === 0 ? null : s))
    .nullish();

/** "" → null, otherwise a real "YYYY-MM-DD" calendar date. */
const optionalDay = z
  .string()
  .trim()
  .refine((v) => {
    if (v === "") return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Enter a valid date.")
  .transform((v) => (v === "" ? null : v))
  .nullish();

export const ASSET_MAX_COST = 100_000_000;

const optionalCost = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d+(\.\d{1,2})?$/.test(v), "Enter a cost like 1200 or 1200.50.")
  .refine((v) => v === "" || Number(v) <= ASSET_MAX_COST, "That cost is too large.")
  .transform((v) => (v === "" ? null : v))
  .nullish();

const assetFields = {
  name: z.string().trim().min(1, "Give the asset a name.").max(200, "Name must be 200 characters or fewer."),
  type: z.enum(ASSET_TYPES, "Choose a type."),
  serialNumber: optionalText(100, "Serial number"),
  purchaseDate: optionalDay,
  purchaseCost: optionalCost,
  warrantyEnd: optionalDay,
  notes: optionalText(1000, "Notes"),
};

export const createAssetSchema = z.object(assetFields);
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

/** Statuses an edit may set; "assigned" only comes from assigning. */
export const EDITABLE_STATUSES = ["available", "maintenance", "retired"] as const;

export const updateAssetSchema = z.object({
  ...assetFields,
  assetId: z.uuid("Choose an asset."),
  status: z.enum(EDITABLE_STATUSES, "Choose available, maintenance or retired."),
});
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const assignAssetSchema = z.object({
  assetId: z.uuid("Choose an asset."),
  userId: z.uuid("Choose a person."),
  notes: optionalText(500, "Note"),
});
export type AssignAssetInput = z.infer<typeof assignAssetSchema>;

export const returnAssetSchema = z.object({
  assetId: z.uuid("Choose an asset."),
});

export const deleteAssetSchema = z.object({
  assetId: z.uuid("Choose an asset."),
});

/** The register's search and filters, read from the URL; unknown values mean "all". */
export const registerFilterSchema = z.object({
  q: z
    .string()
    .catch("")
    .default("")
    .transform((s) => s.trim().slice(0, 100)),
  type: z.enum(ASSET_TYPES).or(z.literal("")).catch("").default(""),
  status: z.enum(ASSET_STATUSES).or(z.literal("")).catch("").default(""),
});
export type RegisterFilter = z.infer<typeof registerFilterSchema>;
