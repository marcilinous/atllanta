// v1.13.0: the legacy service-role endpoints act for a signed-in user, so they
// apply the same block the database applies through auth_org_id(): a company
// whose trial has ended, or which Atllanta paused, is refused. The rule lives
// in the database (org_access_state_for, service role only); a failed check
// is never treated as allowed.

export const ACCESS_PAUSED = "Your company's access to Atllanta is paused. Please contact your admin.";

export async function checkOrgAccess(db, orgId, userId) {
  const { data, error } = await db.rpc("org_access_state_for", { p_org_id: orgId, p_user_id: userId });
  if (error) return { ok: false, status: 503, error: "Could not check your company's access — please try again" };
  if (data !== "ok") return { ok: false, status: 403, error: ACCESS_PAUSED };
  return { ok: true };
}
