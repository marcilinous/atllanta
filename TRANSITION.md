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

- **Version:** `v0.3.0` — **Phase 3 complete** (2026-09-29, owner): roles,
  custom roles, module enablement live end to end; item 4 carried forward
  to Phases 4 and 9 (see Phase 3 notes).
- **Active phase:** Phase 4 (HRMS Migration) — Phases 1–3 complete
- **Stack target:** see `CLAUDE.md`
- **Update 2026-09-30 (latest):** **v1.9.1 is live** (#137 → `386f431`,
  tagged). **v1.10.0 (attendance preview) is built** on
  `claude/phase-4-attendance`: `/hrms/attendance` (check in/out, last 30
  days, correction requests) and `/hrms/attendance/approvals` (decide
  corrections — approving applies the times to the day in the same
  transaction — plus who checked in today), both gates on every action,
  events `attendance.checkin.completed` / `attendance.regularization.created`
  / `…approved` in the processors' shapes. Legacy `#/attendance*` routes are
  untouched. Writes verified in a rolled-back production probe as a real
  member and their manager. Next: the owner checks it in the browser, then
  an attendance cutover like leave's.
- **Earlier 2026-09-30:** **v1.9.0 is live** (#136 → `b5cc252`,
  tagged): leave cut over to the new screens. Starting attendance, its rules
  were checked first and had the same holes leave had — **v1.9.1
  (attendance integrity)**: its migration is **applied** (2026-09-30), the
  code half (test, release files, tracker) is on `claude/release-1.9.1`.
  Next: the new-stack attendance screens.
- **Earlier 2026-09-30:** **v1.8.0 is live** (new-stack leave
  screens in preview; the `documents` storage bucket created, fixing every
  legacy upload). **v1.9.0 (leave cutover) is built** on
  `claude/leave-cutover`: `#/leave` and `#/leave/approvals` forward to the
  new screens. RTcompu now has an admin. Next in Phase 4 item 3: the rest
  of HRMS on the new stack (attendance, expenses, people, …), one area at a
  time, each on the same two-gate Server Action pattern.
- **Earlier (2026-09-29 night):** **v1.7.1 is live** (#133,
  `562a3a7`, tagged) with its migration applied: leave can no longer be
  self-approved, balances and holidays are owner/admin-only, and every
  deduction goes through one checked database function (Decisions &
  Blockers, leave integrity). Phase 4 items 1 and 2 are done; the leave port
  (item 3) resumes next. **RTcompu has no admin** — under the leave rule
  nobody can approve its owner's leave until one exists.
- **Earlier 2026-09-29:** **v1.7.0 is live** (#130, `3efe7a4`,
  tagged): the developer role, on top of v1.6.0 (module switches enforced)
  and v1.5.0 (Members screen). Owner tested the developer role in
  production. Google sign-in is switched on and working (verified in the
  auth log, 10:31 UTC). **Known issue:** password-reset emails do not send
  until a Resend domain is bought and verified (owner: on hold) — see
  Decisions & Blockers, 2026-09-29.
