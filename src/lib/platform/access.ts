// Is this person's company allowed in, and are they the platform owner?
// Both ask the database as the caller: my_org_access() works even while the
// company is blocked (it reads the caller's own row, not auth_org_id()), and
// is_platform_admin() is the only way the app reads platform_admins.
import "server-only";
import { sql } from "drizzle-orm";
import { withTransaction } from "../../db/transaction";

export type OrgAccessState = "ok" | "trial_ended" | "paused";

export interface OrgAccess {
  state: OrgAccessState;
  orgName: string;
  trialEndsAt: string | null;
  role: string;
}

export async function getOrgAccess(userId: string): Promise<OrgAccess | null> {
  const rows = (await withTransaction({ id: userId }, (tx) =>
    tx.execute(sql`select * from public.my_org_access()`)
  )) as unknown as { state: OrgAccessState; org_name: string; trial_ends_at: string | Date | null; role: string | null }[];
  const r = rows[0];
  if (!r) return null;
  return {
    state: r.state,
    orgName: r.org_name,
    trialEndsAt: r.trial_ends_at ? new Date(r.trial_ends_at).toISOString() : null,
    role: r.role ?? "member",
  };
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const rows = (await withTransaction({ id: userId }, (tx) =>
    tx.execute(sql`select public.is_platform_admin() as is_admin`)
  )) as unknown as { is_admin: boolean }[];
  return rows[0]?.is_admin === true;
}
