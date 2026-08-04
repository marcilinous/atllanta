// Org & team administration endpoint
//
// POST  { type: "agency", name, admin_email }    — create agency (super_admin)
// POST  { type: "client", name, admin_email }    — onboard client (agency_admin)
// POST  { action: "invite", email, role, ... }   — invite member
// GET   ?action=team[&org_id=&client_id=]        — list team members
// GET   ?action=orgs                             — list orgs + clients hierarchy

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

  if (req.method === "GET" && action === "team") return handleTeam(req, res, db, user);
  if (req.method === "GET" && action === "orgs") return handleOrgs(req, res, db, user);
  if (req.method === "POST" && action === "invite") return handleInvite(req, res, db, user);
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

  const authUser = await findOrCreateUser(db, email);
  if (authUser.error) return res.status(500).json({ error: authUser.error });

  const { error: insertErr } = await db.from("memberships").insert({
    user_id: authUser.id,
    organization_id: orgId,
    role,
    email,
    full_name: (full_name || "").trim() || null,
    client_id: client_id || null,
  });

  if (insertErr) return res.status(500).json({ error: insertErr.message });

  // Create the employee profile so the person occupies a place in the org
  // hierarchy — this is what role-based HRMS/CRM (manager visibility, leave
  // approvals, record ownership) keys off. department_id / reporting_manager
  // are validated to belong to this org before use.
  const profile = {
    id: authUser.id,
    org_id: orgId,
    full_name: (full_name || "").trim() || email,
    email,
    role,
    status: "active",
    designation: (designation || "").trim() || null,
    date_of_joining: date_of_joining || null,
  };

  if (department_id) {
    const { data: dept } = await db.from("departments")
      .select("id").eq("id", department_id).eq("org_id", orgId).maybeSingle();
    if (dept) profile.department_id = department_id;
  }
  if (reporting_manager_id) {
    const { data: mgr } = await db.from("users")
      .select("id").eq("id", reporting_manager_id).eq("org_id", orgId).maybeSingle();
    if (mgr) profile.reporting_manager_id = reporting_manager_id;
  }

  const { error: profErr } = await db.from("users").upsert(profile, { onConflict: "id" });
  if (profErr) return res.status(500).json({ error: "Profile: " + profErr.message });

  return res.json({
    invited: true,
    email,
    role,
    user_id: authUser.id,
    new_account: authUser.new_account,
    temp_password: authUser.temp_password || null,
  });
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
