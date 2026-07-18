// POST /api/create-org — create an organization or onboard a client
//
// Body for creating an agency (super_admin only):
//   { type: "agency", name, admin_email }
//
// Body for onboarding a client under an agency (agency_admin only):
//   { type: "client", name, admin_email }
//
// Both create a user account for admin_email (if not exists) and assign the
// appropriate admin role.

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
    .in("role", ["super_admin", "agency_admin"])
    .single();

  if (!membership) return res.status(403).json({ error: "Insufficient permissions" });

  const { type, name, admin_email } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: "Organization name is required" });
  if (!admin_email?.trim()) return res.status(400).json({ error: "Admin email is required" });

  const email = admin_email.trim().toLowerCase();

  // --- Create agency (super_admin only) ---
  if (type === "agency") {
    if (membership.role !== "super_admin") {
      return res.status(403).json({ error: "Only super admins can create agencies" });
    }

    const { data: newOrg, error: orgErr } = await db
      .from("organizations")
      .insert({ name: name.trim(), org_type: "agency", plan_tier: "agency_partner" })
      .select()
      .single();

    if (orgErr) return res.status(500).json({ error: orgErr.message });

    const adminUser = await findOrCreateUser(db, email);
    if (adminUser.error) return res.status(500).json({ error: adminUser.error });

    await db.from("memberships").insert({
      user_id: adminUser.id,
      organization_id: newOrg.id,
      role: "agency_admin",
    });

    return res.json({
      created: true,
      org_id: newOrg.id,
      org_name: name.trim(),
      admin_email: email,
      new_account: adminUser.new_account,
      temp_password: adminUser.temp_password || null,
    });
  }

  // --- Onboard client (agency_admin only) ---
  if (type === "client") {
    if (membership.role !== "agency_admin") {
      return res.status(403).json({ error: "Only agency admins can onboard clients" });
    }

    const { data: org } = await db
      .from("organizations")
      .select("org_type")
      .eq("id", membership.organization_id)
      .single();

    if (org?.org_type !== "agency") {
      return res.status(403).json({ error: "Client onboarding is only for agency organizations" });
    }

    const { data: newClient, error: clientErr } = await db
      .from("clients")
      .insert({
        organization_id: membership.organization_id,
        name: name.trim(),
        is_self: false,
      })
      .select()
      .single();

    if (clientErr) return res.status(500).json({ error: clientErr.message });

    const adminUser = await findOrCreateUser(db, email);
    if (adminUser.error) return res.status(500).json({ error: adminUser.error });

    await db.from("memberships").insert({
      user_id: adminUser.id,
      organization_id: membership.organization_id,
      role: "client_admin",
      client_id: newClient.id,
    });

    return res.json({
      created: true,
      client_id: newClient.id,
      client_name: name.trim(),
      admin_email: email,
      new_account: adminUser.new_account,
      temp_password: adminUser.temp_password || null,
    });
  }

  return res.status(400).json({ error: "type must be 'agency' or 'client'" });
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
