// GET /api/orgs — list organizations and clients based on caller's role
//
// Visibility rules:
//   super_admin  → all agencies + their clients
//   agency_admin → own org + own clients
//   client_admin → nothing (they don't browse orgs)

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

  // super_admin: list all agency orgs + their clients
  if (membership.role === "super_admin") {
    const { data: agencies } = await db
      .from("organizations")
      .select("id, name, org_type, plan_tier")
      .eq("org_type", "agency")
      .order("name");

    const agencyIds = (agencies || []).map((a) => a.id);
    let clients = [];
    if (agencyIds.length) {
      const { data: cl } = await db
        .from("clients")
        .select("id, name, organization_id")
        .in("organization_id", agencyIds)
        .order("name");
      clients = cl || [];
    }

    const result = (agencies || []).map((a) => ({
      ...a,
      clients: clients.filter((c) => c.organization_id === a.id),
    }));

    return res.json({ agencies: result });
  }

  // agency_admin: list own org's clients
  if (membership.role === "agency_admin") {
    const { data: org } = await db
      .from("organizations")
      .select("id, name, org_type, plan_tier")
      .eq("id", membership.organization_id)
      .single();

    const { data: clients } = await db
      .from("clients")
      .select("id, name, organization_id")
      .eq("organization_id", membership.organization_id)
      .eq("is_self", false)
      .order("name");

    return res.json({
      agencies: [{ ...org, clients: clients || [] }],
    });
  }

  // client_admin / client_member: no org browsing
  return res.json({ agencies: [] });
}
