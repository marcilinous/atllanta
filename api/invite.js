// POST /api/invite — invite a user to the organization
//
// Body: { email, role, full_name?, client_id? }
//
// Creates a Supabase auth account (if not exists) and a membership row.
// Only owner/admin (or super_admin/agency_admin) can invite.

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
    .in("role", ["owner", "admin", "super_admin", "agency_admin"])
    .single();

  if (!membership) return res.status(403).json({ error: "Insufficient permissions" });

  const { email: rawEmail, role, full_name, client_id } = req.body || {};
  if (!rawEmail?.trim()) return res.status(400).json({ error: "Email is required" });

  const allowedRoles = ["owner", "admin", "manager", "member"];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  const email = rawEmail.trim().toLowerCase();

  const { data: existing } = await db
    .from("memberships")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: "This email is already a member" });
  }

  const authUser = await findOrCreateUser(db, email);
  if (authUser.error) return res.status(500).json({ error: authUser.error });

  const { error: insertErr } = await db.from("memberships").insert({
    user_id: authUser.id,
    organization_id: membership.organization_id,
    role,
    email,
    full_name: (full_name || "").trim() || null,
    client_id: client_id || null,
    invited_at: new Date().toISOString(),
  });

  if (insertErr) return res.status(500).json({ error: insertErr.message });

  return res.json({
    invited: true,
    email,
    role,
    new_account: authUser.new_account,
    temp_password: authUser.temp_password || null,
  });
}

async function findOrCreateUser(db, email) {
  const { data: existingUsers } = await db.auth.admin.listUsers();
  const existing = existingUsers?.users?.find((u) => u.email === email);

  if (existing) {
    return { id: existing.id, new_account: false };
  }

  const tempPassword = crypto.randomUUID().slice(0, 16) + "Ax1!";
  const { data: newUser, error } = await db.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (error) return { error: "Failed to create user: " + error.message };

  return { id: newUser.user.id, new_account: true, temp_password: tempPassword };
}
