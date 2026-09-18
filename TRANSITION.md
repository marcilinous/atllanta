# TRANSITION.md — Atllanta Migration Tracker

> **What this file is:** The living progress log for migrating Atllanta from
> the old vanilla-JS/Supabase-direct build to the target stack defined in
> `CLAUDE.md` (Next.js + TypeScript + Drizzle + Server Actions), plus the
> roles/modules/Langfuse additions.
>
> **How Claude should use this file:**
> 1. At the **start of every session**, read this file first, before
>    `CLAUDE.md` or any code — `Current State` below tells you exactly where
>    things stand and what to work on next.
> 2. Work only on the **first unchecked item** in the current phase unless
>    told otherwise. Don't jump ahead to a later phase.
> 3. When a checklist item is finished, check it off (`- [x]`) and add a
>    one-line note under that phase's **Notes** with the date and what
>    changed (schema, file, or decision).
> 4. When every item in a phase is checked, mark the phase `✅ Done`, bump
>    the version in `Current State`, and move the "you are here" marker to
>    the next phase.
> 5. If you hit a blocker or make a decision that changes scope, log it
>    under **Decisions & Blockers** instead of silently deviating — don't
>    edit the phase checklist to match what happened; fix the blocker or
>    flag it for the owner.
> 6. Never delete history from this file. Completed phases stay, collapsed
>    mentally but not removed — they're the record of what shipped when.

---

## Current State

- **Version:** `v0.0.0` — transition not yet started
- **Active phase:** Phase 0 (Baseline & Scaffold)
- **Stack target:** see `CLAUDE.md`
- **Last updated:** 2026-09-18 — baseline verified against the live database and the
  production branch, and all six owner decisions settled; see Decisions & Blockers.
- **Waiting on:** the owner's promotion of v1.2.0 (merged as `a7431b2`), then tag
  `legacy-frozen` and start Phase 0 item 3 (the Next.js scaffold).

