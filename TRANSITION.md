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
- **Last updated:** _(Claude fills in the date on first real progress)_

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
_(none yet)_

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
_(none yet)_

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
_(none yet)_

---

## Phase 6 — CRM (Generic + Custom Engine)

**Goal:** This module doesn't exist in the old build — it's new, not a
migration.

- [ ] Generic CRM: accounts, contacts, leads, pipelines, deals, activities
- [ ] Custom CRM: entity definitions, field definitions, custom records
      (`crm_custom_records` + GIN index on `data`)
- [ ] Code hooks sandbox (`beforeInsert`/`afterChange`) — scope the sandbox
      approach before building (security review needed)
- [ ] `crm.lead.converted`, `crm.deal.won` events wired to their known
      subscribers (Projects onboarding, per CLAUDE.md §4)

**Notes:**
_(none yet)_

---

## Phase 7 — Self-Serve Analytics

**Goal:** Also new — replaces the old ad-hoc `views/reports/*` screens
entirely, not a like-for-like port.

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

- _(none yet)_
