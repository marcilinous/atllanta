# Phase 3 — Roles, Custom Roles, Module Enablement (plan)

Status: **approved with owner decisions** (2026-09-26); decision 4 (module
keys) still awaits review. Nothing here is built yet.

**Owner decisions (2026-09-26):** 1 — existing orgs start with every module
**off** (not the recommended backfill); 2 — base system role + custom role;
3 — admin screens on the new stack; 4 — pending; Step 0 ships now as its own
release.

**Consequence of decision 1 for the order:** the admin module-toggle screen
(Step 4) must be live, and org admins told, *before* the gate is enforced
(Step 3) — otherwise an org is locked out with no way to switch its modules
back on. Enforcement becomes its own owner-triggered go-live. Revised order:
0 → 1 → 2 → 4 → 5 → 3.
Source of truth for the goal: CLAUDE.md §3.5 and TRANSITION.md Phase 3.

## What exists today (verified 2026-09-26)

Live database (read-only queries) and code map:

- **No RBAC tables.** `org_modules`, `roles`, `role_permissions` and
  `users.custom_role_id` do not exist in the database, the migrations or the
  Drizzle schema.
- **Roles are a fixed text value.** `users.role` has a live CHECK
  `('owner','admin','manager','member')` that no migration file contains
  (drift). It rejects `developer`. Data: 48 member, 13 manager, 4 admin,
  2 owner; 67 users, all active; 5 organisations.
- **Role strings are hard-coded everywhere.** About 50 legacy views compare
  `users.role` directly (`['owner','admin']` = admin, `+ 'manager'` = manager),
  and so do the RLS helpers (`is_org_admin`, `crm_user_is_org_admin` — an
  exact duplicate — `hr_can_approve`, `hr_can_configure`,
  `crm_user_is_manager_plus`, `hr_visible_user_ids`). One dead
  `'super_admin'` check (`views/audit/log.js:15`).
- **Module gating is UI-only.** `public/js/features.js` hides nav and routes
  from `feature_access` (14 rows, all role-level denies, 2 of 5 orgs) plus
  `organizations.crm_enabled` / `partner_crm_enabled`. No server code and no
  RLS policy reads any of it. The admin screen that wrote `feature_access`
  (`views/settings/access.js`) was deleted and never restored.
- **No guard on role changes.** `users_guard_admin_fields()` lets admins
  through untouched; nothing stops an admin granting `owner` (to themselves
  or anyone) or demoting the last owner. The old `memberships_guard` did this
  and was dropped with `memberships`.
- **Drift:** `organizations.crm_enabled` defaults `true` in
  `src/db/schema/platform.ts` but `false` in its migration.

## Design principles

1. **Nothing a live user can see disappears.** Every schema change ships with
   a backfill that reproduces today's behaviour exactly; enforcement is
   switched on only after the backfill is verified.
2. **The legacy app keeps working on `users.role`.** It is read in ~50 files
   and in RLS; rewriting that is each module's cutover (Phases 4–8), not
   Phase 3. Phase 3 adds the new model *alongside* and makes the legacy app
   read the module gate, nothing more.
3. **One resolver** (`src/lib/auth/permissions.ts`) and one SQL mirror
   (`module_enabled()`), so Server Actions, RLS and the AI path agree.
4. **Every step is its own reviewed, tested, promoted release**, in the
   order below, each reversible on its own.

## Proposed order

### Step 0 — Role-change guard (security, legacy release, ship first)
Extend `users_guard_admin_fields()`: only an `owner` may set or remove
`role = 'owner'`; nobody changes their own role; an org can never be left
without an owner. Tests mirror `tests/org-id-assigned-by-atllanta.test.mjs`.
Verified in a rolled-back transaction on production, like v1.2.3.

### Step 1 — Schema + faithful backfill (migration, legacy release)
- `org_modules(id, org_id, module_key, is_enabled, enabled_by, enabled_at)`,
  unique `(org_id, module_key)`, RLS: members read their org's rows, only
  owner/admin write.
