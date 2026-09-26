// Zod input schemas for the Phase 3 admin screens' Server Actions
// (src/lib/settings/actions.ts). None of them carries an org id: every
// action takes the org from the caller's own users row, never from the
// browser.
import { z } from "zod";
import {
  MODULE_KEYS,
  PERMISSIONS,
  ACCESS_FEATURE_KEYS,
  ACCESS_ROLES,
} from "./catalogue.ts";

const moduleKey = z.enum(MODULE_KEYS, "Choose a valid module.");

export const setModuleEnabledSchema = z.object({
  moduleKey,
  enabled: z.boolean(),
});
export type SetModuleEnabledInput = z.infer<typeof setModuleEnabledSchema>;

const grant = z
  .object({
    moduleKey,
    permissions: z
      .array(z.enum(PERMISSIONS, "Choose a valid permission."))
      .min(1, "Pick at least one permission, or leave the module on the base role's default.")
      .max(PERMISSIONS.length),
  })
  // Create/edit/delete/approve on something you cannot see is not a
  // permission anyone can use; the screen ticks View for you.
  .refine((g) => g.permissions.includes("view"), {
    message: "A module needs View before any other permission.",
    path: ["permissions"],
  });

const grants = z
  .array(grant)
  .max(MODULE_KEYS.length)
  .refine((list) => new Set(list.map((g) => g.moduleKey)).size === list.length, {
    message: "Each module can appear only once.",
  });

const roleName = z
  .string()
  .trim()
  .min(1, "A name is required.")
  .max(60, "Name must be 60 characters or fewer.");

const description = z
  .string()
  .trim()
  .max(200, "Description must be 200 characters or fewer.")
  .transform((s) => (s.length === 0 ? null : s))
  .nullish();

export const createCustomRoleSchema = z.object({
  name: roleName,
  description,
  grants,
});
export type CreateCustomRoleInput = z.infer<typeof createCustomRoleSchema>;

export const updateCustomRoleSchema = z.object({
  roleId: z.uuid("Choose a valid role."),
  name: roleName,
  description,
  grants,
});
export type UpdateCustomRoleInput = z.infer<typeof updateCustomRoleSchema>;

export const deleteCustomRoleSchema = z.object({
  roleId: z.uuid("Choose a valid role."),
});
export type DeleteCustomRoleInput = z.infer<typeof deleteCustomRoleSchema>;

const featureKey = z.enum(ACCESS_FEATURE_KEYS, "Choose a valid feature.");

// A role rule is a tick box (visible, or hidden); a person's rule can also
// go back to "default", i.e. follow their role.
export const setFeatureRuleSchema = z.discriminatedUnion("subjectType", [
  z.object({
    subjectType: z.literal("role"),
    subjectKey: z.enum(
      ACCESS_ROLES.map((r) => r.key) as unknown as ["manager", "developer", "member"],
      "Choose a valid role."
    ),
    featureKey,
    value: z.enum(["visible", "hidden"]),
  }),
  z.object({
    subjectType: z.literal("user"),
    subjectKey: z.uuid("Choose a valid person."),
    featureKey,
    value: z.enum(["default", "visible", "hidden"]),
  }),
]);
export type SetFeatureRuleInput = z.infer<typeof setFeatureRuleSchema>;
