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

- **Version:** `v0.1.0` — Phase 1 complete (platform schema, policies, Server
  Action pattern, event bus stub, two-org isolation test)
- **Active phase:** Phase 2 (Auth & Server Action Pipeline) — Phase 1 complete
- **Stack target:** see `CLAUDE.md`
- **Last updated:** 2026-09-24 — Phase 2 item 3 done: the reset link is
  verified server-side at `/auth/confirm`, because item 1's cookie client forces
  PKCE and broke the old client-side link. Also fixed an item 1 miss —
  `public/login.html` still kept its own localStorage session.
- **Next unchecked item:** Phase 2 item 4 (confirm `service_role` is not
  reachable from any client bundle or public route). Items 1 and 3 ship
  together with a Supabase email-template change — see Decisions & Blockers,
  2026-09-24.

**The legacy app keeps shipping until Phase 8.** It runs production on branch
`claude/gstack-skill-install-chnb41` at `atllanta.vercel.app`, is versioned
separately (`VERSION`, `CHANGELOG.md`, tags `vX.Y.Z` — **v1.2.3** live since
2026-09-23), and follows
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
| v0.1.0 | Phase 1 — Next.js/Drizzle scaffold + Platform module | ✅ 2026-09-23 |
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

- [x] Tag/branch the current vanilla-JS/Supabase codebase as `legacy-frozen`
- [x] Confirm which tables in production still use `client_id`/`memberships`
      (recruitment tables per old CLAUDE.md §13) — list them here: **none**
- [x] Scaffold new Next.js (App Router) + TypeScript project per CLAUDE.md §5
- [x] Set up Drizzle ORM + `drizzle.config.ts` pointed at the **same**
      Supabase Postgres instance (shared DB during transition)
- [x] Set up Tailwind + shadcn/ui base theme

**Notes:**
- 2026-09-18 — Item 2 (`client_id`/`memberships` audit) is **already satisfied**:
  the live database has no `memberships` table and no `client_id` column on
  `jobs`; recruitment moved onto `org_id` in the legacy app's own Phase 1. The
  list this item asks for is therefore empty. Verified by query, not by memory.
- 2026-09-18 — Items 1 and 2 done. v1.2.0 was merged (`a7431b2`), promoted by the
  owner, and verified live: `/version.json` reads 1.2.0, unauthenticated API calls
  are refused, `/api/ai-query` returns 503, internal docs are not downloadable, and
  `tests/browser-verify.mjs` passes 22/22 against production. Tags `v1.2.0` and
  `legacy-frozen` both point at `a7431b2`, so the freeze point includes the AI
  gateway and the two cross-tenant fixes.
- 2026-09-18 — Item 2's answer is **none**: no `memberships` table, no `client_id`
  column anywhere in the live database.
- 2026-09-18 — After the freeze the legacy app still receives security fixes and the
  v1.3.0 AI screens (owner decision 2). Plan those as legacy releases (`vX.Y.Z`),
  not as transition phases.
- 2026-09-18 — Items 3–5 built on branch `claude/phase-0-scaffold` (not yet merged).
  Next.js owns the deployment; the legacy app is served unchanged from `public/`,
  and all 12 legacy endpoints sit behind one catch-all route. **Vercel counts 2
  functions** (`/health` + the catch-all) against a budget of 10 — the owner's
  instruction is to stay well under the Hobby cap of 12. Drizzle reads the shared
  database (read-only, no migrations); the preview's `/health` shows the live
  counts, 5 organisations and 67 users. Tailwind/shadcn alias `public/css/tokens.css`
  directly; button, input, card, table, dialog and badge were measured equal to the
  legacy classes in light and dark. `DATABASE_URL` (transaction pooler, 6543) is set
  in Vercel for Production and Preview. 115/115 unit tests, 22/22 browser checks.
- 2026-09-18 — Gotcha: a `DATABASE_URL` pasted with quotes, a `psql` prefix or an
  unencoded `@` in the password fails as `ERR_INVALID_URL`; paste the bare URI and
  percent-encode the password.
- 2026-09-18 — Open for Phase 2: a Next page does not yet read the legacy theme
  choice (`data-theme`), and the two session stores (localStorage vs cookies) still
  need reconciling before the first real screen ships.

---

## Phase 1 — Platform Module (Module 0)

**Goal:** Identity, org, RLS helper, events, audit, notifications, files —
all live in Drizzle schema, RLS policies applied, nothing user-facing yet.

