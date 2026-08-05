// Shared member provisioning — the single source of truth for turning an
// email into a usable org member: an auth login + a membership + an employee
// profile. Used by the invite endpoint and the bulk importer so both get the
// same robustness (pagination-safe lookup, NULL-token tolerance, orphaned
// account recovery).

import { randomUUID } from "node:crypto";

const tempPassword = () => randomUUID().slice(0, 16) + "Ax1!";

// Find an existing auth user by email. Primary path is a direct indexed
// lookup (RPC) — robust against GoTrue's admin listUsers, which is paginated
// (misses users past the first page) and 500s when any auth.users row has a
// legacy NULL token column. listUsers paging is kept as a fallback.
export async function findAuthUserByEmail(db, email) {
  const { data: rpcId, error: rpcErr } = await db.rpc("auth_user_id_by_email", { p_email: email });
  if (!rpcErr && rpcId) return { id: rpcId };

  const target = email.toLowerCase();
  const perPage = 1000;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const users = data?.users || [];
    const hit = users.find((u) => (u.email || "").toLowerCase() === target);
    if (hit) return { id: hit.id };
    if (!users.length) return null; // reached the end
  }
  return null;
}

// Get (or create) the auth login for an email. Creates first — the common
// path for a new person — and resolves an existing/orphaned account by lookup
// when the email is already registered.
export async function findOrCreateUser(db, email) {
  const pw = tempPassword();
  const { data: newUser, error } = await db.auth.admin.createUser({
    email,
    password: pw,
    email_confirm: true,
  });

  if (!error && newUser?.user) {
    return { id: newUser.user.id, new_account: true, temp_password: pw };
  }

  const existing = await findAuthUserByEmail(db, email);
  if (existing) return { id: existing.id, new_account: false };

  return { error: "Failed to create user: " + (error?.message || "unknown error") };
}

// Full provisioning for an org staff member (roles owner/admin/manager/member):
// auth login + membership + employee profile. Idempotent on (org, email).
// Returns { user_id, email, new_account, temp_password, membership_existed }
// or { error }.
export async function provisionMember(db, opts) {
  const {
    orgId, email, role, full_name,
    designation, department_id, reporting_manager_id, date_of_joining, client_id,
  } = opts;

  const useRole = ["owner", "admin", "manager", "member"].includes(role) ? role : "member";

  const authUser = await findOrCreateUser(db, email);
  if (authUser.error) return { error: authUser.error };

  // Orphaned account (exists in auth but no membership anywhere) → give it a
  // fresh temp password so the admin has shareable credentials.
  let isNew = authUser.new_account;
  let sharePassword = authUser.temp_password || null;
  if (!authUser.new_account) {
    const { count } = await db.from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authUser.id);
    if (!count) {
      const pw = tempPassword();
      const { error: pwErr } = await db.auth.admin.updateUserById(authUser.id, { password: pw, email_confirm: true });
      if (!pwErr) { sharePassword = pw; isNew = true; }
    }
  }

  // Membership (idempotent on org + email).
  const { data: existingMem } = await db.from("memberships")
    .select("id").eq("organization_id", orgId).eq("email", email).maybeSingle();
  const membershipExisted = !!existingMem;
  if (!existingMem) {
    const { error: memErr } = await db.from("memberships").insert({
      user_id: authUser.id,
      organization_id: orgId,
      role: useRole,
      email,
      full_name: (full_name || "").trim() || null,
      client_id: client_id || null,
    });
    if (memErr) return { error: memErr.message };
  }

  // Employee profile — the org-hierarchy anchor. Validate department /
  // manager belong to this org before use.
  const profile = {
    id: authUser.id,
    org_id: orgId,
    full_name: (full_name || "").trim() || email,
    email,
    role: useRole,
    status: "active",
    designation: (designation || "").trim() || null,
    date_of_joining: date_of_joining || null,
  };
  if (department_id) {
    const { data: dept } = await db.from("departments").select("id").eq("id", department_id).eq("org_id", orgId).maybeSingle();
    if (dept) profile.department_id = department_id;
  }
  if (reporting_manager_id) {
    const { data: mgr } = await db.from("users").select("id").eq("id", reporting_manager_id).eq("org_id", orgId).maybeSingle();
    if (mgr) profile.reporting_manager_id = reporting_manager_id;
  }
  const { error: profErr } = await db.from("users").upsert(profile, { onConflict: "id" });
  if (profErr) return { error: "Profile: " + profErr.message };

  return { user_id: authUser.id, email, new_account: isNew, temp_password: sharePassword, membership_existed: membershipExisted };
}
