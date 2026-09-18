// Team administration endpoint (single-org model).
// POST { action: "invite", email, role, full_name? } — owner/admin invites a member.

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

export default async function handler(req, res) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(token);
  if (!user?.id) return res.status(401).json({ error: "Invalid session" });

  const db = supabaseAdmin();
  const action = req.query?.action || req.body?.action;

  if (req.method === "POST" && action === "invite") return handleInvite(req, res, db, user);

  return res.status(400).json({ error: "Invalid action" });
}

// --- Invite a member into the caller's org ---

async function handleInvite(req, res, db, user) {
  const { data: me } = await db
    .from("users")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (!me?.org_id || !["owner", "admin"].includes(me.role)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  const { email: rawEmail, role, full_name } = req.body || {};
  if (!rawEmail?.trim()) return res.status(400).json({ error: "Email is required" });

  const allowedRoles = ["owner", "admin", "manager", "member"];
  if (!allowedRoles.includes(role)) return res.status(400).json({ error: "Invalid role" });

  const email = rawEmail.trim().toLowerCase();

  const { data: existing } = await db
    .from("users")
    .select("id")
    .eq("org_id", me.org_id)
    .eq("email", email)
    .maybeSingle();

  if (existing) return res.status(409).json({ error: "This email is already a member" });

  const authUser = await findOrCreateUser(db, email);
  if (authUser.error) return res.status(500).json({ error: authUser.error });

  const { error: insertErr } = await db.from("users").upsert(
    {
      id: authUser.id,
      org_id: me.org_id,
      email,
      full_name: (full_name || "").trim() || null,
      role,
      status: "active",
      date_of_joining: new Date().toISOString().split("T")[0],
    },
    { onConflict: "id" }
  );

  if (insertErr) return res.status(500).json({ error: insertErr.message });

  return res.json({
    invited: true,
    email,
    role,
    new_account: authUser.new_account,
    temp_password: authUser.temp_password || null,
  });
}