- `roles(id, org_id, name, slug, is_system, description, created_by,
  created_at)`, unique `(org_id, slug)`; `role_permissions(id, org_id,
  role_id, module_key, permission, created_at)`, permission CHECK
  `view|create|edit|delete|approve`. System rows immutable (trigger).
- `users.custom_role_id uuid null references roles(id)`; widen the
  `users.role` CHECK to add `developer` (and record the CHECK in a migration,
  ending the drift).
- **Seed** the five system roles for every org, and on org creation.
- **Seed `org_modules`** with every module **off** for every org, existing
  and new (owner decision 1). Nothing reads it yet, so nothing changes for
  users until Step 3's enforcement go-live.
- `module_enabled(p_org uuid, p_key text) returns boolean` (stable, security
  definer, search_path pinned) — the SQL mirror of the gate.

### Step 2 — `permissions.ts` (new stack, no user-visible change)
`resolve(caller) → { role, customRoleId, modules, can(module, permission) }`:
system-role defaults first, then `role_permissions` overrides for a custom
role, then the `org_modules` gate, then `feature_access` (both gates, per the
2026-09-18 decision). Used by `action()`-wrapped Server Actions through one
`requirePermission(module, permission)` helper; the AI Assistant path calls
the same function. Unit-tested against a fixture matrix.

### Step 3 — Legacy reads the module gate (legacy release)
`features.js` adds `org_modules` as a platform gate beside
`crm_enabled`/`partner_crm_enabled` (which become derived from it and are
retired later). Admins still cannot bypass platform gates. Regression tests
extend `tests/feature-gating.test.mjs`, including the `feature_access`
precedence it does not cover today.

### Step 4 — Admin screens (first real new-stack screens)
Under `app/(platform)/settings/`: module toggles, custom roles (create /
edit permissions; system roles read-only), and the restored `feature_access`
editor. All writes are Server Actions through `withTransaction` (RLS as the
caller) + audit row + publish.

### Step 5 — Events
`platform.module.enabled/disabled`, `platform.role.created/updated` published
after commit by the Step 4 actions; the drain handles them (no-op recipes
unless a consumer exists), with tests.

## Decisions for the owner

1. **Backfill for existing orgs.** Recommended: enable, per org, exactly the
   modules its users can reach today (CRM per `crm_enabled`, the partner pack
   per `partner_crm_enabled`, everything else on), so go-live changes nothing
   visible. Alternative: start everyone off and let admins switch on — every
   live customer loses their modules until an admin acts.
2. **Custom roles vs. the legacy app.** §3.5 says a user has `users.role`
   *or* `custom_role_id`, never both. But the legacy app and RLS only
   understand `users.role`, so a custom-role user would be treated as a
   plain member everywhere until each module migrates. Recommended: a
   custom-role user **keeps a base system role** in `users.role` (what the
   legacy app and RLS use) and `custom_role_id` adds module permissions on
   the new stack; revisit "never both" at Phase 8. This deviates from §3.5
   and needs your call.
3. **Where the admin screens live.** Recommended: the new stack (Step 4),
   as the first real Next.js screens, linked from the legacy Settings page.
   Alternative: restore the legacy `settings/access.js` and add the new
   screens there — less new-stack progress, faster to ship.
4. **Module keys.** CLAUDE.md names HRMS, CRM, Analytics, Recruitment,
   Helpdesk, Projects and AI Assistant; the legacy app gates finer keys.
   Proposed `org_modules` keys: `hrms` (people, me, inbox, documents, finance,
   announcements), `crm`, `crm_partner` (the partner pack), `recruitment`,
   `analytics`, `helpdesk`, `projects`, `ai`; `dashboard` and `reports` stay
   always-on platform surfaces, with `feature_access` keeping the per-role
   fine grain. Please confirm or amend.

## Out of scope for Phase 3

Rewriting the legacy role checks or RLS helpers to read `roles` (each
module's cutover); RLS-level module enforcement on every module table (added
per module as it migrates — Phase 3 enforces in Server Actions and the legacy
nav); billing.
