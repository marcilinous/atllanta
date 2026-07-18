// POST /api/invite — send an invitation to join an organization
// Body: { email, role, client_id? }
// Only admins (super_admin, agency_admin, client_admin) can invite.

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

  // Check user is admin
  const { data: membership } = await db
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .in("role", ["super_admin", "agency_admin", "client_admin"])
    .single();

  if (!membership) return res.status(403).json({ error: "Only admins can invite users" });

  const { email, role, client_id } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required" });

  const validRoles = ["client_admin", "client_member", "agency_admin"];
  const inviteRole = validRoles.includes(role) ? role : "client_member";

  // Check if user already exists in org
  const { data: existingUser } = await db.auth.admin.listUsers();
  const targetUser = existingUser?.users?.find((u) => u.email === email.toLowerCase());

  if (targetUser) {
    const { data: existingMembership } = await db
      .from("memberships")
      .select("id")
      .eq("user_id", targetUser.id)
      .eq("organization_id", membership.organization_id)
      .single();

    if (existingMembership) {
      return res.status(409).json({ error: "User is already a member of this organization" });
    }
  }

  // Create or update invitation
  const { data: invite, error } = await db
    .from("invitations")
    .upsert({
      organization_id: membership.organization_id,
      email: email.toLowerCase(),
      role: inviteRole,
      client_id: client_id || null,
      invited_by: user.id,
      status: "pending",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "organization_id,email" })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // If user already has a Supabase account, auto-accept the invitation
  if (targetUser) {
    await db.from("memberships").insert({
      user_id: targetUser.id,
      organization_id: membership.organization_id,
      role: inviteRole,
      client_id: client_id || null,
    });
    await db.from("invitations").update({ status: "accepted" }).eq("id", invite.id);
    return res.json({ invited: true, auto_accepted: true, email });
  }

  // User doesn't exist yet — create their Supabase account with a temp password
  // They'll need to reset password on first login
  const tempPassword = crypto.randomUUID().slice(0, 16) + "Ax1!";
  const { data: newUser, error: createErr } = await db.auth.admin.createUser({
    email: email.toLowerCase(),
    password: tempPassword,
    email_confirm: true,
  });

  if (createErr) return res.status(500).json({ error: "Failed to create user: " + createErr.message });

  // Create membership for the new user
  await db.from("memberships").insert({
    user_id: newUser.user.id,
    organization_id: membership.organization_id,
    role: inviteRole,
    client_id: client_id || null,
  });

  await db.from("invitations").update({ status: "accepted" }).eq("id", invite.id);

  return res.json({
    invited: true,
    auto_accepted: true,
    new_account: true,
    email,
    temp_password: tempPassword,
    message: "Share these credentials with the user. They should change their password after first login.",
  });
}
