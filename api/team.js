// GET /api/team — list members based on caller's role and optional scope
//
// Query params (optional):
//   org_id    — view members of a specific org (super_admin only)
//   client_id — view members scoped to a specific client
//
// Visibility rules:
//   super_admin  → can view any org's members
//   agency_admin → own org members + client_admin members only
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

async function resolveEmails(db, members) {
  const userIds = [...new Set(members.map((m) => m.user_id))];
  const emailMap = {};
  for (const uid of userIds) {
    const { data } = await db.auth.admin.getUserById(uid);
    if (data?.user?.email) emailMap[uid] = data.user.email;
  }
  return members.map((m) => ({
    email: emailMap[m.user_id] || m.user_id.slice(0, 8) + "…",
    role: m.role,
    client_id: m.client_id,
  }));
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

  const targetOrgId = req.query.org_id || membership.organization_id;
  const targetClientId = req.query.client_id || null;

  // super_admin can view any org
  if (targetOrgId !== membership.organization_id && membership.role !== "super_admin") {
    return res.status(403).json({ error: "Cannot view other organizations" });
  }

  let query = db.from("memberships").select("user_id, role, client_id").eq("organization_id", targetOrgId);

  if (membership.role === "client_admin") {
    // client_admin sees only their own client's members
    query = query.eq("client_id", membership.client_id);
  } else if (membership.role === "agency_admin" && targetClientId) {
    // agency_admin drilling into a client sees only that client's admins
    query = query.eq("client_id", targetClientId).in("role", ["client_admin"]);
  } else if (targetClientId) {
    // super_admin drilling into a client
    query = query.eq("client_id", targetClientId);
  }

  const { data: members } = await query;
  if (!members?.length) return res.json({ members: [] });

  return res.json({ members: await resolveEmails(db, members) });
}
