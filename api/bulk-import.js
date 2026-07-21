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
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: "Invalid token" });

  const { type, rows } = req.body || {};
  if (!type || !Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ error: "type and rows[] are required" });
  }

  const sb = supabaseAdmin();

  const { data: membership } = await sb
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership?.organization_id) {
    return res.status(403).json({ error: "No organization found" });
  }
  if (!["owner", "admin"].includes(membership.role)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const orgId = membership.organization_id;
  let imported = 0;
  let skipped = 0;
  const errors = [];

  if (type === "employees") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.full_name || !row.email) {
        errors.push({ row: i + 1, error: "full_name and email required" });
        continue;
      }
      const { error } = await sb.from("memberships").insert({
        organization_id: orgId,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone || null,
        role: ["owner", "admin", "manager", "member"].includes(row.role) ? row.role : "member",
        invited_at: new Date().toISOString(),
      });
      if (error) {
        if (error.code === "23505") skipped++;
        else errors.push({ row: i + 1, error: error.message });
      } else {
        imported++;
      }
    }
  } else if (type === "candidates") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.full_name) {
        errors.push({ row: i + 1, error: "full_name required" });
        continue;
      }
      const { error } = await sb.from("candidates").insert({
        org_id: orgId,
        full_name: row.full_name,
        email: row.email || null,
        phone: row.phone || null,
        source: "bulk_upload",
        resume_text: row.resume_text || null,
      });
      if (error) {
        errors.push({ row: i + 1, error: error.message });
      } else {
        imported++;
      }
    }
  } else {
    return res.status(400).json({ error: `Unknown import type: ${type}` });
  }

  return res.status(200).json({ imported, skipped, errors: errors.slice(0, 20), total: rows.length });
}