**The legacy app keeps shipping until Phase 8.** It runs production on branch
`claude/gstack-skill-install-chnb41` at `atllanta.vercel.app`, is versioned
separately (`VERSION`, `CHANGELOG.md`, tags `vX.Y.Z` — currently **v1.1.0** live,
**v1.2.0** pending the owner's merge and promotion), and follows
`docs/legacy/CLAUDE-legacy.md`. The `v0.x` ladder below tracks the *new* stack only;
the two version lines are independent and must not be confused.

---

## Versioning

Each phase completion bumps the minor version (`v0.1.0`, `v0.2.0`, …).
Mid-phase fixes or schema patches bump the patch version (`v0.1.1`). `v1.0.0`
is declared only when Phase 8 (old-stack decommission) is done — i.e. the old
vanilla-JS/Supabase-direct code no longer runs in production.

| Version | Phase completed | Status |
|---|---|---|
| v0.1.0 | Phase 1 — Next.js/Drizzle scaffold + Platform module | ☐ |
| v0.2.0 | Phase 2 — Auth, RLS, Server Action pipeline | ☐ |
| v0.3.0 | Phase 3 — Roles, custom roles, module enablement | ☐ |
| v0.4.0 | Phase 4 — HRMS migrated | ☐ |
| v0.5.0 | Phase 5 — Recruitment migrated | ☐ |
| v0.6.0 | Phase 6 — CRM (generic + custom engine) migrated | ☐ |
| v0.7.0 | Phase 7 — Analytics (self-serve BI) built | ☐ |
| v0.8.0 | Phase 8 — Helpdesk + Projects built, old stack decommissioned | ☐ |
| v0.9.0 | Phase 9 — AI Assistant + Langfuse wired end-to-end | ☐ |
| v1.0.0 | Phase 10 — Release/module-flag layer (two-tier flags) | ☐ |

---

## Phase 0 — Baseline & Scaffold

**Goal:** Freeze what exists today; stand up the new repo skeleton without
touching production.

- [ ] Tag/branch the current vanilla-JS/Supabase codebase as `legacy-frozen`
- [ ] Confirm which tables in production still use `client_id`/`memberships`
      (recruitment tables per old CLAUDE.md §13) — list them here
- [ ] Scaffold new Next.js (App Router) + TypeScript project per CLAUDE.md §5
- [ ] Set up Drizzle ORM + `drizzle.config.ts` pointed at the **same**
      Supabase Postgres instance (shared DB during transition)
- [ ] Set up Tailwind + shadcn/ui base theme

**Notes:**
- 2026-09-18 — Item 2 (`client_id`/`memberships` audit) is **already satisfied**:
  the live database has no `memberships` table and no `client_id` column on
  `jobs`; recruitment moved onto `org_id` in the legacy app's own Phase 1. The
  list this item asks for is therefore empty. Verified by query, not by memory.
- 2026-09-18 — Item 1 (`legacy-frozen`): decided. v1.2.0 is merged (`a7431b2`);
  tag the freeze on that commit once the owner has promoted it, so the freeze point
  includes the AI gateway and the two cross-tenant fixes.
- 2026-09-18 — After the freeze the legacy app still receives security fixes and the
  v1.3.0 AI screens (owner decision 2). Plan those as legacy releases (`vX.Y.Z`),
  not as transition phases.

---

## Phase 1 — Platform Module (Module 0)

**Goal:** Identity, org, RLS helper, events, audit, notifications, files —
all live in Drizzle schema, RLS policies applied, nothing user-facing yet.

- [ ] `src/db/schema/platform.ts`: `organizations`, `users`, `departments`,
      `teams`, `invitations`, `audit_logs`, `events`, `notifications`, `files`
- [ ] `auth_org_id()` RLS helper + standard 4-policy set applied to every
      platform table
- [ ] Two-org isolation test passing on every platform table (CLAUDE.md §1)
- [ ] Server Action base pattern (`ActionResponse<T>` type) implemented
- [ ] Event publisher (`src/lib/events/`) + drain worker stubbed

**Notes:**
_(none yet)_

---

## Phase 2 — Auth & Server Action Pipeline

**Goal:** Login, session, and the mutation path are fully on Server Actions
— no direct Supabase client mutation from the browser anywhere in new code.

- [ ] Supabase SSR cookie auth wired in `(auth)/`
- [ ] Zod schemas + Drizzle transactions for all Phase 1 mutations
- [ ] Password-reset flow (`resetPasswordForEmail` + `PASSWORD_RECOVERY`
      handler) — carried over from old CLAUDE.md §8.1 as an open item
- [ ] Confirm `service_role` key is not reachable from any client bundle or
      public route

**Notes:**
_(none yet)_

---

## Phase 3 — Roles, Custom Roles, Module Enablement

**Goal:** `org_modules`, `roles`, `role_permissions` live and enforced end
to end (CLAUDE.md §3.5).

- [ ] `org_modules` table + admin toggle UI (all modules default `false`
      on org creation)
- [ ] System roles seeded per org: `owner`, `admin`, `developer`, `manager`,
      `member`
- [ ] Custom role creation UI (admin-only) writing to `roles` +
      `role_permissions`
- [ ] `src/lib/auth/permissions.ts` — resolves system role defaults, then
      custom-role overrides; used by every Server Action and by the AI
      Assistant path
- [ ] `platform.module.enabled/disabled` and `platform.role.created/updated`
      events emitted and drained correctly

**Notes:**
_(none yet)_

---

## Phase 4 — HRMS Migration

**Goal:** Directory, attendance, leave, assets, expenses, announcements
running on the new stack; old vanilla-JS HRMS views retired.

- [ ] `src/db/schema/hrms.ts` per CLAUDE.md §3 Module 1 table list
- [ ] Data migration script: old Supabase-direct HRMS tables → new schema
      (verify no data loss, especially `leave_balances`)
- [ ] All HRMS mutations behind Server Actions + RLS
- [ ] Old vanilla-JS HRMS views (`views/employees/`, `views/attendance/`,
      etc.) removed from production once parity confirmed

**Notes:**
- 2026-09-18 — Migration risk here is **low**: 67 users, 2 attendance rows, 0 leave
  requests, 0 leave balances in production today. The work is parity of behaviour
  (schedules, geofence, approval chains, HR visibility rules), not data movement.
- 2026-09-18 — Live HRMS carries features the target table list omits: helpdesk,
  documents/files, lifecycle and letters, `work_locations` + geofenced check-in,
  `posts` (noticeboard), and the approvals inbox. Fold them in or decide explicitly
  to drop them before this phase starts.

---

## Phase 5 — Recruitment Migration

**Goal:** Recruitment fully on `org_id` (old `client_id` model fully
retired), all 7 pillars from CLAUDE.md §3 Module 4 working.

- [ ] `applications`, `candidates`, `jobs`, `interviews`, etc. migrated off
      `client_id`/`memberships` onto `org_id`
- [ ] Groq CV↔JD matching ported (keep working prompts, restructure
      surrounding code only)
- [ ] Google Calendar OAuth + booking link flow (`/schedule/[token]`)
- [ ] WhatsApp safety-gate dispatch logic ported and tested

**Notes:**
- 2026-09-18 — Item 1 is **already done in the legacy app**: no `client_id`, no
  `memberships`; the join table is `job_applications` (target calls it
  `applications`), scheduling uses `interview_slots` (target:
  `interview_booking_links`) and `user_google_tokens` (target:
  `interviewer_calendars`). This phase is a rename-and-port, not a tenancy fix.
- 2026-09-18 — WhatsApp does not exist yet in any form (no `whatsapp_messages`
  table, no BSP account wired). It is **new build**, not a port.
- 2026-09-18 — The legacy app gained an AI gateway in v1.2.0: all Groq calls are
  metered against per-org monthly token quotas and per-user daily limits, with a
  bot check and Langfuse tracing (`docs/context/ai.md`). The new stack must call
  the same quota functions, or metering silently stops working at cutover.

---

## Phase 6 — CRM (Generic + Custom Engine)

**Goal:** This module doesn't exist in the old build — it's new, not a
migration.

> **Correction (2026-09-18):** CRM **does** exist in the live build and holds the
> heaviest data in the system — 6,132 partner records and 83,453 imported report
> rows across 14 screens. Treat this phase as *migration + new engine*, and plan
> the data path before writing schema. See Decisions & Blockers.
>
> **Scope (owner decision 2026-09-18):** migrate the **generic** CRM only. The
> RTcompu partner vertical is custom-built for one tenant and stays exactly as it is
> — not ported, not rebuilt on the custom engine, not retired. Distribution is no
> longer an Atllanta product line, so nothing generic is built from it. Live table
> names stay as they are.

- [ ] Generic CRM: accounts, contacts, leads, pipelines, deals, activities
- [ ] Custom CRM: entity definitions, field definitions, custom records
      (`crm_custom_records` + GIN index on `data`)
- [ ] Code hooks sandbox (`beforeInsert`/`afterChange`) — scope the sandbox
      approach before building (security review needed)
- [ ] `crm.lead.converted`, `crm.deal.won` events wired to their known
      subscribers (Projects onboarding, per CLAUDE.md §4)

**Notes:**
- 2026-09-18 — What exists live: generic CRM (`crm_leads`, `crm_contacts`,
  `crm_opportunities`, `crm_pipeline_stages`, `crm_activities`) **plus** the
  RTcompu partner/distribution vertical (`crm_partner_details` (41 cols, 6,132
  rows), `crm_visits`, `crm_calls`, `crm_events`, PJP journey plans, Tally report
  import with content-hash dedupe, ~35 analytics RPCs and 3 materialised views).
  `crm_accounts` is a **view** over `crm_partner_details`, not a table.
- 2026-09-18 — Naming diverges: target says `crm_deals` + `crm_pipelines`, live
  has `crm_opportunities` + `crm_pipeline_stages`. Decide rename-vs-keep before
  schema work; a rename touches every partner screen and RPC.
- 2026-09-18 — The partner pack is gated per tenant by
  `organizations.partner_crm_enabled`. In the target model that gate becomes an
  `org_modules` row — and the custom-entity engine may be able to express the
  whole vertical. Worth deciding deliberately: port the pack, or rebuild it as
  the first customer of the custom engine.

---

## Phase 7 — Self-Serve Analytics

**Goal:** Also new — replaces the old ad-hoc `views/reports/*` screens
entirely, not a like-for-like port.

> **Correction (2026-09-18):** a self-serve analytics layer already exists in the
> legacy app (semantic models, SQL compiler, six chart types, saved questions,
> dashboards, alerts, a natural-language path, and DuckDB-Wasm for local
> slice/dice) — see `docs/context/analytics.md`. It has 0 saved questions in
> production, so nothing to migrate, but its **security shape is worth keeping**:
> every query runs through `analytics_run_sql`, which is SECURITY INVOKER, so RLS
> applies to the caller and analytics can never surface a row the user can't see.

- [ ] `analytics_questions`, `analytics_dashboards`,
      `analytics_dashboard_cards`, `analytics_subscriptions` schema
- [ ] Visual "Ask a Question" builder (no-SQL path)
- [ ] Monaco SQL editor with parameterized variables
- [ ] Scheduled Pulses (cron digests via Resend)

**Notes:**
_(none yet)_

---

## Phase 8 — Helpdesk, Projects & Legacy Decommission

**Goal:** Last two new modules built; old vanilla-JS/Supabase-direct app
fully retired from production.

- [ ] Helpdesk round-robin engine + SLA escalation
- [ ] Project Tracking (Projects → Milestones → Tasks → Subtasks)
- [ ] Cross-module linkage: CRM Won Deal → Project, Helpdesk escalation
- [ ] Old vanilla-JS deployment removed from Vercel / DNS repointed
- [ ] `legacy-frozen` branch archived (not deleted)

**Notes:**
_(none yet)_

---

## Phase 9 — AI Assistant + Langfuse

**Goal:** Copilot live with full observability, per CLAUDE.md §3 Module 7.

- [ ] Natural-language intent → Groq → Server Action execution path
- [ ] Two-step mutation guard (confirmation modal on destructive actions)
- [ ] Langfuse tracing wired on every Groq call (JD gen, matching, AI
      Assistant) with `org_id` tagging
- [ ] `developer`-role-only access to Langfuse trace views confirmed

**Notes:**
_(none yet)_

---

## Phase 10 — Release / Module-Flag Layer

**Goal:** The two-tier flag system discussed (platform-level "is this
module release-ready" vs. org-level "has this admin turned it on") —
**not yet in CLAUDE.md**, design pending before building.

- [ ] Design review: `module_registry` (platform-level) vs. `org_modules`
      (org-level) split — confirm schema before writing migrations
- [ ] Per-module changelog convention decided (file-per-module vs.
      `module_version` column)
- [ ] Migration safety rule adopted: no breaking migration ships in the same
      deploy as a flag flip
- [ ] Rollback runbook written (whole-monolith revert, since this isn't
      microservices)

**Notes:**
_(none yet)_

---

## Decisions & Blockers

_(Log anything that changes scope, gets deferred, or needs the owner's call
— date-stamped, most recent first.)_

### 2026-09-18 — Verified baseline (read before planning any phase)

Checked against the live database (`nburswxjpukntgdwuyme`) and the production
branch, because several phase assumptions were written from an older snapshot.

**Already true — don't re-do it:**
- No `memberships` table, no `client_id` anywhere. Tenancy is `org_id` + RLS via
  `auth_org_id()` across 64 tables; 107 migrations replay cleanly.
- The password-reset flow (Phase 2 item 3) already ships in the legacy app.
- HRMS, Recruitment, CRM and self-serve Analytics **all exist and are in use**.
  Helpdesk exists too (tickets, categories, round-robin handlers) — Phase 8 lists
  it as new; only `helpdesk_comments` and the SLA/escalation matrix are missing.

**Not built at all (genuinely new):** Projects/`pm_*`, WhatsApp dispatch,
`org_modules`, `roles`/`role_permissions`, the `developer` role, custom CRM
entities/fields/records, code-hook sandbox.

**Data at stake at cutover** (this is where migration risk actually lives):
6,132 `crm_partner_details`, 83,453 `crm_report_rows`, 67 users, 5 orgs. HRMS and
Recruitment data is negligible (2 attendance rows, 0 leave requests, 4
applications, 5 candidates). So: **CRM is the migration; the rest is a rewrite.**

**Live features the target CLAUDE.md doesn't mention** — fold in or drop on
purpose, don't lose by omission: the AI token-quota system (`ai_*` tables,
per-org monthly quota, per-user daily limit, bot check, `platform_admins`),
Langfuse full tracing, `feature_access` per-role/per-user module gating (the
current equivalent of `org_modules`), the RTcompu partner vertical, geofenced
attendance + `work_locations`, documents/`files`, lifecycle and letters,
noticeboard `posts`, the approvals inbox, outbound webhooks + `api_keys` +
`rate_limits`, and the legacy credits columns (unused since v1.2.0).

### 2026-09-18 — Owner decisions (all six settled)

1. **Ship v1.2.0, then freeze.** PR #104 merged as `a7431b2`; the owner promotes it,
   then `legacy-frozen` is tagged on that commit — so the freeze point includes the
   AI gateway and the two cross-tenant fixes.
2. **Freeze depth: fixes + the v1.3.0 AI screens.** While the new stack is built,
   the legacy app may receive security and data-loss fixes (the advisor findings)
   **and** the already-planned v1.3.0 work: the platform console, the per-org AI
   usage screen, and the "AI today" indicator. Nothing else — no new features.
   Rationale: quotas are live and unmanageable without those screens; everything
   else would be built twice.
3. **Partner vertical stays; the distribution *product line* is dropped.**
   (Corrected 2026-09-18 after an initial misreading — the first version of this
   entry said the vertical itself was being decommissioned. It is not.)
   - **Stays as it is:** the RTcompu partner/field-sales CRM. Custom-built for one
     tenant, gated by `partner_crm_enabled`, holding 6,132 partner rows and 83,453
     imported report rows. No port, no rebuild, no generalisation, no retirement.
   - **Decommissioned:** the earlier plan to make distribution an Atllanta product
     line — a generic distribution/field-sales module for every tenant. It leaves
     the roadmap; nothing is deleted from the database because of it.
   - **Open:** where the vertical lives after cutover (see the open question below).
4. **Keep the live table names; the target doc is corrected.** `crm_opportunities`
   (not `crm_deals`), `crm_pipeline_stages` (not `crm_pipelines`), `job_applications`
   (not `applications`), `interview_slots` (not `interview_booking_links`),
   `user_google_tokens` (not `interviewer_calendars`). `CLAUDE.md` now matches.
5. **Keep both gates.** `org_modules` (is the module on for this org) and
   `feature_access` (may this role or person see it) both survive; Server Actions
   check both.
6. **Cutover is module-by-module**, each behind its own routing rule, on the shared
   database. No big-bang switch at Phase 8.

**Consequences to carry into planning:** Phase 8's "old vanilla-JS deployment
removed" becomes the *last* module's cutover, not a single event; Phase 10's flag
layer must model two gates, not one; and every phase that touches CRM must leave the
partner screens working, since they are staying.

### 2026-09-18 — Open question: where does the partner vertical live after cutover?

Decision 3 keeps it running as-is, and decision 6 moves modules one at a time — but
Phase 8 ends with the legacy deployment removed. Those meet at RTcompu. Three ways
out, owner's call before Phase 6 planning starts:

- **Port it as a tenant-specific module** on the new stack, screens unchanged in
  behaviour. Most work; one deployment at the end.
- **Keep the legacy app deployed for RTcompu only**, on its own URL, reading the same
  database. No port; two deployments to maintain, and the legacy freeze becomes
  permanent for that code.
- **Rebuild it on the custom-entity engine** once that engine exists. Least code
  long-term, highest risk to a working system with the largest dataset.

Until this is answered, Phase 8's "old deployment removed" item is blocked, not the
rest of the transition.