- [x] `src/db/schema/platform.ts`: `organizations`, `users`, `departments`,
      `teams`, `invitations`, `audit_logs`, `events`, `notifications`, `files`
- [x] `auth_org_id()` RLS helper + the right policy set per platform table
      (reworded 2026-09-22, owner decision — see Decisions & Blockers)
- [x] Two-org isolation test passing on every platform table (CLAUDE.md §1)
- [x] Server Action base pattern (`ActionResponse<T>` type) implemented
- [x] Event publisher (`src/lib/events/`) + drain worker stubbed

**Notes:**
- 2026-09-22 — Item 1 done. `src/db/schema/platform.ts` (hand-written in Phase 0)
  re-verified read-only against the live database: all 10 tables and every
  column, type, nullability and default match. Added the 14 live foreign keys as
  Drizzle `.references()` (9 `org_id → organizations`, plus users→departments/teams,
  teams→departments, audit_logs/notifications→users) and `trial_started_at`'s
  `now()` default. Declarations only — nothing pushed or migrated. 115/115 unit
  tests, typecheck and build clean; still 2 Vercel functions.
- 2026-09-23 — Item 3 done, on a **local** Supabase (owner decision: nothing
  paid, never production). `npm run test:isolation` creates two organisations
  with their own admin and member, then asserts as each signed-in user that the
  other organisation is invisible on all ten platform tables, that notifications
  are per-user, that inserts/updates into the other org are refused, that an
  admin can still rename their own org (v1.2.3) but cannot change `org_id`
  (v1.2.2), and that `publish_event`/`claim_events` are org-scoped. Everything
  runs in one transaction that always rolls back.
  Two supporting pieces: `supabase/local/platform-schema.sql` reproduces the live
  platform schema, helpers, trigger, RPCs and policies (the live schema predates
  this repo's migrations, so the three migration files cannot build a database
  from empty; local migrations and seed are disabled in `supabase/config.toml`),
  and `supabase/tests/platform_tenant_isolation.test.sql` holds the assertions in
  the same style as `ai_usage_quotas.test.sql`.
  Verified not vacuous: weakening `users_select` to `using (true)` makes it fail
  with "users leaked 1 row(s) of the other organisation" and exit 1.
  **Phase 1 is complete — v0.1.0.**
- 2026-09-23 — Items 4 and 5 done, code-only, nothing wired to a route yet.
  `src/lib/actions.ts`: `ActionResponse<T>` exactly as CLAUDE.md §6 defines it,
  with `ok`/`fail`, an `action(schema, handler)` wrapper that turns Zod issues
  into `fieldErrors`, and `ActionError` for messages the user should see —
  anything else thrown is logged and returned as one generic message, so a
  connection string or SQL never reaches a browser. Added `zod` (§6 requires it;
  it was missing). `src/lib/events/publish.ts` publishes through the
  `publish_event` security-definer RPC (the events table has no INSERT policy,
  so a direct insert is refused) and `drain.ts` claims/resolves through
  `claim_events`/`resolve_event`; the subscriber registry is deliberately empty
  and nothing calls the drain — the legacy cron still drains production, and two
  drains would double-handle the same rows. The Supabase client is injected:
  Phase 2 owns the per-request one. `allowImportingTsExtensions` added to
  tsconfig so the .mjs tests can import the .ts sources directly (Node 24 strips
  types), which is why these have real behaviour tests, not static checks.
  133/133 unit tests, typecheck, build and lint clean; still 2 Vercel functions.
- 2026-09-23 — Item 3 remains the only open item in this phase: it needs Docker
  Desktop running for the local Supabase, which the owner starts.
