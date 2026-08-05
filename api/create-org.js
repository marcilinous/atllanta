// Org & team administration endpoint
//
// POST  { type: "agency", name, admin_email }    — create agency (super_admin)
// POST  { type: "client", name, admin_email }    — onboard client (agency_admin)
// POST  { action: "invite", email, role, ... }   — invite member
// GET   ?action=team[&org_id=&client_id=]        — list team members
// GET   ?action=orgs                             — list orgs + clients hierarchy

import { supabaseAdmin, SUPABASE_URL } from "../lib/supabaseServer.js";
import { findOrCreateUser, provisionMember } from "../lib/provisionMember.js";

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
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(token);
  if (!user?.id) return res.status(401).json({ error: "Invalid session" });

  const db = supabaseAdmin();
  const action = req.query?.action || req.body?.action;

  if (req.method === "GET" && action === "team") return handleTeam(req, res, db, user);
  if (req.method === "GET" && action === "orgs") return handleOrgs(req, res, db, user);
  if (req.method === "POST" && action === "invite") return handleInvite(req, res, db, user);
  if (req.method === "POST" && action === "reset_password") return handleResetPassword(req, res, db, user);
  if (req.method === "POST" && action === "set_hr_access") return handleSetHrAccess(req, res, db, user);
  if (req.method === "POST") return handleCreateOrg(req, res, db, user);

  return res.status(400).json({ error: "Invalid action" });
}

// --- Create agency / onboard client ---

async function handleCreateOrg(req, res, db, user) {
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

// --- Invite member ---

async function handleInvite(req, res, db, user) {
  const { data: membership } = await db
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .in("role", ["owner", "admin", "super_admin", "agency_admin"])
    .single();

  if (!membership) return res.status(403).json({ error: "Insufficient permissions" });

  const { email: rawEmail, role, full_name, client_id,
          department_id, reporting_manager_id, designation, date_of_joining } = req.body || {};
  if (!rawEmail?.trim()) return res.status(400).json({ error: "Email is required" });

  const allowedRoles = ["owner", "admin", "manager", "member"];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  const email = rawEmail.trim().toLowerCase();
  const orgId = membership.organization_id;

  const { data: existing } = await db
    .from("memberships")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: "This email is already a member" });
  }

  const result = await provisionMember(db, {
    orgId, email, role, full_name, client_id,
    department_id, reporting_manager_id, designation, date_of_joining,
  });
  if (result.error) return res.status(500).json({ error: result.error });

  return res.json({
    invited: true,
    email,
    role,
    user_id: result.user_id,
    new_account: result.new_account,
    temp_password: result.temp_password || null,
  });
}

// --- Reset a member's password (admin sets a new temp password) ---

async function handleResetPassword(req, res, db, user) {
  const { data: membership } = await db
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .in("role", ["owner", "admin", "super_admin", "agency_admin"])
    .single();

  if (!membership) return res.status(403).json({ error: "Insufficient permissions" });

  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: "user_id is required" });

  // Target must belong to the admin's organization.
  const { data: target } = await db
    .from("memberships")
    .select("id, email")
    .eq("user_id", user_id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  if (!target) return res.status(404).json({ error: "Member not found in your organization" });

  const tempPassword = crypto.randomUUID().slice(0, 16) + "Ax1!";
  const { error } = await db.auth.admin.updateUserById(user_id, {
    password: tempPassword,
    email_confirm: true,
  });
  if (error) return res.status(500).json({ error: "Reset failed: " + error.message });

  return res.json({ reset: true, email: target.email, temp_password: tempPassword });
}

// --- Assign HR access (level + optional department scope) to a member ---

async function handleSetHrAccess(req, res, db, user) {
  const { data: me } = await db
    .from("memberships")
    .select("organization_id, role, hr_level")
    .eq("user_id", user.id)
    .single();

  if (!me) return res.status(403).json({ error: "Insufficient permissions" });

  const orgAdminRoles = ["owner", "admin", "super_admin", "agency_admin", "client_admin"];
  const isOrgAdmin = orgAdminRoles.includes(me.role);
  const isHrHead = me.hr_level === "head";
  if (!isOrgAdmin && !isHrHead) {
    return res.status(403).json({ error: "Only admins or HR heads can manage HR access" });
  }

  const { user_id, hr_level, hr_scope_department_id } = req.body || {};
  const levels = ["none", "exec", "manager", "head"];
  if (!user_id) return res.status(400).json({ error: "user_id is required" });
  if (!levels.includes(hr_level)) return res.status(400).json({ error: "Invalid hr_level" });
  // Only org admins may mint HR Heads; an HR Head can grant exec/manager only.
  if (hr_level === "head" && !isOrgAdmin) {
    return res.status(403).json({ error: "Only org admins can grant HR Head" });
  }

  const { data: target } = await db
    .from("memberships")
    .select("id")
    .eq("user_id", user_id)
    .eq("organization_id", me.organization_id)
    .maybeSingle();

  if (!target) return res.status(404).json({ error: "Member not found in your organization" });

  // Scope only applies to exec/manager, and must be a department in this org.
  let scope = null;
  if ((hr_level === "exec" || hr_level === "manager") && hr_scope_department_id) {
    const { data: dept } = await db
      .from("departments")
      .select("id")
      .eq("id", hr_scope_department_id)
      .eq("org_id", me.organization_id)
      .maybeSingle();
    if (dept) scope = hr_scope_department_id;
  }

  const { error } = await db
    .from("memberships")
    .update({ hr_level, hr_scope_department_id: scope })
    .eq("id", target.id);
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ updated: true, user_id, hr_level, hr_scope_department_id: scope });
}

// --- List team members ---

async function handleTeam(req, res, db, user) {
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

// --- List orgs + clients hierarchy ---

async function handleOrgs(req, res, db, user) {
  const { data: membership } = await db
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .single();

  if (!membership) return res.status(403).json({ error: "No organization" });

  const isTopAdmin = ["super_admin", "owner"].includes(membership.role);

  if (isTopAdmin) {
    const { data: agencies } = await db
      .from("organizations")
      .select("id, name, org_type, plan_tier, slug")
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

  if (["agency_admin", "admin"].includes(membership.role)) {
    const { data: org } = await db
      .from("organizations")
      .select("id, name, org_type, plan_tier, slug")
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

  return res.json({ agencies: [] });
}
