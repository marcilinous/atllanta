// Who may use the Phase 3 admin screens (app/(platform)/settings/): an
// active owner or admin of an organisation.
//
// This is deliberately not requirePermission(): that check denies every
// action in a module the org has switched off, and every org starts with
// every module off (Phase 3 owner decision 1) — so the screen that switches
// modules on cannot itself sit behind a module. Organisation settings are a
// capability of the owner/admin system role, as they are in the legacy app
// and in the RLS helper is_org_admin(), which guards every table these
// screens write. This check is the friendly early "no"; RLS remains the
// boundary, because every write runs through withTransaction as the caller.
import "server-only";
import { eq } from "drizzle-orm";
import { withTransaction } from "../../db/transaction";
import { users } from "../../db/schema/platform";
import { getSessionUser } from "../supabase/server";
import { ActionError } from "../actions";

export interface OrgAdmin {
  userId: string;
  orgId: string;
  role: "owner" | "admin";
}

export type OrgAdminResult =
  | { status: "ok"; admin: OrgAdmin }
  | { status: "signed-out" }
  | { status: "forbidden" };

/** Resolves the caller for a page: never throws for a signed-out or non-admin caller. */
export async function getOrgAdmin(): Promise<OrgAdminResult> {
  const user = await getSessionUser();
  if (!user) return { status: "signed-out" };

  const row = await withTransaction(user, async (tx) => {
    const [r] = await tx
      .select({ orgId: users.orgId, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    return r;
  });

  if (!row || !row.orgId || row.status === "exited") return { status: "forbidden" };
  if (row.role !== "owner" && row.role !== "admin") return { status: "forbidden" };
  return { status: "ok", admin: { userId: user.id, orgId: row.orgId, role: row.role } };
}

/** The same check for a Server Action: throws ActionError unless the caller is an active owner/admin. */
export async function requireOrgAdmin(): Promise<OrgAdmin> {
  const result = await getOrgAdmin();
  if (result.status === "signed-out") throw new ActionError("You must be signed in to do that.");
  if (result.status === "forbidden") throw new ActionError("Only owners and admins can change these settings.");
  return result.admin;
}