- 2026-09-23 — Item 2 prepared as legacy **v1.2.3** (#111), since it changes the
  live app: `organizations` had **no UPDATE policy at all** (an admin renaming the
  org or changing its logo was silently denied — verified, 0 rows matched), and
  `invitations` had one catch-all policy any member could write through, including
  an `admin`-role invitation. `users_update`'s WITH CHECK now also ties the row to
  the caller's org. Verified in a rolled-back transaction against production.
  Applied to production 2026-09-22 (SQL editor, no version row recorded — the
  file carries the applied time `20260922185720`), shipped and tagged `v1.2.3`,
  live site verified. **Item 2 done.**
- 2026-09-22 — Owner decisions taken (Decisions & Blockers, 2026-09-22): item 2
  reworded to "the right policy set per table"; the two cross-tenant findings go
  out as legacy v1.2.2 (#110); item 3 runs on a local Supabase (free). Items 4 and 5
  are code-only and don't depend on any of this.

---

## Phase 2 — Auth & Server Action Pipeline

**Goal:** Login, session, and the mutation path are fully on Server Actions
— no direct Supabase client mutation from the browser anywhere in new code.

- [x] Supabase SSR cookie auth wired in `(auth)/`
- [x] Zod schemas + Drizzle transactions for all Phase 1 mutations
- [x] Password-reset flow (`resetPasswordForEmail` + `PASSWORD_RECOVERY`
      handler) — carried over from old CLAUDE.md §8.1 as an open item
- [ ] Confirm `service_role` key is not reachable from any client bundle or
      public route

**Notes:**
- 2026-09-23 — Item 1 done, option A. `public/js/supabase.js` swaps supabase-js
  for `@supabase/ssr`'s `createBrowserClient`, so the legacy app writes the
  session to the cookie the new stack reads; `src/lib/supabase/server.ts` is the
  per-request client (anon key + the caller's token, never the service key);
  `proxy.ts` refreshes the token on every request. The five legacy pages also
  mirror `atllanta-theme` into a cookie and `app/layout.tsx` reads it, which
  closes the Phase 0 note about a Next page not seeing the legacy theme.
  `app/(auth)/session/` is a wiring check, not a finished screen — the real
  login/register/reset screens belong to the later `(auth)` work.
- 2026-09-23 — `@supabase/ssr` is pinned **exactly** at 0.12.7 in package.json
  to match the CDN pin in `public/js/supabase.js`: both stacks must write the
  cookie the same way, so these two versions move together or not at all.
- 2026-09-23 — Gotcha: the file is `proxy.ts`, not `middleware.ts`. Next 16.3.5
  deprecates the `middleware` convention and warns at build time; the export is
  `export default async function proxy(request)`.
- 2026-09-23 — Consequence to watch: the root layout reads a cookie, so every
  route is now server-rendered on demand (`ƒ`). `/` and `/_not-found` were
  static before. If a static page is wanted later, move the cookie read into a
  nested layout rather than the root.
- 2026-09-23 — `npm run typecheck` was `tsc --noEmit`, which fails on a fresh
  checkout with `TS2304: Cannot find name 'LayoutProps'` — tsconfig includes
  `.next/types`, which only a build generates. Now `next typegen && tsc
  --noEmit`, verified by deleting `.next/types` and running it cold.
- 2026-09-23 — Item 2 done as the mutation *path*, since Phase 1 left no
  mutations to wrap (see Decisions & Blockers). `src/db/transaction.ts` gives
  `withTransaction`, `src/lib/platform/schemas.ts` the Zod input schemas, and
  `src/lib/platform/actions.ts` two reference mutations —
  `renameOrganization` and `createDepartment` — that run
  validate -> transact (row + audit row) -> commit -> publish.
- 2026-09-23 — The mutations treat RLS as the authorisation boundary: an
  `orgId` from the client is never checked in TypeScript, the write is simply
  attempted and an empty `.returning()` is reported as "not found or no
  access", which deliberately does not say which.
- 2026-09-23 — `EventClient.rpc` now returns `PromiseLike`, not `Promise`.
  supabase-js returns a `PostgrestFilterBuilder`, which is thenable but has no
  `catch`/`finally`, so the old signature rejected the real client. The module
  only awaits the result, so nothing else changes.
- 2026-09-23 — **Known gap:** an event lost between commit and publish is not
  recovered by anything today. The drain worker claims from the events table,
  so an event that was never published is invisible to it; only the audit row
  records that the change happened. Worth a reconciler before a module depends
  on event delivery.
- 2026-09-24 — Item 3: the flow §8.1 asked for already existed in the legacy
  app (`login.html` + `js/auth.js` + `reset-password.html`), but item 1 broke
  it on this branch. `createBrowserClient` hard-sets `flowType: "pkce"` after
  spreading the caller's options, so it cannot be turned back to implicit. A
  PKCE reset link arrives as `?code=`, not `#type=recovery`, so `login.html`'s
  hash check never matched; `PASSWORD_RECOVERY` fires in a `setTimeout(0)`
  that races `getSession()`'s redirect to `/`; and the code verifier lives only
  in the requesting browser, so a link opened on another device failed.
  Production was never affected — it still runs the plain implicit client.
- 2026-09-24 — Item 3 done as server-side verification (owner's call, see
  Decisions & Blockers). `/auth/confirm` renders a button; the Server Action
  `verifyRecovery` (`src/lib/auth/`) calls `verifyOtp({ type: "recovery",
  token_hash })`, which writes the recovery session into the shared cookie, and
  the browser moves to the legacy `/reset-password` page to set the password.
  The GET is deliberately side-effect free: mail scanners (Outlook Safe Links)
  prefetch links and would burn a one-time token verified on load.
- 2026-09-24 — Gotcha: `action()` catches every throw, including the
  `NEXT_REDIRECT` that `redirect()` uses, so an action wrapped in it must
  return where to go and let the client navigate.
- 2026-09-24 — **Item 1 miss, fixed:** `public/login.html` still built its own
  supabase-js client, so a sign-in wrote localStorage while every other page
  read the cookie — `/login` and `/` would have bounced a signed-in user back
  and forth, and Google sign-in's PKCE verifier went to the wrong store. It now
  imports `/js/supabase.js`. `tests/shared-session.test.mjs` fails if any file
  in `public/` other than that one creates a Supabase client (checked: it names
  `login.html` with the fix reverted). Sign-in was never exercised end to end
  in a browser after item 1; do that before `v0.2.0`.
- 2026-09-24 — Now dead code, remove once items 1 and 3 have shipped:
  `login.html`'s recovery view and `#type=recovery` check, and the
  `PASSWORD_RECOVERY` redirect in `js/auth.js` — with the new email template
  no reset link reaches the browser client any more.
- 2026-09-24 — 147/147 unit tests, typecheck, build and lint (0 errors) clean.

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

### 2026-09-24 — Phase 2 item 3: reset link verified on the server (owner's call)

Item 1's cookie client forces PKCE, which broke the client-side reset link (see
Phase 2 notes). Two fixes were offered: patch `login.html` to wait for the
`?code=` exchange — no dashboard change, but a link still only works in the
browser that asked for it — or verify the token on the server. **The owner chose
server-side verification**, Supabase's documented SSR pattern: it works on any
device and has no race.

**Ship-together step (owner, Supabase dashboard):** when items 1 and 3 go to
production, and not before, set Authentication → Emails → *Reset Password* to
link to

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery
```

and confirm Site URL is `https://atllanta.vercel.app`. Changing it earlier breaks
reset in production, whose client still expects the old link; shipping the code
without it leaves reset broken, because the default template sends a PKCE link.

### 2026-09-23 — Phase 2 item 2: what "all Phase 1 mutations" means

Item 2 reads "Zod schemas + Drizzle transactions for all Phase 1 mutations",
but Phase 1 produced **no mutations** — it delivered the Server Action *pattern*
(`src/lib/actions.ts`) and the event publisher, and nothing in `src/` or `app/`
writes to the database. The item had an empty set to operate on.

**Owner decision: build the mutation path.** The helper, the schemas, and
reference mutations that prove validate -> transact -> audit -> commit ->
publish end to end. Module 0's full write surface (create/rename org, invite,
accept, departments, teams) waits for the screens that consume it, rather than
guessing shapes now.

**Owner decision: events publish after the transaction commits.** `publishEvent`
goes through the `publish_event` security-definer RPC — the events table has no
INSERT policy, and the RPC stamps `auth.uid()` — so it runs on a different
connection from Drizzle and a transaction cannot roll back an event it already
published. The order is validate -> transact (row + audit row) -> commit ->
publish. If the process dies between commit and publish, an event is **lost, not
invented**; the drain worker reconciles. The alternative — an INSERT policy so
Drizzle writes events inside the transaction — was rejected because it gives up
the RPC's actor stamping, which Phase 1's RLS design depends on.

### 2026-09-23 — Resolved: one session, in cookies (option A)

Both Phase 2 blockers are the same problem: the legacy app keeps per-user state
in **localStorage**, which a server-rendered page cannot read.

- **Session:** `public/js/supabase.js` uses the default supabase-js client, so
  the session lives in localStorage under `sb-*`. `@supabase/ssr` (Phase 2 item
  1) reads it from **cookies**. As things stand, signing in on a legacy screen
  leaves a Next.js route signed out, and the reverse.
- **Theme:** `atllanta-theme` in localStorage, applied by an inline script in
  `index.html`, `login.html`, `privacy.html` and friends. A Next page can only
  read it after hydration, so it would paint the wrong theme first.

Three ways out, owner's call before Phase 2 item 1 starts:

- **A. One session in cookies (recommended).** Give the legacy supabase-js
  client a custom storage adapter that writes the cookie `@supabase/ssr` reads,
  and mirror the theme into a `theme` cookie. Both stacks then share one sign-in
  and one theme, and a Next page renders correctly on the first paint. Cost: a
  small, deliberate change to frozen legacy files (`public/js/supabase.js`, the
  inline theme scripts), and everyone is signed out once at the cutover.
- **B. Bridge only.** Leave localStorage as the source of truth; have the legacy
  app copy the session and theme into cookies after sign-in and on refresh. Less
  invasive, but two copies of the truth that can drift, and a Next page still
  sees nothing until the legacy app has run at least once.
- **C. Separate sign-ins per stack.** No legacy change; users sign in twice
  during the transition. Cheapest to build, worst to live with.

Until this is answered, Phase 2 item 1 is blocked — everything after it inherits
whichever shape is chosen.

**Owner decision 2026-09-23: A — one session in cookies.** Both stacks share one
sign-in and one theme, and a Next page renders correctly on first paint.
Accepted costs: a deliberate change to frozen legacy files
(`public/js/supabase.js` and the inline theme scripts in five pages), and
everyone is signed out once when it ships, because the session moves from
localStorage to a cookie. That sign-out is why the cutover goes out **as a
legacy release** (`vX.Y.Z`) rather than silently — users notice being logged
out.

### 2026-09-22 — Owner decisions on Phase 1 items 2–3

1. **Item 2 reworded** to "the right policy set per table" — the audit table in
   the entry below is the target, not four policies everywhere.
2. **`org_id` is assigned by Atllanta.** No user can change it — owners and admins
   included — and the UI never shows it. **An invite must not touch an account
   that belongs to another organisation.** Both findings below ship as legacy
   release **v1.2.2** (PR #110): the users trigger rejects any `org_id` change by a
   signed-in caller, the invite refuses accounts already in an org (generic
   message), and the audit log strips `org_id` from its Details column. The
   trigger migration must be applied to production by the owner (the agent's
   permission check blocks production DDL); it was verified in a rolled-back
   transaction first.
3. **Nothing paid at this stage.** Item 3's isolation test runs on a **local
   Supabase** (Supabase CLI + Docker Desktop, both free), never on production and
   not on a paid branch.

### 2026-09-22 — Phase 1 items 2–3 vs the live database (owner's call)

Checked read-only before touching RLS. `auth_org_id()` already exists exactly as
CLAUDE.md §1 describes (security definer, `search_path` locked), and all 10
platform tables have RLS on. But the item's "standard 4-policy set on every
platform table" does not match what is live, and mostly for good reasons:

| Table | Live policies | Read |
|---|---|---|
| `departments`, `teams`, `feature_access` | full 4, admin-gated writes | matches |
| `audit_logs`, `events` | SELECT only | deliberate — append-only trail / publisher-written; adding UPDATE/DELETE would let users rewrite the audit trail |
| `organizations` | SELECT own org | deliberate — orgs are created server-side |
| `notifications` | SELECT/UPDATE own, INSERT in org, no DELETE | plausible |
| `files` | no UPDATE; DELETE own uploads | plausible |
| `invitations` | one ALL policy for any org member | nothing reads `invitations.role` today (invites write `users` directly), so low risk, but writes should be admin-only |
| `users` | no DELETE; see finding 1 | **fix needed** |

**Proposal:** reword item 2 to "the right policy set per table" (the table above is
the audit) instead of four policies everywhere.

**Two live cross-tenant findings** (legacy app, allowed under freeze decision 2 as
security fixes; not fixed — they change production RLS/code and need approval):

1. **Org admin can move themselves into another org.** `users_update` allows
   `id = auth.uid() OR is_org_admin()` and its WITH CHECK never constrains
   `org_id`; `users_guard_admin_fields` resets `org_id`/`role` for members but
   returns early for admins. So any tenant's owner/admin can set their own
   `org_id` to another tenant's id and keep their role there. Fix: WITH CHECK
   `org_id = auth_org_id()` (or the trigger freezes `org_id` for everyone but
   service_role).
2. **Invite pulls a user out of another org.** `server/legacy/create-org.js`
   `handleInvite` checks membership only in the inviter's org, then upserts
   `users` by id with the service key — overwriting `org_id` of an account that
   belongs to a different org (including that org's owner). Fix: refuse when the
   auth user already has a `users` row in another org.

**Item 3 (two-org isolation test)** needs a place to run: against production it
would create auth users and rows in the live database. Options: a Supabase branch
(paid), a local Supabase via the CLI, or tightly scoped fixture orgs in production
cleaned up after. Owner's call.

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
