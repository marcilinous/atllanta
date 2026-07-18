// GET /api/team — list members of the caller's organization
// Returns user emails + roles. Only admins get the full list.

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
    .select("organization_id, role")
    .eq("user_id", user.id)
    .single();

  if (!membership) return res.status(403).json({ error: "No organization" });

  const { data: members } = await db
    .from("memberships")
    .select("user_id, role, client_id")
    .eq("organization_id", membership.organization_id);

  if (!members?.length) return res.json({ members: [] });

  const userIds = [...new Set(members.map((m) => m.user_id))];
  const emailMap = {};

  for (const uid of userIds) {
    const { data } = await db.auth.admin.getUserById(uid);
    if (data?.user?.email) emailMap[uid] = data.user.email;
  }

  const result = members.map((m) => ({
    email: emailMap[m.user_id] || m.user_id.slice(0, 8) + "…",
    role: m.role,
    client_id: m.client_id,
  }));

  return res.json({ members: result });
}