- **Update 2026-09-26:** **Phase 3 Steps 0, 1, 2 and 4 are live**
  as legacy **v1.3.2–v1.4.0** (production `705e23c`, PR #121): only owners
  grant or remove `owner`; the `roles` / `role_permissions` / `org_modules`
  tables exist with every module **off** and nothing enforcing them;
  `src/lib/auth/permissions.ts` resolves what a user may do (not yet called
  by any screen); and owners/admins can switch modules, manage custom roles
  and edit feature access from **Admin → Modules & roles** (the first real
  new-stack screens). Phase 2 is live as v1.3.0 + v1.3.1, tagged `v0.2.0`.
- **Update 2026-09-28:** **v1.4.2 is live** (PR #125, `2325f81`,
  deployment `dpl_5WaXxZ2R6V8gePSw79NUb5YzfQdc`, built from the production
  branch) — Phase 3 **Step 5 done**. v1.4.1 (audit log for owners, admins
  and developers only) is merged too (#124, `b9d6604`), and tags v1.4.0,
  v1.4.1 (re-pointed) and v1.4.2 each sit on their release merge. The
  dashboard-feed change missed #125's merge and follows as **v1.4.3** on
  `claude/release-1.4.3`.
- **Update 2026-09-29:** v1.4.3 is live (#126). Phase 3 **Step 3**
  (enforcement) is built and **held** on draft PR #127 until the
  organisations switch on their remaining modules (owner); its full notes
  live on that branch. The **Members screen** is built as **v1.5.0** on
  `claude/phase-3-members` (below, Decisions 2026-09-27 item 1); #127 is
  renumbered when it is rebased for go-live.
- **Update 2026-09-29 (later):** owner: RTcompu has switched on all 13
  modules, and the other four organisations losing their modules is
  accepted — **go ahead with Step 3**. Readiness verified live: RTcompu 13/13
  on; Hiretrack (2 users), Atllanta Pvt Ltd (1), Generic CRM Test Co (1),
  BlueHire (0) none. Step 3 is rebuilt as **v1.6.0** on
  `claude/release-1.6.0`, on top of Members (v1.5.0, PR #128) — the same
  four files as #127 (`features.js`, `index.html`, `views/crm/index.js`,
  `feature-gating.test.mjs`), unchanged, with new release files; #127 is
  superseded. Merge #128 first, then v1.6.0. Rollback after go-live:
  redeploy v1.5.0 (no database change).
- **Update 2026-09-29 (evening):** v1.5.0 (#128, `7f7ef36`) and v1.6.0
  (#129, `00e93b8`) are live and tagged, promoted from the production
  branch (`dpl_82GEyGRpoVMK2MgRTrGx6Esg4XsA`); the owner checked RTcompu's
  sidebar and CRM as an RTcompu user. The **developer role** is built as
  **v1.7.0** on `claude/phase-3-developer` (Decisions 2026-09-27 item 2);
  its migration is **applied** (2026-09-29, `20260929065828`); the code half
  ships with the v1.7.0 deployment.
- **Next:** Phase 4 item 1 (`hrms.ts`) is done on
  `claude/phase-4-hrms-schema`. Then item 2 (data migration — likely a
  confirmed no-op, owner's call) and item 3 (all HRMS mutations behind
  Server Actions + RLS, each calling `requirePermission()` — Phase 3 item 4
  carried forward). Start from a branch off the production branch.

**The legacy app keeps shipping until Phase 8.** It runs production on branch
`claude/gstack-skill-install-chnb41` at `atllanta.vercel.app`, is versioned
separately (`VERSION`, `CHANGELOG.md`, tags `vX.Y.Z` — **v1.8.0** live since
2026-09-30), and follows
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
| v0.2.0 | Phase 2 — Auth, RLS, Server Action pipeline | ✅ 2026-09-26 |
| v0.3.0 | Phase 3 — Roles, custom roles, module enablement | ✅ 2026-09-29 |
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
- [x] Confirm `service_role` key is not reachable from any client bundle or
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
- 2026-09-24 — Item 4, client half: **passes.** 0 hits for the key (by name,
  by the JWT role claim in all three base64 alignments, and `sb_secret_`)
  across 133 browser-fetchable files — `.next/static`, `public/`, prerendered
  output. `public/js/config.js` is committed and holds only the URL and anon
  key; nothing writes env into `public/`. `next.config.mjs` inlines nothing,
  no `NEXT_PUBLIC_*` var on Vercel carries a secret, and no response echoes
  the key. The exact-value comparison did not run: there is no local env file.
- 2026-09-24 — Item 4, route half: **fails**, so the item stays open. Of the
  legacy endpoints running as the service role, `/api/reports` and
  `/api/send-notification` acted across organisations and
  `/api/google-auth`'s OAuth callback could be driven cross-account. All three
  are fixed in legacy **v1.2.4** (PR #112): the first two removed (nothing
  called them), the third bound to the browser that started it. The
  `create-org` invite finding was already fixed in production by v1.2.2 —
  the audit read this branch, which does not have that fix (below).
- 2026-09-24 — **Correction to the item 2 notes above.** They say the
  mutations "treat RLS as the authorisation boundary". They do not: Drizzle
  connects with `DATABASE_URL`, the pooler logs in as `postgres`, and
  `postgres` has `rolbypassrls` and owns every table checked, none with
  `FORCE ROW LEVEL SECURITY` (verified with read-only queries). So RLS never
  applies to `renameOrganization`/`createDepartment`, and their code comments
  are wrong too. Not reachable today — nothing calls either action — but
  blocking for any screen built on them.
- 2026-09-24 — Gotcha: the legacy `docs/context/people.md` said of
  `/api/reports` "keep the org filter". It never had one. Treat a doc's
  description of a security property as a claim to check, not a fact.
- 2026-09-24 — Gotcha: Vercel keeps runtime logs ~1h on this plan and the
  30-day request query needs Observability Plus (402), so "is anything
  calling this endpoint?" cannot be answered from logs. Whether the removed
  endpoints were ever misused is unknown.
- 2026-09-24 — **Drizzle now runs under RLS** (blocker 2 below). The first
  statements of every `withTransaction` are a transaction-local
  `request.jwt.claims = {sub, role: "authenticated"}` and `set local role
  authenticated` (`src/db/as-caller.ts`); the caller is the server-verified
  session user and its id reaches Postgres only as a bound parameter.
  `withTransaction(caller, fn)` hands `fn` an `audit()` helper, the only way
  to write `audit_logs`: it steps out of the role for that one insert and
  stamps `userId` from the caller. Nothing is session-level — the pooler
  reuses connections. The same pattern already existed in
  `20260905134934_analytics_alerts.sql`.
- 2026-09-24 — Proven with a read-only, rolled-back probe on production:
  as `postgres` 5 organisations visible; after the switch, `current_user` is
  `authenticated`, `auth.uid()` is set and 1 is visible; `set local role
  none` restores 5. `departments` has no rows yet, so department scoping was
  not exercised — only organisations. 154/154 unit tests, typecheck, build,
  lint (0 errors) clean.
- 2026-09-25 — **Item 4 done.** v1.2.4 (PR #112) and v1.2.5 (PR #113) are
  merged and live: `atllanta.vercel.app/version.json` reports 1.2.5 and both
  removed endpoints answer 404. Production was merged into this branch as
  `95563c4` — the tree matched a dry run verified beforehand (no conflicts,
  194/194 unit tests, typecheck, build, lint clean), so this branch now
  carries v1.2.2–v1.2.5 and shipping it no longer undoes them.
- 2026-09-25 — Gotcha: merging to the production branch does **not** deploy
  to production here. Both merge deployments built `READY` with `target:
  null` and production stayed on v1.2.3 until the owner promoted the v1.2.5
  deployment by hand (v1.2.3 itself had been promoted, source `redeploy`).
  After a release merge, check `/version.json` before calling it live.
- 2026-09-25 — **Browser test** (production build via `next start` on
  localhost against the shared Supabase project, owner signing in by hand):
  sign-in lands on `/` and survives a reload — no `/login` bounce; the session
  is the `sb-<ref>-auth-token` cookie with localStorage empty; the Next page
  `/session` shows the same user; sign-out returns to `/login`, clears the
  cookie, and `/` then redirects to `/login`. Signed out: `/auth/confirm`
  refuses a missing token, shows only a button for a fake one (GET does
  nothing) and refuses it after Continue; `/reset-password` explains an
  expired link; `/login` loads only `/js/supabase.js` → `@supabase/ssr`.
- 2026-09-25 — One unreproduced read: straight after sign-out, `/session`
  once still showed the user in the browser. Re-fetched it showed signed
  out; the browser held no cookies; curl with no cookie always gets "Signed
  out" and the page is `Cache-Control: no-store`. Most likely the browser
  restoring its earlier copy — the server never served identity without a
  cookie. Watch for it in the ship-time check.
- 2026-09-25 — Legacy bug found, not caused by Phase 2 and live in
  production: `public/views/dashboard.js:174` selects
  `events` with `actor:actor_id(full_name, email)` and PostgREST answers 400
  on every dashboard load, so the recent-activity feed never shows. Fix in a
  legacy release. **Fixed in v1.2.6 (PR #114, live 2026-09-25):** the live
  schema confirmed `events` has one FK (`org_id`), none on `actor_id`, so
  the dashboard now names actors from the members it already loads and
  People → Letters (same bug) looks them up by id. No database change;
  adding the FK remains an option. This branch takes v1.2.6 with the next
  production merge.
- 2026-09-25 — Gotchas: `next dev` started in the background on this Windows
  box fails every app page with 500 (Turbopack's PostCSS worker exits
  `0xc0000142`); `next build && next start` works. And `next dev` appends a
  `nextjs-agent-rules` block to `CLAUDE.md` on every start — reverted, not
  committed; owner's call whether to keep it.
- 2026-09-26 — **Shipped.** PR #115 (v1.3.0, Phase 2) and #116 (v1.3.1,
  `/health` without counts) merged; the owner promoted deployment
  `dpl_2ubJo2eF1qNMwDAssmSc4bHpF8E5` (`d279bec`) and switched the Supabase
  Reset Password template to `/auth/confirm?token_hash=…&type=recovery`.
  Production smoke test: `/version.json` 1.3.1; `/session` "Supabase
  configured: Yes"; `/auth/confirm` refuses a missing token and shows only
  Continue for one; `/api/reports` 404; `/health` "Database: reachable", no
  counts; `/js/supabase.js` serves `@supabase/ssr@0.12.7`. Every user was
  signed out once, as planned. Rollback target: v1.2.6,
  `dpl_GX4Sow39YCfzzxgpVCRk4jgzyGvx` (`f6896c1`) — plus reverting the
  template.
- 2026-09-26 — `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  were missing on Vercel (the new stack would have failed `/auth/confirm`);
  added 2026-09-25 for production + preview, plain type so the build
  inlines them. Values are the public ones from `public/js/config.js`; the
  key was checked to be the `anon` role before writing.
- 2026-09-26 — Gotcha: a **stacked PR merges into its base branch, not
  production**. #118 (v1.3.3, based on `claude/release-1.3.2`) merged there,
  the deployment promoted to production was built from that branch
  (`6c14b63`), and the production branch was left at v1.3.2 — the next
  release would have rolled v1.3.3 back. Fixed by #119 (merge
  `claude/release-1.3.2` into production; tree verified identical to live).
  Rule: retarget a stacked PR to the production branch before merging it,
  and promote only deployments built from the production branch.
- 2026-09-26 — Gotcha: the connected Vercel integration cannot promote —
  `request_promote` returns 422 and `deploymentRollback` returns 403 — so
  promotion stays a manual dashboard step for the owner.
- 2026-09-24 — Known wart: if the audit insert itself fails, Postgres aborts
  the transaction and the role restore in `asOwner`'s `finally` fails too, so
  the *logged* error is "transaction aborted" rather than the insert error.
  The outcome is still a rollback and a generic message.

---

## Phase 3 — Roles, Custom Roles, Module Enablement ✅ Done (v0.3.0, 2026-09-29)

**Goal:** `org_modules`, `roles`, `role_permissions` live and enforced end
to end (CLAUDE.md §3.5).

- [x] `org_modules` table + admin toggle UI (all modules default `false`
      on org creation)
- [x] System roles seeded per org: `owner`, `admin`, `developer`, `manager`,
      `member`
- [x] Custom role creation UI (admin-only) writing to `roles` +
      `role_permissions`
- [ ] `src/lib/auth/permissions.ts` — resolves system role defaults, then
      custom-role overrides; used by every Server Action and by the AI
      Assistant path
- [x] `platform.module.enabled/disabled` and `platform.role.created/updated`
      events emitted and drained correctly

**Notes:**
- 2026-09-26 — Plan and owner decisions: see Decisions & Blockers,
  2026-09-26 (Phase 3 plan), and the plan document. Steps ship as their own
  legacy releases, each verified before the next.
- 2026-09-26 — **Step 0 (v1.3.2):** `users_guard_admin_fields()` now refuses
  a self role change, granting/removing `owner` unless the caller is an
  owner (update and insert), and demoting the last owner; `create-org` and
  `bulk-import` refuse the same through the service key. Migration
  `20260926055357`, verified in a rolled-back transaction on production
  (9 scenarios) before applying.
- 2026-09-26 — **Step 1 (v1.3.3):** migration `20260926063815` — `roles`
  (5 immutable system roles per org, 25 rows), `role_permissions` (custom
  roles only), `org_modules` (13 keys × 5 orgs = 65 rows, all off), guarded
  `users.custom_role_id`, `developer` added to `users_role_check`,
  `module_enabled()`. Verified in a rolled-back transaction (2 checks, 13
  scenarios) and applied on the owner's direct approval.
- 2026-09-26 — **Step 2 (v1.3.4):** `src/lib/auth/permissions-core.ts`
  (pure: `can`, `canSeeFeature`) and `permissions.ts` (server-only:
  `loadPermissionContext`, `requirePermission`). Defaults mirror the legacy
  app: every role view/create/edit, manager+ approve, admin/owner delete;
  a disabled module denies everything; a custom role's grants replace the
  base role's for the modules it lists. The item above stays unticked until
  Server Actions and the AI path actually call it.
- 2026-09-26 — (Answered 2026-09-27, see Decisions & Blockers.) Open for
  the owner: what `developer` may do (provisionally
  equal to `member` in `SYSTEM_ROLE_DEFAULTS`).
- 2026-09-26 — Known gaps, not yet fixed: marking an org's last owner
  `exited` is not refused; an admin cannot delete a custom role that is
  assigned to themselves (the guard reads the cascade as a self role
  change); the two new trigger functions keep the default RPC grant
  (harmless — Postgres refuses to run trigger functions directly); and the
  older security-advisor findings in Decisions & Blockers item 7.
- 2026-09-26 — **Step 4 built (v1.4.0, branch `claude/phase-3-step4-admin`,
  not yet merged).** Items 1 and 3 ticked on that basis, as Phase 0's
  were. The first real new-stack screens, under `app/(platform)/settings/`:
  **Modules** (13 switches), **Roles** (custom roles: create, edit, delete;
  built-in roles read-only, with their defaults and head counts) and
  **Feature access** (the deleted legacy `settings/access.js` editor,
  restored with the same keys, roles and precedence). An owner/admin-only
  "Modules & roles" tab on the legacy Settings page opens them. No
  migration: the Step 1 RLS policies already limit every write to
  `is_org_admin()` in the caller's org.
- 2026-09-26 — Gate: `src/lib/auth/admin.ts` (`getOrgAdmin` for pages,
  `requireOrgAdmin` for actions) — an active owner/admin. Deliberately not
  `requirePermission()`: every module starts off, and that check denies
  everything in a disabled module, so the screen that switches modules on
  could never be reached. The org is always the caller's own `users` row,
  never an input (a test fails if any action reads `input.orgId`). Writes go
  through `withTransaction` as the caller, then an audit row, then a
  publish after commit: `platform.module.enabled/disabled`,
  `platform.role.created/updated`, and `platform.role.deleted` (new; §3.5
  names no delete event). Nothing consumes them yet — that is Step 5.
- 2026-09-26 — Verified on production in a transaction that always rolls
  back (a `DO` block ending in `raise exception`), 18 scenarios with an
  admin and a member of one org and a second org: an admin toggles their
  org's module (1 row) but not another org's (0), creates a custom role and
  its grants, cannot create a system role or a role in another org
  (42501), cannot edit a system role (0 rows), a duplicate slug is 23505,
  the feature-rule upsert updates the same row, the audit insert with the
  rule's id works, delete cascades the grants; a member toggles 0 rows and
  is refused roles and feature rules (42501), reads their own 13 module rows
  and none of another org's. Checked afterwards: 0 probe roles, 0 enabled
  modules, still 14 feature rules. 282/282 unit tests (+26), typecheck,
  build and lint (0 errors) clean.
- 2026-09-26 — Found and fixed: the legacy service worker served **every**
  GET stale-while-revalidate, including Next.js pages and the RSC payloads
  `router.refresh()` fetches — so a settings page could redraw its old state
  after a change, and on a shared browser show the previous user's page.
  `public/sw.js` now leaves `/settings`, `/session`, `/auth`, `/health` and
  any `RSC` request to the network (tests in `service-worker.test.mjs`).
  Every future App Router route needs adding to `NETWORK_ONLY_PREFIXES`.
- 2026-09-26 — Owner's preview check: "modules not available". The logs
  showed no request ever reached `/settings/modules`: the entry point was
  a tab on `#/settings/org`, but the sidebar **Settings** button opens the
  *profile* page (`#/settings`), and the org page is only reachable from
  the Admin panel. Fixed by a first **Modules & roles** card on the Admin
  panel (`public/views/admin/index.js`, a path link, not a hash route); the
  org-page tab stays. Gotcha: legacy "Settings" means profile; admin
  configuration lives under the Admin (shield) button.
- 2026-09-26 — **Step 4 shipped.** The owner checked the preview signed in
  ("working fine"), merged PR #121 (`705e23c`) and promoted production
  deployment `dpl_FXUncPLwNjkNAA93fJfE36XcYm3z`, built from the production
  branch. Verified live: `/version.json` 1.4.0; `/settings/modules` signed
  out redirects to `/login`; the Admin panel script carries the Modules &
  roles link; `sw.js` is on cache `atllanta-1.4.0`. Rollback target: v1.3.4
  (`aaeb9b6`) — no database change, so a redeploy is the whole rollback.
  Tag `v1.4.0` on `705e23c` is the owner's to push. (Pushed, 2026-09-27.)
- 2026-09-28 — **v1.4.1 promoted from the wrong place.** Production serves
  1.4.1 from deployment `dpl_E1romiwLLH2y8hUbd9rGGjsP2H7i`, built from the
  PR branch `claude/release-1.4.1` (`54dabb3`), while PR #124 was still
  open — the production branch stayed at `9f991fb` (v1.4.0). And the
  `v1.4.1` tag was pushed on `ee57e9a`, an unrelated 2026-08 `main` commit:
  the tag command read `mergeCommit` of an unmerged PR (empty), so `git tag`
  tagged the local checkout's HEAD. Harmless for users today (the live code
  is the reviewed 1.4.1, and the database half was already live), but the
  next production-branch build would drop 1.4.1's code. Fix, owner: merge
  #124 (its tree equals `54dabb3`, since it was based on the production
  head), promote the build from the production branch, and re-point the tag.
  Gotcha, second time: **promote only deployments whose ref is the
  production branch**, and tag from `git rev-parse` of the merged branch,
  never from a PR's `mergeCommit` before checking it is merged.
- 2026-09-28 — **Step 5 built (v1.4.2, `claude/phase-3-step5-events`).**
  Item 5 ticked. Emitted: the Step 4 actions publish after commit, now via
  one shared list, `src/lib/events/platform-events.ts` (five names:
  `platform.module.enabled/disabled`, `platform.role.created/updated/
  deleted`). Drained: CLAUDE.md §4 defines no consumer, so the correct
  handling is "complete, do nothing" — which both legacy processors already
  do for any event without a recipe, and the new-stack drain does for any
  event without a subscriber. Evidence in production: the first two real
  events (`platform.module.enabled`, then `.disabled`, 2026-09-28 06:29 UTC)
  were completed on their first attempt. Tests (+19, 302/302): each name,
  through the cron (only its own `events` row touched), the browser
  processor (only `claim_events` + `resolve_event`) and `drainEvents`
  (completed, no subscriber registered); plus a static check that every
  action publishes only after its transaction closes. A future consumer
  belongs in `drain.ts`, not as a legacy recipe (those run as the service
  role).
- 2026-09-28 — The legacy dashboard's activity feed showed these events in
  its fallback wording ("*name* enabled module", "created role") to the whole
  org. **Owner decision: hidden.** `public/views/dashboard.js` now excludes
  `platform.%` in the events query itself, before `.limit(15)`, so a burst
  of settings changes cannot crowd real activity out of the feed. The events
  and their audit rows are unchanged.
- 2026-09-28 — **v1.4.2 shipped** (PR #125 → `2325f81`, deployment
  `dpl_5WaXxZ2R6V8gePSw79NUb5YzfQdc` from the production branch, tag on the
  merge). Verified: `/version.json` 1.4.2; tags v1.4.0 `705e23c`, v1.4.1
  `b9d6604` (re-pointed from `ee57e9a`), v1.4.2 `2325f81`. **But** #125 was
  merged at `52ca436`, before the feed commit (`96a66d1`) was pushed to it,
  so the live `dashboard.js` has no filter. It ships as **v1.4.3**
  (`claude/release-1.4.3`, the same change on a fresh branch off
  production). Gotcha: re-check a PR's head just before merging when a
  commit is pushed to it after review.
- 2026-09-28 — **v1.4.3 shipped** (PR #126, head `cf8d5e7` → merge
  `cf39b0b`, promoted from the production branch, tag on the merge). Live
  `dashboard.js` carries the `platform.%` filter. The owner reports org
  admins notified.
- 2026-09-28/29 — **Step 3 (enforcement), first built as v1.5.0 on draft
  PR #127, now v1.6.0 on `claude/release-1.6.0`.** `public/js/features.js`
  gains the `org_modules` gate: `loadOrgModules(orgId)` at bootstrap
  (index.html, before `loadFeatureAccess`), `MODULE_OF` (feature key →
  module key, a test holds it equal to `FEATURE_MODULE` in
  `permissions-core.ts`), checked in `isFeatureAllowed` beside the CRM and
  partner-pack flags and, like them, **not bypassed by owners/admins**. It
  is AND-ed with those flags, so a non-RTcompu org switching on "Partner
  CRM" still sees nothing of the pack. Non-module screens (dashboard,
  reports, admin, settings, audit) are never hidden, so an admin can always
  reach Modules & roles. A failed load — error *or* a thrown exception —
  leaves the gate off (pre-enforcement behaviour) and warns: a navigation
  gate on top of RLS, so failing open exposes nothing, failing closed would
  lock a whole org out (the thrown-exception case was caught by a test: it
  would have stopped the app loading). The CRM hub route `#/crm` was gated
  as generic CRM, so a partner-only org could not open it; it now opens if
  either CRM module is on (the sidebar button's rule), and the hub lists
  only cards the user can open.
  Held 2026-09-28 because no org had any module on; 2026-09-29 RTcompu had
  10, leaving crm/recruitment/ai off (its data: 1 lead + 1 opportunity from
  2026-09-16, 0 jobs, 0 AI calls in 30 days); later the same day the owner
  reported **all 13 on for RTcompu** and accepted that the four smaller
  orgs (nothing on) lose their modules — verified live, go-live approved.
  Readiness query for future changes: `select o.name, string_agg(m.module_key,
  ',' order by m.module_key) from organizations o left join org_modules m on
  m.org_id = o.id and m.is_enabled group by o.name;`.
  Not in this step: server-side module checks on the legacy `/api`
  endpoints and RLS-level module enforcement — per module at its cutover,
  as the plan says; the new stack's `requirePermission()` already denies a
  disabled module.
- 2026-09-26 — Found: `audit_logs.entity_id` is NOT NULL (live and in
  Drizzle), but the legacy access editor logged with `entity_id = null`,
  so its audit writes could never have succeeded. The new editor audits
  with the `feature_access` row's id.
- 2026-09-26 — Step 4 limits, for the owner: (a) there is **no screen to
  assign a custom role to a person** yet (`users.custom_role_id`), so a
  custom role has no effect until one exists — the natural home is the
  legacy Users screen or a new-stack Members screen; (b) because
  `role_permissions` stores grants only, a custom role can replace a
  module's permissions but cannot say "no access" to it; (c) not yet
  exercised in a signed-in browser — needs the owner signing in against a
  `next start` build or the preview, as for Phase 2; (d) Vercel's function
  count after this change is unconfirmed until a preview deploys (was 2).
  — (a) resolved by the Members screen (v1.5.0); (c) resolved by the
  owner's browser checks of v1.4.0–v1.7.0.
- 2026-09-29 — **v1.7.0 shipped** (#130 → `3efe7a4`, tagged). The owner
  tested the developer role in production: the four Admin cards, Modules &
  roles view-only, the Audit Log reachable.
- 2026-09-29 — **Phase 3 closed as v0.3.0** (owner). Items 1, 2, 3 and 5 are
  done and live. **Item 4 is carried forward, not done:** the resolver
  (`permissions.ts`) exists, is tested and already denies a disabled module,
  but "used by every Server Action and by the AI Assistant path" can only
  be met once module Server Actions exist — the settings actions are
  owner/admin capabilities (`requireOrgAdmin`), not module actions. It
  moves to Phase 4 (every HRMS action calls `requirePermission`) and Phase 9
  (the AI path calls the same function). See Decisions & Blockers,
  2026-09-29.

---

## Phase 4 — HRMS Migration

**Goal:** Directory, attendance, leave, assets, expenses, announcements
running on the new stack; old vanilla-JS HRMS views retired.

- [x] `src/db/schema/hrms.ts` per CLAUDE.md §3 Module 1 table list
- [x] Data migration script: old Supabase-direct HRMS tables → new schema
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
- 2026-09-29 — Carried in from Phase 3 item 4: **every HRMS Server Action
  calls `requirePermission(module, permission)`** (`src/lib/auth/
  permissions.ts`) with the right module key (`people`, `me`, `inbox`,
  `documents`, `finance`, `announcements`) — so both gates apply (org
  module on, role/custom-role grants) as CLAUDE.md §1 requires. Module
  enforcement is live in the legacy nav since v1.6.0.
- 2026-09-29 — The 2026-09-18 note's open question is **answered by
  CLAUDE.md** (Module 1): geofenced check-in (`work_locations`), the
  approvals inbox, lifecycle and letters, and the document store "carry
  over and are not to be dropped by omission", and `posts` is in its table
  list; helpdesk is its own module (Phase 8). So nothing is dropped. Checked
  live: lifecycle and letters have **no tables of their own** (built on
  `users` + `events`), and the document store is `files` — all in
  `platform.ts` already.
- 2026-09-29 — **Item 1 done** (branch `claude/phase-4-hrms-schema`).
  `src/db/schema/hrms.ts` declares the 14 live HRMS tables — attendance,
  attendance_regularizations, work_locations, work_schedules, holidays,
  leave_types, leave_balances, leave_requests, assets, asset_assignments,
  expense_categories, expenses, announcements, posts — read-only against
  the live database: every column/type/nullability/default, all 32 foreign
  keys with their ON DELETE rules, the 4 unique constraints and 7 CHECK
  constraints (status lists exported for later Zod schemas).
  `leave_balances.balance` is a generated column (opening_balance + accrued
  − used), declared as such so it is never written. Three live columns have
  no FK and are declared without one (`attendance_regularizations.
  reviewed_by`, `leave_requests.reviewed_by`, `posts.author_id`). Live names
  win over CLAUDE.md's sketch (e.g. `holidays.date`, `leave_types.
  annual_quota`, `assets.type`, `expenses.receipt_url`, `work_schedules`'
  shift columns). Nothing pushed or migrated. `src/db/schema/index.ts`
  aggregates the modules (§5). `tests/hrms-schema.test.mjs` holds the
  declarations equal to the live snapshot (checked non-vacuous: dropping
  one NOT NULL fails it). 344/344 unit tests, typecheck, lint, build.
- 2026-09-29 — Item 2 ("data migration script … verify no data loss") will
  most likely be a no-op to confirm, not a script: the new stack reads and
  writes the **same** tables, so no data moves. Worth confirming with the
  owner before closing it that way.
- 2026-09-29 — **Item 2 done: no migration needed** (owner agreed). The new
  stack uses the same 14 tables. Live row counts at closing: attendance 2,
  holidays 13, leave_types 2, every other HRMS table 0 (leave_requests 0,
  leave_balances 0) — 17 rows in all; nothing to move, nothing to lose.
- 2026-09-29 — **Leave port paused for a security fix (v1.7.1)**, found
  while mapping legacy leave: see Decisions & Blockers, 2026-09-29 (leave
  integrity). The port resumes on the fixed rules — its Server Actions rely
  on the same RLS and guard.
- 2026-09-30 — **Found: the `documents` storage bucket does not exist in
  production** (only `attendance-selfies` and `visit-selfies`). Every legacy
  upload targets it — leave documents, expense receipts, employee
  documents — so all three fail, and **RTcompu staff cannot apply for Sick
  leave at all** (its type requires a document; the upload error stops the
  form). Fix: migration `…_documents_bucket.sql` — a private bucket (10 MB),
  a `storage_path_uuid()` helper, and nine storage policies following the
  legacy paths: `leave-docs/{org}/{user}/` (own upload; read by self and by
  whoever sees their leave), `expenses/{org}/` (members upload; read by the
  uploader and approvers), `employees/{user}/` (owner/admin/manager manage
  people they can see; read by those people). Verified on production in an
  always-rolled-back transaction, 12 scenarios; production unchanged after.
  **Applied 2026-09-30** on the owner's approval (recorded
  `20260929184245`; file renamed to match) — the legacy uploads work from
  that moment, no deploy needed. Checked live: private bucket, 10 MB, 9
  policies; a member uploads their own leave document, is refused one as a
  colleague; their manager reads it; another org's admin reads nothing
  (rolled back).
- 2026-09-30 — **Leave on the new stack, built (v1.8.0,
  `claude/phase-4-leave-screens`; preview, not yet the default).**
  `/hrms/leave` (balances, request with document, my requests, cancel) and
  `/hrms/leave/approvals` (approve / reject with a comment).
  `src/lib/hrms/leave/`: `days.ts` (the legacy rule — weekdays only,
  holidays not excluded, half day 0.5 / range − 0.5 — on UTC calendar
  dates), `schemas.ts`, `queries.ts`, `actions.ts`. Every action calls the
  new `requireFeature("me", "me", …)` in `permissions.ts` — **both gates**
  (module on + role permission via `requirePermission`, and
  `feature_access` via `canSeeFeature`) — which is Phase 3 item 4 carried
  forward, now used by real module actions. The org, the person and the
  days come from the server; the legacy checks are enforced server-side
  (maximum consecutive days, balance minus pending when a balance exists,
  required document) plus one new one: **no overlap with your own pending
  or approved leave**. Writes run as the caller under RLS and the v1.7.1
  guard (the reviewer is stamped by the database, never sent); events keep
  the payload shapes the legacy processors read. Documents: up to 4 MB, PDF
  or image, uploaded as the caller to `leave-docs/{org}/{self}/` and
  removed if the request then fails; `next.config.mjs` raises the Server
  Action body limit to 4.5 MB (Vercel's request cap). The approvals list
  never offers a request the guard would refuse. `/hrms` added to the
  service worker's network-only prefixes. Client components drafted by the
  Groq worker and reviewed (two fixes). 367/367 unit tests, typecheck,
  lint, build.
  Not yet: switching the legacy nav to these screens (the cutover, owner's
  call after a browser check), leave settings/types/holidays/balance
  adjustments (still legacy), and viewing an attached document.
- 2026-09-30 — **v1.8.0 shipped** (#135 → `b2fcdfe`, tagged; production
  `dpl_7CDWPknghRGPTjx5EK4vjVix2vCe` from the production branch).
  Verified: `/version.json` 1.8.0; `/hrms/leave` signed out redirects to
  `/login`. RTcompu now has an admin (owner's report, checked live: 1 owner,
  1 admin, 13 managers, 48 members), so the owner's leave can be approved.
- 2026-09-30 — **Leave cutover built (v1.9.0, `claude/leave-cutover`),
  owner's call ("switch leave over").** The legacy `#/leave` and
  `#/leave/approvals` routes now forward to `/hrms/leave` and
  `/hrms/leave/approvals` (`window.location.replace`, so Back does not
  loop); every in-app link to `#/leave` follows. The legacy leave page's
  other tabs are **not** ported and stay legacy: team calendar
  (`#/leave/calendar`) and report (`#/leave/report`), linked from the new
  screens' tabs (Approvals and Report shown only to people who can
  approve), plus balances and settings under Admin. `views/leave/apply.js`
  and `approvals.js` are no longer loaded but stay in the repo until
  Phase 4 item 4 (retire legacy views once parity is confirmed). Other
  legacy places that approve leave (the approvals inbox) keep working under
  the v1.7.1 guard. 369/369 unit tests. Rollback: redeploy v1.8.0.

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
- 2026-09-29 — Carried in from Phase 3 item 4: the AI Assistant path must
  call the same `requirePermission()` as Server Actions (CLAUDE.md §3.5 —
  "the AI Assistant is not an exception"). The `developer` role exists and
  is assignable since v1.7.0, with `can_manage_developer_tools()` for its
  tools — Langfuse trace access should follow that capability pattern.

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

### 2026-09-30 — Attendance on the new stack (v1.10.0, preview)

Built beside the legacy screens, which stay the default until the owner
switches over. Choices made:
- "Today" is the org's time zone (`organizations.timezone`, default
  Asia/Kolkata), worked out on the server; the check-in time is the
  server's `now()`. The browser location is optional and passed through —
  the database geofence decides.
- Approving a correction updates the request **and** applies the corrected
  times (plus `total_hours`, and `present` when both times are known) in
  one transaction. Legacy does this as two separate writes that can
  half-fail.
- The request publishes `attendance.regularization.created`, the name both
  processors handle. The legacy dashboard publishes `…requested`, which
  nothing handles, so managers were never notified. That legacy bug is left
  as it is; the cutover retires it.
- The legacy "Team" tab is replaced by "Checked in today" on Approvals. The
  heatmap overview and the report stay legacy, linked from the tabs.
- Probe (production, rolled back, a real member and their reporting
  manager): check-in ok, second check-in 23505, check-out ok, correction ok,
  self-approval 42501, the manager's approve + apply in one transaction ok,
  reviewer stamped.

### 2026-09-30 — Attendance integrity (security, legacy v1.9.1)

Found when starting the attendance port (the "security check of its rules
first" the owner agreed after leave). Confirmed on production in a
rolled-back probe as a plain RTcompu member, who could: **mark a colleague
present** with any time (`att_insert` checked only the org; the geofence
trigger skips rows that are not the caller's); **rewrite their own check-in
time** ("late" → "present") with no regularisation (`att_update` let the
person update their own row freely); **submit a regularisation already
approved**, and **approve their own** (`attreg_insert` checked only the user,
`attreg_update` let the requester update); and **create a work schedule**
(`ws_*` checked only the org). The geofence is not in use for RTcompu today
(0 active work locations), but it also never checked a check-in set by a
later update.

Fix, migration `…_attendance_integrity.sql` — keeps every legitimate legacy
write working, so **no app code changes**:
- `att_insert`: your own row only; `attendance_guard()` (insert): check-in
  within 15 minutes of now, today, status `present`, no check-out.
- `attendance_guard()` (update): nothing moves between people or days; on
  your own row only the check-out changes, once, within 15 minutes of now;
  someone else's row (RLS limits it to admins, the reporting line and
  managers over the department) — an owner's/admin's needs an admin. This
  is what lets an approver correct the person's row after approving their
  regularisation, as `approvals.js` / `inbox.js` / `regularize.js` do.
- `attreg_insert`: your own, pending, on your own attendance row;
  `attendance_regularizations_guard()`: nothing about a request changes
  except its status; only from pending to approved/rejected; never your
  own; an owner's/admin's needs an admin (owner decision 2026-09-29, a);
  reviewer stamped by the database.
- `ws_insert` / `ws_update`: owners/admins only.
Service role (the server event processor marking lateness and on-leave
days) is exempt from both guards; the browser processor only reads
attendance. Verified: 16 scenarios on production with the migration applied
inside an always-rolled-back transaction, all as intended; production
unchanged after. **Applied 2026-09-30** on the owner's approval (recorded
`20260929191237`; file renamed to match). Checked live: `att_insert` as
written, both guard triggers present, both schedule policies owner/admin
only; replayed as a real member (rolled back) — check-in, check-out and a
regularisation work; marking a colleague, editing one's own check-in,
self-approval and creating a schedule are refused; the manager's approval
works.

### 2026-09-29 — Leave integrity (security, legacy v1.7.1)

Found while mapping legacy leave for the Phase 4 port; confirmed on
production in a rolled-back probe acting as a plain member of RTcompu. A
member could: approve their own leave request; insert a leave balance of 999
days for themselves; write a colleague's balance; add a company holiday;
insert a request already marked `approved`. Cause: `lr_update` let the
requester update their own row freely, `lr_insert` checked only the user,
and `lb_*` / `hol_*` checked only the organisation — no guard trigger. And
the **browser** event processor still trusted a `leave.request.approved`
payload (person, days, leave type) — the class v1.2.5 fixed for the server
processor only — so a forged event could deduct a colleague's balance.
Production had 0 leave requests and 0 balances, so no sign of use.

**Owner decision (option a):** nobody approves their own leave; an owner's
or admin's leave is approved by an admin or another owner.

Fix, migration `…_leave_integrity.sql`: a new request must be your own and
pending; a `leave_requests_guard()` trigger lets the requester only cancel
their own pending request and an approver (admin, reporting line, or a
manager over the department — as before, minus self) only approve/reject
someone else's pending one, stamping `reviewed_by`/`reviewed_at` itself;
`leave_balances` and `holidays` writes need `hr_can_configure()`; one
security-definer `apply_approved_leave_usage(request, event)` does every
deduction for both processors from the real row, once per request (advisory
lock + per-request key + the pre-v1.2.5 key), and `apply_leave_usage` is
withdrawn from signed-in users; `init_leave_balances(user)` sets a new
employee's defaults (the browser processor runs as any member). Code: both
processors call the new function; the approval notification moved after
the deduction. Verified: 22 scenarios on production with the migration
applied inside an always-rolled-back transaction (member, manager, admin,
owner), all as intended; afterwards production unchanged. 348/348 tests.

**Consequence for RTcompu:** it has **no admin** today (1 owner, 1
developer — `tsap.mis@rtcompu.com`, changed from admin by the owner while
testing v1.7.0 — 13 managers, 48 members). Under (a) nobody can approve the
owner's own leave until an admin exists or a second owner is added. Owner
informed.

Known, not fixed here (pre-existing, low): the browser processor's
"leave approved/rejected" notifications still take the person and approver
names from the payload, so a forged event can send a misleading
notification (no balance or approval effect).

**Shipped 2026-09-29.** PR #133 merged (`562a3a7`), tagged `v1.7.1`. The
first production-branch build failed — not the code: Turbopack's
`next/font/google` handling of Inter errored (`Can't resolve
'@vercel/turbopack-next/internal/font/google/font'`, "next/font/google
queries have exactly one entry") after "Restored build cache from previous
deployment"; #132's build with the same `app/layout.tsx` had passed and the
code built clean locally. The owner redeployed **without the build cache**
and it built (`dpl_HcsEsDjMst6UeQeKNJ7xgtCXrWsh`), then promoted it;
`/version.json` read 1.7.1 and the live event processor called
`apply_approved_leave_usage` before the migration was applied — the agreed
order (code first; the reverse would have let the old code skip deductions
silently). **Migration applied** on the owner's approval, recorded
`20260929161953` (file renamed to match). Checked live: `lr_insert` as
written, the guard trigger present, 5 owner/admin-only write policies on
balances and holidays, `apply_leave_usage` no longer executable by signed-in
users, the new function executable by them but not by `anon`; replaying the
original attack as a real member (rolled back) — self-approve, a 999-day
balance, a holiday and a pre-approved request all refused, the request itself
and the manager's approval still work.
Gotcha: a Vercel build that fails inside `next/font` right after restoring
the build cache is worth one uncached redeploy before touching code; if it
recurs, move Inter to `next/font/local`.

### 2026-09-29 — Phase 3 closed; password-reset email on hold; Google sign-in on

1. **Phase 3 closed as v0.3.0 with item 4 carried forward** (owner). See the
   Phase 3 notes; the item moves to Phase 4 (HRMS Server Actions) and
   Phase 9 (AI path). Not ticked — it is not done.
2. **Password-reset email is broken in production, on hold** (owner:
   waiting for a domain purchase). Two separate faults, found in Supabase's
   auth log:
   - The Reset Password template had broken HTML (`"<" in attribute name`),
     so `/recover` answered 500 before sending. **Fixed by the owner** in the
     Supabase dashboard with a clean template linking to
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
   - Supabase Auth sends through **Resend** (custom SMTP) with a
     **@gmail.com sender**, which Resend rejects (`550 The gmail.com domain
     is not verified`) — `/recover` still answers 500 and no email goes out.
     **Blocked** until a domain is bought and verified in Resend; then set
     the SMTP sender to an address on it (e.g. the one `RESEND_FROM` uses
     for app notifications — default `notifications@atllanta.app`).
   Until then **users cannot reset a forgotten password** themselves.
   Gotcha: `/recover` answers **200 and sends nothing** for an email with no
   account (Supabase's anti-enumeration), so "it said sent" is not proof.
3. **Google sign-in switched on** (owner). The first attempt failed with
   `invalid_client` (wrong client secret); after the fix the auth log shows
   a successful Google login (2026-09-29 10:31 UTC). Google sign-in is the
   working way back in for anyone locked out while reset email is down.

### 2026-09-27 — Owner decisions after v1.4.0 (Phase 3)

1. **Assigning a custom role lives on a new-stack Members screen**, not on
   the legacy Users screen — organisation membership and permissions stay
   separate from user accounts and authentication. It writes
   `users.custom_role_id` through a Server Action like the Step 4 ones;
   `users_guard_admin_fields()` already refuses a self-assignment and a role
   from another org. Until it ships, custom roles have no effect.
   **Built 2026-09-29 as v1.5.0** (`claude/phase-3-members`):
   `/settings/members` lists active members with their built-in role and a
   custom-role picker; `setMemberCustomRole` (Server Action) takes the org
   from the caller, refuses a self change with a clear message, lets **only
   an owner change an owner's custom role** (a custom role can narrow what
   an owner may do; the database guard covers the owner role itself, not
   `custom_role_id` — enforced in the action, and mirrored in the UI),
   checks the role is one of this org's custom roles, writes under RLS as
   the caller and audits (`custom_role_assigned` / `custom_role_removed`).
   No event (§3.5 names none). Verified on production in an
   always-rolled-back transaction: admin assigns (stored) and clears; self,
   another org's role and a system role are refused by the database
   (42501); a member's update takes no effect. Afterwards 0 probe roles and
   0 users with a custom role. 305/305 unit tests.
2. **The `developer` role** (resolves the Phase 3 open item of 2026-09-26):
   - **Read/write:** developer tools — API keys, webhooks, error and audit
     logs, integrations.
   - **Read-only:** organisation configuration (including, by that reading,
     the Step 4 settings screens — to be confirmed when built).
   - **No access:** billing/financial settings, and deleting members.
   Consequences to carry into the work: these are *capabilities*, not the
   per-module view/create/edit grants in `SYSTEM_ROLE_DEFAULTS`, so they
   need a capability check beside `requirePermission()` (and beside
   `requireOrgAdmin()` for read-only settings). Several need RLS changes
   first (checked live 2026-09-27): every `api_keys`, `webhook_endpoints`
   and `webhook_deliveries` policy requires `is_org_admin()`, and the
   developer role is in no RLS helper. `audit_logs` is the exception — its
   one policy lets **every** org member read it already, which is wider
   than this decision implies and worth a look of its own.
   **Built 2026-09-29 as v1.7.0** (`claude/phase-3-developer`):
   - *Assignable:* Developer in the Users screen (filter, role change,
     invite), `create-org` invite and `bulk-import` allowed roles, and the
     CSV import. No one had the role before because nothing offered it.
   - *Developer tools:* migration `20260929065828` adds
     `can_manage_developer_tools()` (owner/admin/developer, not exited,
     not callable by `anon`) and recreates all nine `api_keys` /
     `webhook_endpoints` / `webhook_deliveries` policies on it, otherwise
     unchanged (org scoping, `created_by`/`acting_user_id` stamping,
     deliveries read-only). No application code used these tables yet.
     Verified on production in an always-rolled-back transaction with the
     migration applied inside it: an admin makes someone a developer; the
     developer creates, reads, updates and deletes a key and a webhook and
     reads deliveries; another org, a key acting as someone else, a member,
     and an exited developer are refused or see nothing; admin still works.
     Afterwards: no helper, policies as before, 0 keys, the borrowed user
     unchanged. **Applied to production 2026-09-29** on the owner's direct
     approval (recorded `20260929065828`; file renamed to match). Checked
     live: 9 policies, all on the helper, none on `is_org_admin`; `anon`
     cannot execute it, `authenticated` can; an admin passes it, a member
     does not. Rollback: recreate the nine policies with `is_org_admin()`.
   - *Where they go:* the Admin button now shows for developers; the Admin
     panel shows them only Modules & roles, Organization Settings,
     Integrations and a new Audit Log card; Reports' Audit Log card and the
     audit screen admit them. `isAdmin` (feature-access bypass, every other
     admin check) is unchanged.
   - *Read-only settings:* `getOrgAdmin()` admits a developer with
     `canEdit: false`; `requireOrgAdmin()` (every settings action) still
     requires owner/admin. Every settings screen disables its controls and
     shows "View only" for them; the new-role page shows only the notice.
   - *No billing/financial, no member deletion:* both stay owner/admin —
     a developer is a member everywhere else. Organisation settings (legacy
     `#/settings/org`) was already view-only for non-admins.
   325/325 unit tests.
3. **Audit log: owners, admins and developers only** (owner, 2026-09-27).
   Legacy **v1.4.1**, branch `claude/release-1.4.1`: migration
   `20260927152738` adds `can_read_audit_log()` (security definer, pinned
   search path, not callable by `anon`; refuses exited users) and narrows
   `audit_select` to it. Managers are excluded too, reading "regular
   members" as everyone outside those three roles. The legacy audit screen
   now admits developers (and drops a dead `super_admin` check). Nothing a
   user sees is lost: the only screen reading `audit_logs` was already
   admin-only; what closes is direct API and analytics-SQL reading by 61
   managers and members. Verified on production in an always-rolled-back
   transaction, with the migration applied inside it: before, a member read
   13 rows; after, owner/admin/developer 13 of their own org and 0 of
   another, member 0, manager 0, exited admin 0, `anon` refused the helper;
   afterwards the old policy, no helper, and both borrowed users unchanged.
   The local isolation test gains a member-cannot-read check. 288/288 unit
   tests. **Applied to production 2026-09-27** on the owner's direct
   approval (recorded version `20260927152738`; the file was renamed to
   match). Checked live afterwards: one `audit_logs` policy, calling the
   helper; `anon` cannot execute it, `authenticated` can; reading as real
   users — owner 13, admin 13, manager 0, member 0. Rollback: recreate
   `audit_select` as `org_id in (select auth_user_org_ids())`. The code half
   (developers on the audit screen) ships with the v1.4.1 deployment. Module-level defaults for business modules
   stay equal to `member` until the owner says otherwise.

### 2026-09-26 — Phase 3 plan and owner decisions

Plan: `docs/superpowers/plans/2026-09-26-phase-3-roles-modules.md`, grounded
in the live schema (no `org_modules`/`roles`/`role_permissions`, module
gating UI-only, roles hard-coded in ~50 views and every RLS helper). Owner
decisions:

1. **Existing orgs start with every module off** — the recommended faithful
   backfill was declined. So the admin toggle screen must be live and org
   admins told before the gate is enforced; enforcement is its own
   owner-triggered go-live. Order: 0 → 1 → 2 → 4 → 5 → 3.
2. **Base system role + custom role**: a custom-role user keeps a system role
   in `users.role` (what the legacy app and RLS read) and `custom_role_id`
   adds module permissions on the new stack. Deviates from §3.5's "never
   both" until the legacy app is gone (Phase 8).
3. **Admin screens on the new stack** (`app/(platform)/settings/`).
4. **Module keys split finer** (owner, 2026-09-26): the legacy feature keys
   `people`, `me`, `inbox`, `documents`, `finance`, `announcements`,
   `recruitment`, `crm`, `crm_partner`, `analytics`, `helpdesk`, `projects`,
   `ai`; `dashboard` and `reports` always-on.
5. **Step 0 ships now**: guard role changes (only an owner grants or removes
   `owner`, nobody changes their own role, an org always keeps an owner).
   **Done:** migration `20260926055357_users_role_change_guard` applied
   2026-09-26 after a rolled-back verification on production (9/9
   scenarios); server checks + UI in v1.3.2, PR #117. Open follow-up:
   marking an org's last owner `exited` is not yet refused.
6. **Step 1 done** (2026-09-26): migration `20260926063815_roles_and_org_modules`
   applied on the owner's direct approval after a rolled-back verification
   on production — `roles` (5 immutable system roles per org),
   `role_permissions` (custom roles only), `org_modules` (13 keys × 5 orgs,
   all off, not enforced), guarded `users.custom_role_id`, `developer` in
   `users_role_check`, `module_enabled()`. Code in v1.3.3, PR #118 (stacked
   on #117). Next: Step 2, `src/lib/auth/permissions.ts`.
7. **Security advisor follow-ups** (pre-existing, found 2026-09-26): 27
   `SECURITY DEFINER` functions executable by `anon`, CRM materialized views
   readable over the API, two functions with a mutable `search_path`, and
   leaked-password protection off in Supabase Auth. Plus: revoke the default
   RPC grant on the new trigger functions (harmless — Postgres refuses to run
   trigger functions directly).

### 2026-09-24 — Phase 2 item 4: what blocks `v0.2.0` (owner's call)

The `service_role` audit (Phase 2 notes, 2026-09-24) passed on the client and
failed on the routes. The owner chose to hotfix production first: **legacy
v1.2.4, PR #112**, open against `claude/gstack-skill-install-chnb41`. After it
merges: tag `v1.2.4`, and if Google Calendar connect is in use set
`GOOGLE_OAUTH_REDIRECT_URI` to `https://atllanta.vercel.app/api/google-auth?action=callback`
in Vercel and on the Google OAuth client (unset today; the fallback is the
per-deployment `VERCEL_URL`).

Three blockers remain before this phase can ship:

1. **This branch is missing production's security fixes.** v1.2.2 and v1.2.3
   (6 commits) were made on release branches off production and never came
   back here; v1.2.4 will be a seventh. Shipping this branch as-is would undo
   them. Production has to be merged into `claude/phase-2-auth` — owner's
   call, since it is a merge. **Done 2026-09-25 by the owner** (`95563c4`).
2. **Drizzle must run under RLS.** Each `withTransaction` needs to act as the
   caller — `set local role authenticated` plus the caller's claims in
   `request.jwt.claims`, inside the transaction — or the actions must check
   membership themselves. Recommendation: the first, so RLS stays the single
   boundary the Phase 1 policies were written for. Needs a design pass.
   **Done 2026-09-24, the first way** — see Phase 2 notes.
3. **Two audit findings not yet fixed**: the event-processor recipes trust
   ids inside an event's payload rather than checking they belong to the
   event's org, and three legacy handlers (`bulk-import`, `create-org`,
   `google-auth`) skip the `status = 'exited'` check that `resolveCaller` does. Neither is exploitable without a valid session
   in some org; both belong in a follow-up legacy release.
   **Done in v1.2.5, live 2026-09-25.** Correction: the event-processor
   finding was understated above. `publish_event` lets any member publish
   any event, and the processor runs as the service role, so a member could
   write to another org's attendance and leave balances, or apply a leave
   approval no manager made. Recipes now reload every row scoped to the
   event's org and act only on what it says; leave usage dedupes per request.

Item 4 is ticked when blockers 1 and 2 are done and PR #112 is merged; item 3
of this list can follow in its own release. **All three resolved; item 4
ticked 2026-09-25.** Open follow-ups: in-org `leave_balances` policies (the
browser processor runs under a member's own RLS), and department RLS
scoping, unexercised because `departments` has no rows yet.

### 2026-09-24 — Phase 2 item 3: reset link verified on the server (owner's call)

Item 1's cookie client forces PKCE, which broke the client-side reset link (see
Phase 2 notes). Two fixes were offered: patch `login.html` to wait for the
`?code=` exchange — no dashboard change, but a link still only works in the
browser that asked for it — or verify the token on the server. **The owner chose
server-side verification**, Supabase's documented SSR pattern: it works on any
device and has no race.

**Done 2026-09-26** — template switched at the v1.3.0/v1.3.1 go-live.

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
