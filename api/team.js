// GET /api/team — list members based on caller's role and optional scope
//
// Query params (optional):
//   org_id    — view members of a specific org (super_admin/owner only)
//   client_id — view members scoped to a specific client
//
// Visibility rules:
//   super_admin/owner → can view any org's members
//   agency_admin/admin → own org members + client_admin members only
//   client_admin → own client's members only

import { supabaseAdmin, SUPABASE_URL } from "../lib/supabaseServer.js";

async function getUserFromToken(token) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!resp.ok) return null;
  return resp.json();
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET" });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(token);
  if (!user?.id) return res.status(401).json({ error: "Invalid session" });

  const db = supabaseAdmin();

  const { data: membership } = await db
    .from("memberships")
    .select("organization_id, role, client_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) return res.status(403).json({ error: "No organization" });

  const isTopAdmin = ["super_admin", "owner"].includes(membership.role);
  const targetOrgId = req.query.org_id || membership.organization_id;
  const targetClientId = req.query.client_id || null;

  if (targetOrgId !== membership.organization_id && !isTopAdmin) {
    return res.status(403).json({ error: "Cannot view other organizations" });
  }

  let query = db
    .from("memberships")
    .select("user_id, role, client_id, email, full_name")
    .eq("organization_id", targetOrgId);

  if (["client_admin"].includes(membership.role)) {
    query = query.eq("client_id", membership.client_id);
  } else if (["agency_admin", "admin"].includes(membership.role) && targetClientId) {
    query = query.eq("client_id", targetClientId).in("role", ["client_admin", "admin"]);
  } else if (targetClientId) {
    query = query.eq("client_id", targetClientId);
  }

  const { data: members } = await query;
  if (!members?.length) return res.json({ members: [] });

  const enriched = [];
  for (const m of members) {
    let email = m.email;
    if (!email && m.user_id) {
      const { data } = await db.auth.admin.getUserById(m.user_id);
      email = data?.user?.email || m.user_id.slice(0, 8) + "...";
    }
    enriched.push({
      email,
      full_name: m.full_name || null,
      role: m.role,
      client_id: m.client_id,
    });
  }

  return res.json({ members: enriched });
}
