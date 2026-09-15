# CLAUDE.md — Atllanta Foundation & Requirements

> **What this file is:** The single source of truth for what Atllanta is, how it
> is structured, and what it must do. Read it completely before writing any code.
> Every architectural decision, tenancy rule, module boundary, naming convention,
> and requirement is here. When in doubt, this file wins.
>
> **Status:** This document describes the **canonical target**. Part of the code
> still runs on an older agency/`client_id` model and is being migrated onto this
> base (see §13, Alignment Status). Where code and this file disagree, this file
> is the direction; the code is the debt.

---

## 1. What Is Atllanta

Atllanta is a **single-tenant-per-company Business Operating System** — one product
that connects people, customers, work, and operations under one identity, one
permission model, one design system, and one AI assistant.

**One company = one `organization`.** Every user belongs to exactly one org and
holds exactly one role. Every business-data table carries `org_id` and is isolated
by a single Postgres row-level-security pattern.

Atllanta is composed of **four business modules** on **one shared Platform layer**:

1. **HRMS / People** — employee lifecycle: directory, attendance, leave, assets,
   expenses, helpdesk, announcements, documents.
2. **Recruitment & Interview Automation** — CV↔JD matching (Groq), candidate
   pipeline, and automated interview scheduling (Google Meet).
3. **CRM** — customers, contacts, leads, and a configurable sales pipeline.
4. **Analytics** — cross-module dashboards and reporting.

**One-line pitch:** Companies come for the AI hiring tool, stay for the operating
system that runs the rest of the company.

**Build history to know:** Atllanta began as an agency recruitment SaaS
(`organizations → clients → jobs`) and later grew an HR/People layer scoped by
`org_id`. That left two tenancy models fused together. The canonical model below
(single `org_id`, no agency tier) is the resolution. Do not add new code on the
old `client_id`/`memberships` model.

---

## 2. Stack

| Layer | Tool | Non-negotiable |
|-------|------|----------------|
| Database | **Supabase (PostgreSQL 15+)** | ✅ |
| Auth | **Supabase Auth** | ✅ |
| Storage | **Supabase Storage** | ✅ |
| Hosting | **Vercel** | ✅ |
| Frontend | **Vanilla JS + HTML + CSS** (no framework) | ✅ |
| AI / LLM | **Groq (LLaMA)** — already integrated | ✅ |
| Email | **Resend** | ✅ |
| Vector search | pgvector (Supabase) | Later |
| WhatsApp / Maps | BSP / Google Maps | Later |

**Hard rules:**
- Zero monthly cost during build/pilot — free tiers only.
- No React, Next.js, TypeScript, or Tailwind unless the owner explicitly asks.
- No npm packages for what vanilla JS covers.
- Supabase client (`@supabase/supabase-js`) via CDN, not npm.
- **`anon` key + RLS only. Never `service_role` in frontend or AI paths.** If the
  user can't see it in the UI, the AI can't see it either.

---

## 3. Architecture — Modular Monolith

One Supabase project. One Vercel deployment. Modules are separated by folder and
schema boundaries, not services or repos.

```
Atllanta (single deployment)
│
├── Platform Layer (shared — every module uses these, no business logic)
│     ├── Identity (auth, org, roles, permissions)
│     ├── Tenancy + RLS (single org_id isolation)
│     ├── Event bus (events table + processor)
│     ├── Notifications (in-app, email via Resend)
│     ├── Audit (append-only action log)
│     ├── Files (Supabase Storage)
│     ├── Global search
│     └── AI Assistant (Groq, permission-aware)
│
├── Application Layer (four modules — each OWNS its data)
│     ├── HRMS / People
│     ├── Recruitment & Interview Automation
│     ├── CRM
│     └── Analytics (owns no business tables — reads via APIs/views)
│
└── Infrastructure: Supabase (Postgres + Auth + Storage + Edge Functions), Vercel
```

### Core rules (enforced, not aspirational)
1. **Modules own their data.** A module never reads another module's tables
   directly — it calls that module's API or reacts to its events.
2. **No shared business logic.** Only shared *platform* services (auth, files,
   notifications, audit, events, search, AI).
3. **Every mutation publishes an event.** Format `module.entity.action`, e.g.
   `people.employee.created`, `recruitment.candidate.shortlisted`,
   `crm.deal.won`, `leave.request.approved`.
4. **All data access goes through RLS.** No `service_role` key in frontend code.
5. **Every endpoint checks permission** through the same layer as the UI. The AI
   assistant is not an exception.

---

## 4. Multi-Tenancy (the base)

**Model:** shared database, one org per company, row-level security per org.

Every business table has `org_id uuid not null references organizations(id)`.
A single security-definer helper resolves the caller's org, and every table gets
the same four policies:

```sql
-- One helper, used by every policy
create or replace function auth_org_id() returns uuid
  language sql security definer stable
  as $$ select org_id from users where id = auth.uid() $$;

-- Standard policy set on EVERY org-scoped table
alter table <t> enable row level security;
create policy "org_select" on <t> for select using (org_id = auth_org_id());
create policy "org_insert" on <t> for insert with check (org_id = auth_org_id());
create policy "org_update" on <t> for update using (org_id = auth_org_id());
create policy "org_delete" on <t> for delete using (org_id = auth_org_id());
```

**Canonical tenant key is `org_id`.** Not `organization_id`, not `client_id`.
The agency tier (`clients`, `memberships`, `auth_accessible_client_ids()`,
`org_type`) is being removed — see §13.

**Critical test (must pass at all times):** create two orgs, insert data in both,
and verify user A cannot read user B's data under *any* query path, on every table,
under the `anon` key.

---

## 5. Roles & Permissions

Four fixed roles on `users.role`:

| Role | Scope |
|------|-------|
| `owner` | Full control of the org, billing, deletion. |
| `admin` | Manage users, settings, all module data. |
| `manager` | Approve/act within their team/department. |
| `member` | Self-service: own attendance, leave, profile, assigned work. |

No custom-permission UI. Role checks live in one place (`js/auth.js` + RLS), and
the UI hides what a role cannot do (`data-role` on nav in `app.html`).

---

## 6. Canonical Data Model

`org_id` on every business table. Names below are the target; where the live
schema still differs (recruitment tables on `client_id`), §13 tracks the gap.

### 6.1 Platform & Identity
```
organizations(id, name, slug, logo_url, timezone, currency, plan_tier,
              payment_status, created_at, updated_at)
users(id → auth.users, org_id, full_name, email, phone, avatar_url,
      role owner|admin|manager|member, designation, department_id, team_id,
      reporting_manager_id, status, date_of_joining)
departments(id, org_id, name, head_id)
teams(id, org_id, department_id, name, lead_id)
invitations(id, org_id, email, role, token, status, expires_at)
audit_logs(id, org_id, user_id, module, entity_type, entity_id, action,
           old_values jsonb, new_values jsonb, created_at)   -- append only
events(id, org_id, event_type, actor_id, payload jsonb, status, attempts,
       created_at, processed_at)
notifications(id, org_id, user_id, title, body, module, entity_type, entity_id,
              channel, status, sent_at)
files(id, org_id, uploaded_by, file_name, file_path, file_size, mime_type,
      entity_type, entity_id, created_at)
```

### 6.2 HRMS / People
```
attendance, attendance_regularizations, work_schedules, holidays,
leave_types, leave_balances, leave_requests,
assets, asset_assignments, expenses, expense_categories,
helpdesk_categories, helpdesk_category_handlers, helpdesk_tickets,
announcements, posts
```

### 6.3 Recruitment & Interview Automation
```
jobs, candidates, applications (match_score, match_summary, stage),
interviews, interview_slots
```
(These tables exist; they migrate `client_id → org_id` in Phase 1.)

### 6.4 CRM (to build)
```
crm_accounts(id, org_id, name, industry, website, owner_id, created_at)
crm_contacts(id, org_id, account_id, full_name, email, phone, title)
crm_leads(id, org_id, full_name, company, email, phone, source, status, owner_id)
crm_pipelines(id, org_id, name, stages jsonb)     -- configurable stages
crm_deals(id, org_id, account_id, pipeline_id, title, value, currency, stage,
          owner_id, expected_close, status open|won|lost, created_at)
crm_activities(id, org_id, entity_type, entity_id, type note|call|task|email,
               body, due_at, done, actor_id, created_at)
```

### 6.5 Analytics
Owns no business tables. Reads through each module's API or dedicated SQL views
(`analytics_*` views / materialized views), never by selecting another module's
tables directly.

### 6.6 Indexes & FTS
Every `org_id` gets an index. Keep the existing FTS columns on `users`,
`candidates`, `jobs` (generated `tsvector` + GIN). Add module-local indexes on
hot filter columns (status, dates, owner).

---

## 7. Module Boundaries & Event Contracts

Cross-module needs are met by **events** or a **module API**, never a foreign
table read.

| Event | → Reactions |
|-------|-------------|
| `people.employee.created` | Create leave balances for the year → notify manager + HR |
| `leave.request.created` | Notify manager; if > 3 days also HR |
| `leave.request.approved` | Update balance + attendance → notify employee |
| `recruitment.candidate.shortlisted` | Notify hiring manager → create interview task |
| `attendance.checkin.completed` | If late, mark late → notify manager on 3rd late/month |
| `crm.lead.converted` | Create account + deal → notify owner |
| `crm.deal.won` | Notify owner + manager → (optional) analytics refresh |

The processor is `js/event-processor.js` (client trigger) / `api/event-processor.js`
(serverless drain). Publish with `js/events.js` `publishEvent(type, payload)`.

---

## 8. Requirements

### 8.1 Non-functional (platform — apply to every module)
- **Tenant isolation:** the two-org test (§4) passes on every table, always.
- **Auth:** email/password + Google OAuth (both wired in `login.html`). **Add the
  missing password-reset flow** — `resetPasswordForEmail` on `login.html` and a
  `PASSWORD_RECOVERY` handler in `js/auth.js` (currently only `SIGNED_OUT` is
  handled at `js/auth.js:55`).
- **Security:** `anon` + RLS only; no `service_role` client-side or in AI paths;
  every user-rendered string passes `esc()` (`js/ui.js`).
- **Events:** every mutation publishes `module.entity.action`.
- **Design system:** views compose `css/tokens.css` + `css/components.css`
  classes. Do not add token-laced inline `style=""` strings (there are ~1,700 to
  unwind). One icon system: inline SVG. No emoji as UI icons.
- **Reuse ladder:** before new code, reuse a `js/ui.js` helper, then stdlib, then
  a platform service. `js/ui.js` already exports `esc, toast, openModal, closeModal,
  formatDate, timeAgo, initials, avColor, scoreBar, stagePill, showError,
  loadingSkeleton, getAuthToken`.

### 8.2 Functional — per module
- **HRMS / People:** directory + profile + org chart; attendance check-in/out +
  regularization; leave apply/approve + balances + calendar + holidays; assets;
  expenses; helpdesk tickets; announcements; document store; lifecycle & letters.
- **Recruitment & Interview Automation:** create job/JD → Groq skill parse; upload
  resumes (single + bulk) → parse; match → ranked scores + breakdown; shortlist/
  reject pipeline; schedule interviews with slots + Google Meet; candidate profile
  with scores + interview history.
- **CRM:** accounts; contacts; leads with source/status; deals on a configurable
  pipeline; activity/note/task timeline; convert lead → account+deal; owner
  assignment. All `org_id`-scoped + RLS + events.
- **Analytics:** per-module KPI dashboards; date-range + department filters;
  export; reads via module APIs / `analytics_*` views only. Replaces the ad-hoc
  `views/reports/*` screens.

---

## 9. File Structure (actual)

```
app.html              the signed-in SPA shell (routes registered here)
index.html            marketing landing      login.html  reset-password.html
404.html  schedule.html  privacy.html  terms.html
css/    tokens.css  base.css  layout.css  components.css
js/     supabase.js auth.js  router.js  events.js  event-processor.js
        notifications.js  search.js  audit.js  ai.js  ui.js  config.js
        features.js   per-org + per-role gating (READ §16 before CRM work)
        csv.js        CSV helpers for the partner-CRM exports
        outbox.js  outbox-handlers.js   offline write queue
        image.js
        analytics/    models.js compiler.js engine.js nl.js charts.js duck.js
views/  dashboard.js  me/  inbox.js  approvals.js  onboarding.js
        employees/  attendance/  leave/  people/  documents/  finance/
        helpdesk/  announcements/  audit/  hr/       (HRMS/People)
        recruitment/                                 (Recruitment & Interviews)
        crm/                                         (BOTH CRMs — see §16)
        analytics/                                   (self-serve BI, §15)
        reports/                                     (→ folds into Analytics)
        sales/  ai/  settings/  admin/
api/    12 functions — at the Vercel Hobby cap, do not add a 13th
        parse-resume.js  match.js  screen-job.js  ai-query.js
        schedule.js  google-auth.js  bulk-import.js  reports.js
        create-org.js  send-notification.js  event-processor.js  lead.js
        (candidate extraction is parse-resume.js?action=extract-candidate)
lib/    supabaseServer.js  googleMeet.js  email.js  ratelimit.js
        provisionMember.js  langfuse.js
mobile/                                     supabase/functions/api-gateway/
supabase/migrations/*.sql   supabase/seed.sql
docs/   HANDOVER.md  architecture.html  analytics-setup.md  superpowers/specs/
```

New modules add a `views/<module>/` folder, a migration, and (if needed) `api/`
endpoints — never a new tenancy model.

---

## 10. Design System

Tokens in `css/tokens.css` (colors, spacing 4px base, typography, radius, shadow,
dark mode via `[data-theme="dark"]`). Components in `css/components.css` (button,
input, table, modal, toast, card, badge, empty-state, skeleton). Accent
`--color-accent: #2563EB`. **Compose classes; don't inline token strings.**

---

## 11. AI Integration (Groq)

- **CV↔JD matching** (built): resume/JD → Groq structured parse → score +
  breakdown stored on `applications`. Keep prompts that work; restructure only
  surrounding code.
- **AI Assistant** (permission-aware): natural-language query → Groq intent JSON
  → executed through the **same `anon`+RLS Supabase client** as the UI. Mutations
  require a confirmation dialog. Never `service_role`.

---

## 12. Conventions

- Tables/columns `snake_case`; JS files `kebab-case`; JS functions `camelCase`;
  CSS classes `kebab-case`; events `module.entity.action`.
- `const` by default, `let` when reassigned, never `var`; `async/await`; early
  returns; every Supabase call checks `error`.
- Git: branch `feature/…`|`fix/…`|`chore/…`; commits imperative and short.

---

## 13. Alignment Status (code vs. this document)

This file is the target. The code is being brought onto it in phases. (An
earlier version pointed at an approved plan `enchanted-sleeping-lemon.md` for
full detail; that file is not in the repo or anywhere on the working machine, so
this section is the status record.)

- **Phase 0 (this file)** — canonical definition + requirements. ✅
- **Phase 1** — unify tenancy: recruitment tables migrated `client_id → org_id`;
  `memberships` folded into `users`; `clients` dropped;
  `auth_accessible_client_ids()` removed; the `roleMap` shim deleted;
  `invitations` canonicalized to `org_id`. ✅ Credits/`credit_ledger` kept
  (org-scoped). Org resolution consolidated: `auth_org_id()` is the single
  source of truth and `auth_user_org_ids()` now delegates to it. ✅
- **Phase 2** — password-reset flow added (`login.html` + `PASSWORD_RECOVERY`
  in `js/auth.js`). ✅ Module-boundary enforcement is folded into Phases 4/5
  (the two remaining direct cross-module reads — the AI assistant's RLS-scoped
  queries per §11, and `views/reports/*` — resolve as Analytics is built).
- **Phase 3** — design-system cleanup: reference palette + per-module accents,
  SVG icons (no emoji), festival banner revised, inline-style unwind. ✅
- **Phase 4** — CRM: **built, front + back.** 🟡 The canonical CRM line lives on
  branch `claude/gstack-skill-install-chnb41` (the RTcompu distribution model),
  now the source of truth; an earlier parallel line (`rtcompu-crm-work`, PR #95)
  was retired into it. The live DB carries
  `crm_contacts/leads/opportunities/pipeline_stages/activities` plus
  `crm_partner_details` (`crm_accounts` is now a backward-compatibility **view**
  over it, not a table — the accounts→partner-details merge landed), a
  field-sales layer (`crm_visits/calls`, `crm_pjp_*` journey plans,
  `crm_report_imports/rows`) and `crm_*` RPCs incl. materialized views
  (`crm_sales_facts`, `crm_field_facts`). `views/crm/` is built:
  `index` (hub), `leads`, `sales`, `partners`/`partner-detail`, `events`,
  `field-sales` (Distribution), `pjp`, `visit-form`, `prospects`,
  `opportunities`, `exports`, and `reports` (report import). Notes:
  - **Report import** (`views/crm/reports.js`): upload Tally activation/sales
    CSV/XLSX → `crm_report_rows`, matched to partners by Site ID. Rows are
    de-duplicated by whole-row content — a stored `content_hash`
    (`md5(data::text)`) + the `crm_insert_report_rows` (security-invoker) RPC
    skip rows already present, so re-uploading a file adds nothing. Export is a
    single dialog: pick report type + optional date range.
  - **Sales tab** (`views/crm/sales.js`): in-card filters update independently —
    the grain toggle redraws only the time-series charts, the dimension toggle
    only the ranking chart; the Range presets are the one global refilter.
  - **Migration gap — resolved, and the original diagnosis was wrong.** This
    previously read: the branch's migrations reference
    `crm_report_imports`/`crm_report_rows` but never create them, so add a
    create-table migration early in the history. Do **not** do that — it would
    add a duplicate definition. Nothing was missing from the real history;
    both tables are created in applied migration `20260803114500`. The actual
    problem was that the repo's migrations were not the migrations that built
    the database. See "Migration history" below.
  - **Post-import refresh**: `crm_sales_facts` needs `crm_refresh_sales_facts()`
    (service-role) to reflect newly imported rows in Sales analytics; not called
    from the anon UI. Follow-up: an admin/edge refresh trigger.
  - Schema diverges from §6.4's proposal (opportunities vs deals; PJP/visits/
    report-imports not in the doc). Reconcile §6.4 with the real schema.
- **Phase 5** — Analytics. **Already built on `main`**, not pending: a
  Metabase-style self-serve BI module (`js/analytics/`, `views/analytics/`,
  semantic layer → compiler → RLS-safe `analytics_run_sql`, ECharts, DuckDB-Wasm
  panel, scheduled reports and alerts). See §15 for the detail. The remaining
  work is retiring `views/reports/*` in favour of it, not building it.

### Integration status (branch `claude/crm-into-main`)

The RTcompu CRM was built on `claude/gstack-skill-install-chnb41` while `main`
(production) gained analytics, email, outbox, rate limiting, mobile and the
landing pages. The two diverged on 2026-07-23 and became different builds of the
same product. They are being reconciled on `claude/crm-into-main` by porting the
partner vertical onto `main` rather than merging the branches — most merge
conflicts were in files `main` owns and the CRM line barely touched.

Done there: the verified migration history replaces `main`'s hand-authored set;
the gen-2 partner screens are added, routed and gated; PJP moved to the
locks-and-adherence version; the CRM hub surfaces both CRMs. Not done: the
two-pass verification on a preview deployment (as RTcompu, and as a non-partner
org where the generic CRM must be unchanged) before any PR into `main`.

**Read §16 before touching `views/crm/`.**

### Migration history

`supabase/migrations/` and the live database used to hold two unrelated
lineages. The repo carried 41 hand-authored files stamped with synthetic round
timestamps (`20260723000000`); the database recorded 105 applied migrations
stamped with real clock times (`20260730193855`). Exactly one version appeared
in both. The repo's history therefore could not rebuild the database — 23 of 55
live tables had no create-table statement anywhere in it, including the whole
CRM core. The likely cause (inferred from the timestamp shapes, not proven) is
that migrations were applied through the Supabase `apply_migration` tool, which
stamps its own timestamps, while `.sql` files were written into the repo
separately and never reconciled.

Resolved on branch `claude/migrations-from-db`: all applied migrations were
exported from `supabase_migrations.schema_migrations` (where Supabase stores the
SQL of everything it applied) and are now the repo's history, verified
byte-for-byte against `md5(statements)` computed in the database.

**The rule this establishes: `supabase/migrations/` must stay byte-identical to
what the database recorded, plus clearly-marked reconstruction migrations for
objects that were created outside the migration system.** Every reconstruction
file says so in a header comment; there is currently exactly one
(`20260803090049_crm_telecaller_names.sql`). Practically:

- Apply DDL with the Supabase `apply_migration` tool, then save the file under
  the exact version it recorded — check `schema_migrations` rather than guessing
  a timestamp, because the tool picks its own.
- Keep the applied SQL and the file identical. Either apply the SQL with its
  comments included, or keep files comment-free and put the rationale in the
  commit message. A commented file applied in uncommented form is drift.
- Never hand-author a migration file with an invented timestamp. That is exactly
  what produced the split lineage.

Triage of the 41 superseded files against the live schema found 38 already
landed. The one genuine gap was the noticeboard: `posts` had RLS enabled with
only a `DELETE` policy, so `views/dashboard.js` could neither read nor write it.
Fixed in `20260915163455_restore_posts_rls_policies.sql`. `audit_logs` and
`events` still have no INSERT policy; that is deliberate — both are written by
service-role and `SECURITY DEFINER` paths that bypass RLS.

**Verified by replay.** The history was replayed onto an empty database (a
throwaway local Supabase stack, since branching needs the Pro plan) and the
resulting schema compared against production's catalogue.

The raw export did **not** replay. It failed at `20260811153118_security_hardening`
with `function public.crm_telecaller_names() does not exist` — that function was
created in production outside the migration system, so nothing in the recorded
history creates it. This is why the reconstruction-migration exception above
exists. With `20260803090049_crm_telecaller_names.sql` in place, all 107
migrations apply cleanly to an empty database.

The structural diff against production then showed **0 objects that production
has and the replay does not build**. It builds two that production no longer
has, both created by migrations and dropped by none, so production removed them
by hand:

- `zzz_crm_accounts_backup` — the safety copy taken during the accounts merge;
  deliberate cleanup.
- `analytics_run_as` — created by `20260905134934_analytics_alerts`. **Worth a
  look**: production is missing a function its own migration creates, and the
  name suggests it may have been removed on purpose for security. Decide whether
  the migration should still create it.

Scope of that check: it compares objects by name — tables, columns, indexes,
policies, functions, views, matviews. A function whose *body* drifted from its
migration would pass it, and grants/privileges are not compared. A clean diff is
strong evidence, not proof of identical behaviour.

---

Tenancy is unified: `org_id` is the only tenant key. Do not reintroduce
`client_id`/`memberships`; new work targets `org_id`.

---

## 14. What NOT to Build

| Item | Reason |
|------|--------|
| Agency/reseller multi-client tier | Explicitly collapsed to one-org-per-company. |
| Payroll | Compliance minefield. Not until paying customers demand it. |
| Visual workflow builder | Predefined event recipes only. |
| Custom role-permission UI | Four fixed roles are enough. |
| Native mobile app | PWA first. |
| Microservices / Elasticsearch | Monolith + Postgres FTS until a named scaling trigger. |
| React / Next.js migration | Stay vanilla JS unless the owner asks. |


---

## 15. Platform subsystems (detail)

Carried over from the working notes that lived on `main`. These describe
subsystems the canonical sections above summarise but do not detail, and they
are the record for anyone touching security, analytics, webhooks or the API
gateway.

### Security remediation (external audit — Phase 1)

An external repository audit flagged P0 leaks; several were already fixed in-repo when re-checked (P0-08 event-processor fails **closed** on missing `CRON_SECRET`; P0-09 `claim_events` uses `FOR UPDATE SKIP LOCKED`; P0-15 `google-auth.js` OAuth `state` is an HMAC-signed 10-min token carrying only the uid, never the session token; INT-04 `send-notification` validates recipient org membership on every path). **Phase 1** (`supabase/migrations/20260906120000_audit_remediation_phase1.sql`) closed four confirmed-open ones: **P0-06** events and **P0-07/EV-05** audit logs are now written only through SECURITY DEFINER RPCs `publish_event()` / `log_audit()` that stamp `actor = auth.uid()` and pin org membership — the broad client INSERT policies on `events`/`audit_logs` were dropped (SELECT unchanged; no UPDATE/DELETE policy = append-only). `js/events.js`/`js/audit.js` call the RPCs. **P0-11/AI-06/DB-06** credit spend is atomic via `consume_credits()` (row-locked decrement + ledger in one txn, hard_stop enforced; service_role-only) — used by `api/match.js` and `api/screen-job.js`. **BOS-04** leave usage is atomic via `apply_leave_usage()` (single UPDATE; SECURITY INVOKER so RLS still governs the browser processor) — used by both `api/event-processor.js` and `js/event-processor.js`. **P0-13** (parse resource-ownership) closed in `api/parse-resume.js`: `handleParseJD` now resolves the supplied `job_id` → client → org and checks the caller's membership (agency-wide role, or client-scoped) **before** the service-role `jobs.parsed_skills` write — a cross-tenant `job_id` is rejected 403/404 instead of overwriting another org's job (code-only, no migration). **P0-16** (weak invitation flow) closed: onboarding no longer generates or returns temp passwords. New shared `lib/email.js` (`sendEmail` [Resend, available once a domain is verified], `baseUrlFromReq`, `sendPasswordSetupEmail`) sends the set-password invite through **Supabase's built-in auth email** (`resetPasswordForEmail` via an anon client — the same path as the browser forgot-password flow), so no custom sending domain / Resend account is required; the invitee lands on the existing `/reset-password` page (PASSWORD_RECOVERY flow) and sets their own password. (Supabase's built-in mailer is rate-limited on the free tier; a large bulk import can exceed it — the member is still provisioned and an admin re-sends via Reset pw.) `findOrCreateUser`/`provisionMember` create the login with a random undisclosed secret and send the invite (return `invite_sent`, never a password); `api/create-org.js` (agency/client create, `invite`, `reset_password`) and `api/bulk-import.js` all use it; the invite/reset/bulk UIs (`views/settings/users.js`, `views/employees/import.js`) show "invitation/reset email sent" instead of a password. **P0-04/P0-05/BOS-01** (per-permission Business-OS RLS) — Phase 2 (`supabase/migrations/20260906140000_audit_remediation_phase2_rls.sql`, applied live): writes to org-config + identity tables now require an admin (`is_org_admin()`, still org-scoped) instead of mere org membership, mapped onto the four fixed roles (no custom-permissions system). **memberships** insert/update/delete are admin-only + a `memberships_guard()` trigger (only an owner grants owner/super_admin; no self role-change; service role bypasses). **users** keeps a self-or-admin update policy but a `users_guard_admin_fields()` trigger preserves admin/HR columns (role, status, org_id, department/team, reporting line, designation, joining date) on non-admin self-edits and forces role='member' on non-admin self-insert (P0-05). **departments/teams/leave_types/expense_categories/announcements/assets/asset_assignments** writes → admin-only (added the missing `lt_delete`). **expenses** → submit/edit/delete your own or admin-any, with `expenses_guard_review()` keeping status/reviewer/reimbursement fields admin-only (no self-approval). All management UIs already gate controls to owner/admin, so only the direct-API path changed. **P0-01/P0-02/AN-09** (AI-query arbitrary DB access / LLM-controlled authorization) closed in `api/ai-query.js` (code-only): the assistant already ran under the caller's RLS via `supabaseAsUser` (not service_role) against a server-side `DATASETS` whitelist (the model names a dataset *key*, never a table; fixed `select` per dataset) — RLS is the authority, not the model. This pass makes the registry fully **typed**: each filter declares an allowed `enum` or `type` (uuid/date/text), and `cleanFilterValue()` drops any filter whose column isn't declared or whose value fails its type before the query runs, so a hallucinated/hostile filter can't reach the DB. The analytics NL path (`mode:"analytics"`) already returns a *validated* builder spec compiled to RLS-safe SQL (AN-09). **OPS-10** (rate limiting) closed via a Postgres-backed shared limiter (no Redis needed): `rate_limits` table + atomic fixed-window `rate_limit_hit(key,limit,window)` SECURITY DEFINER RPC (service_role-only; `rate_limits` RLS-on, no policies) in `supabase/migrations/20260906160000_rate_limits.sql`, wrapped by `lib/ratelimit.js` (`rateLimit`, `tooMany`, `clientIp`; fails **open** on limiter error). Wired into the AI/parsing/notification/scheduling endpoints — `api/ai-query.js` (30/min/user), `api/match.js` (30), `api/screen-job.js` (20), `api/parse-resume.js` (30), `api/send-notification.js` (30), and public `api/schedule.js` (40/min/IP) → 429 + `Retry-After`. `rate_limit_gc()` runs in the daily cron. **P0-10/EV-02/EV-03** (handler idempotency + retry/lease metadata) closed in `supabase/migrations/20260906180000_event_outbox_idempotency.sql` (applied live): an `event_side_effects` ledger + `claim_side_effect(event_id, effect_key)` SECURITY DEFINER RPC (org-scoped for authenticated callers) lets a handler apply each side effect at most once across retries and across both processors — the leave used-days increment in both `api/event-processor.js` and `js/event-processor.js` is now guarded by it, and the annual `leave_balances` seed uses upsert. `events` gains `locked_at`/`last_error`/`failed_at`; `claim_events` stamps the lease; `resolve_event` has a 3-arg overload recording the error and clearing the lease; `requeue_stale_events(lease,max)` (service_role-only, run first in the daily cron) rescues events stranded in `processing` by a dead worker and dead-letters ones past the attempt cap. **Still open (smaller residuals):** a full transactional outbox (every mutation + its event in one DB txn, all handling moved server-side) — the current dedup ledger covers the correctness half; and tightening `leave_balances` write RLS to admin/HR still needs `apply_leave_usage` moved to SECURITY DEFINER (else a non-HR member's browser processor, blocked by RLS, would mark the side effect done and lose the update); notification-insert dedup on retry (low harm).

### Analytics (self-serve BI, Metabase-inspired)

Gated by the `analytics` feature (admins toggle per-org; defaults to managers/admins, sidebar `data-role="manager"`). Two org-scoped tables — `analytics_questions` (a saved query: `spec` JSONB + `viz`, `mode` builder|sql) and `analytics_dashboards` (`cards` JSONB = ordered {question_id,w} grid). **Semantic layer** in `js/analytics/models.js` (base table + joins + per-field SQL expressions + named measures like win-rate/weighted-pipeline) → `js/analytics/compiler.js` compiles a builder spec to one aggregate SQL statement (joins emitted on demand, time-bucketing via `date_trunc`+`to_char`, values escaped as literals). Both the **visual builder** and the **SQL mode** run that SQL through `analytics_run_sql(text,int)` — a **SECURITY INVOKER** RPC (RLS stays enforced) guarded to a single read-only SELECT/WITH, catalog-blocked, timeout + row-capped — so aggregation/joins happen **server-side, no client row cap**. `engine.js` just dispatches spec→compile→RPC. **AI ask** (`js/analytics/nl.js`): plain-English → a *validated* builder spec via `api/ai-query.js` `mode:"analytics"` (Groq plans against a compact catalogue the browser sends; the key stays server-side; the returned spec is re-validated against the real models, so hallucinated fields are dropped, then compiled + run on the RLS path). No new Vercel function — reuses ai-query (still 12/12). Six chart types rendered with **Apache ECharts** (lazy-loaded from the jsdelivr CDN in `js/analytics/charts.js`; `renderChart(container, viz, result, {theme})`), with a per-question **mono / color** theme toggle; `table` + `number` stay HTML. **Local analysis** (`js/analytics/duck.js`): a DuckDB-Wasm panel in the builder for fast in-browser slice/dice/pivot/window-fns over the current result. Security-critical: it is **never a data channel** — it only ingests rows already fetched through the RLS path, runs in a sandboxed worker, **fully in-memory** (no OPFS/IndexedDB), over the in-memory `data` table; wasm lazy-loads from jsdelivr. **Scheduled reports & alerts** (`analytics_alerts` table, RLS): per-question schedule (daily/weekly/monthly email) or threshold alert. The daily cron (`api/event-processor.js` → `processAnalyticsAlerts`) compiles the stored spec, **mints a short-lived JWT for the report's creator** and runs it via `analytics_run_sql` (so the creator's RLS applies — no service_role-bypass, no impersonation function), then emails via Resend. Requires `SUPABASE_JWT_SECRET` in the server env (else it no-ops). UI: 🔔 Alerts on a saved question. Routes `analytics`, `analytics/question`, `analytics/dashboard`. **No new Vercel function** (stayed at 12/12; reuses ai-query + event-processor).

### Outbound webhooks (integratability)

External tools subscribe to the event bus. `webhook_endpoints` (org-scoped, admin-managed via Settings → Integrations) + `webhook_deliveries` (queue). An AFTER-INSERT trigger on `events` (`enqueue_webhook_deliveries`, SECURITY DEFINER) fans each new event into a delivery per matching active endpoint (patterns: `*`, `crm.*`, `crm.opportunity.created`). The daily cron (`api/event-processor.js` → `dispatchWebhooks`) POSTs pending deliveries with an `X-Atllanta-Signature: sha256=<hmac>` header (HMAC of the body with the endpoint secret), 10s timeout, retry with backoff (≤6 attempts), and an SSRF guard (https-only, no private hosts). Delivery latency = cron cadence. No new Vercel function.

### Org API keys + REST surface (integratability)

External tools read/write via a revocable org key. The REST surface is Supabase **PostgREST** (RLS-enforced, already exposed); the key layer is the **`api-gateway` Supabase Edge Function** (`supabase/functions/api-gateway/index.ts`, deployed **public/`verify_jwt=false`**, **not** a Vercel function): it hashes the presented `atl_…` key, looks it up in `api_keys` (only the SHA-256 hash is stored; active/revocable), enforces read/write scope, mints a 60s JWT for the key's `acting_user_id`, and forwards to `/rest/v1/<table>` so RLS applies (org-scoped). Keys are created client-side (admin generates raw key, stores hash) in Settings → Integrations → API keys; raw key shown once. **Requires the `APP_JWT_SECRET` edge secret** (= project JWT secret) — else the gateway 503s. Base URL: `<SUPABASE_URL>/functions/v1/api-gateway/<table>`.

### CRM / partner-sales vertical (tenant **RTcompu**, org `e8845b88-…`)

> **Partly superseded.** This describes the first-generation partner
> vertical. The distribution-model screens (partners, field sales,
> prospects, events, exports) and a PJP with month locks and adherence
> replaced parts of it; `visits.js`, telecalling and coverage remain. See
> "Two CRMs, one product" below.

A telecalling/field-sales CRM gated to enabled orgs (RTcompu). Data comes from imported partner reports keyed on Site ID (`crm_report_*`), materialised into `crm_opportunity_features_mv` (per-partner facts: base size, billed rupees, last visit/activation, tier). All CRM reads go through `SECURITY DEFINER` RPCs that re-apply level scoping (own / reports / admin via `crm_report_ids()`, `crm_user_is_org_admin()`); MV/helpers revoked from `anon`. Key surfaces:

- **PJP (`views/crm/pjp.js`)** — the one field-visit block ("Who to visit" is a tab/drill-down of it, not a separate menu card). Month calendar (route-map planner, **not** the attendance heatmap look), plan an area per day, **lock the month** (`crm_pjp_month_locks`, DB-enforced on day-plan write policies). Open a planned day → partner list; each row has a **Log visit** button → `crm/visits?account=…` (prefilled).
- **Gap prediction** (`crm_pjp_gap_accounts`) — "who to visit first": `gap = expected − actual`, `expected = users × same-place peer-median business-per-user`. Peer group finest-that-clears-8-peers: **pincode → billing_city → district → region**, ≥25-user benchmark floor. Fact worklist (`crm_partner_actions`, reasons: tss_overdue/stopped_buying/base_no_buy/not_visited) still exists, ordered by billed rupees.
- **Visits** (`views/crm/visits.js`) — GPS + selfie + offline outbox; captures **Tally serial** (`tally_serial` / `tally_serial_status` ∈ shared/not_shared/no_licence).
- **Pending:** partner-wise **pincode CSV** from Sachin → load into `crm_accounts.pincode` to sharpen peer benchmarks from city to pincode level (column exists, nullable).

### Source-of-truth files

| Need | Look at |
|------|---------|
| DB schema / tables / RLS | `supabase/migrations/*.sql` |
| Design tokens (colors, spacing, type) | `css/tokens.css` |
| File layout | actual `api/`, `js/`, `views/`, `css/` trees |
| API surface | files in `api/` |
| Architecture diagram (interactive HTML) | `docs/architecture.html` (generated by the archify skill) |
| Full architecture rationale & phase plan | `docs/HANDOVER.md` |

**Skills:** `archify` (`.claude/skills/archify` → `.agents/skills/archify`) generates interactive HTML diagrams (architecture/workflow/sequence/dataflow/lifecycle) from prose, Mermaid, or repo code — `node bin/archify.mjs validate|deliver <type> <spec.json> <out.html> --quality showcase`.

---

## 16. Two CRMs, one product

There are **two CRMs by design**, gated per organization. This is the single
most misread thing in the codebase: `views/crm/` holds both, and the file names
do not tell you which is which.

**The gates.** `organizations` carries two booleans:

| Flag | Meaning | Live state |
|---|---|---|
| `crm_enabled` | the generic CRM | true for every org |
| `partner_crm_enabled` | the RTcompu partner vertical | true for RTcompu only |

`js/features.js` reads them via `setCrmEnabled()` / `setPartnerPack()` and splits
the CRM surface into `GENERIC_CRM` and `PARTNER_FEATURES`. These are **platform
gates: an org's own admins do not bypass them**, unlike per-role feature access.

`isVisible()` precedence, in order: a `GENERIC_CRM` key is hidden when
`crm_enabled` is false; a `PARTNER_FEATURES` key is hidden when
`partner_crm_enabled` is false; anything else falls through to "unknown keys
stay open". **That last rule is why a new partner screen must be added to
`PARTNER_FEATURES`** — a key in neither set is visible to everyone.

**Generic CRM** (`crm`, `crm_leads`, `crm_pipeline`, `crm_contacts`):
`index.js`, `leads.js`, `lead-detail.js`, `lead-actions.js`, `opportunities.js`,
`opportunity-detail.js`, `accounts.js`, `account-detail.js`, `contacts.js`,
`contact-detail.js`, `activities.js`, `settings.js`, `common.js`.
`leads.js` and `opportunities.js` are **generic** — the partner vertical does not
own them, despite a partner-flavoured version existing on the old CRM branch.

**Partner vertical, first generation** (still in use): `telecalling*.js`,
`coverage.js`, `opportunities-coverage.js` (route `crm/opps`), `targets.js`,
`visits.js` (route `crm/visits`).

**Partner vertical, second generation** (the distribution model): `partners.js`,
`partner-detail.js`, `partner-form.js`, `account-form.js`, `field-sales.js`
(route `crm/field-sales`), `field-log.js`, `prospects.js`, `events.js`,
`exports.js`, `visit-form.js` (route `crm/log-visit`), `activity-timeline.js`,
plus the gen-2 `pjp.js`, `sales.js` and `reports.js`.

`js/csv.js` exists for the gen-2 exports and is imported by five of them.

**Things that will look like bugs and are not:**

- **Two visit-logging paths.** The hub sends you to `crm/log-visit` (gen 2), but
  `account-detail.js` and `opportunities-coverage.js` still link to `crm/visits`
  (gen 1). Both work. `visits.js` was kept precisely because those two link to
  it, one of them in the *generic* CRM.
- **An opportunity engine with no UI.** `crm_partner_opportunity`,
  `crm_opportunity_features_mv` and the opportunity-engine RPCs exist in the
  schema but nothing calls them. The gen-2 opportunities screen was deliberately
  not ported, because `opportunities.js` stays generic. If that workspace is
  wanted, give it its own route — `crm/opportunities` is generic and `crm/opps`
  is the coverage screen.
- **"Collect lead" loses the partner.** `partner-detail.js` links to
  `crm/leads?partner=<id>`; the generic `leads.js` does not read that parameter.
  The button works, the partner is not pre-filled.
- **`to-visit.js` is gone.** Superseded by the gen-2 PJP, which no longer imports
  `inr` / `REASON_BY_KEY` from it.

**Adding a partner screen:** register the route in `app.html`, map it in
`CRM_SUB`, add the key to `PARTNER_FEATURES`, and add a card to `partnerCards` in
`views/crm/index.js`. Skip the `PARTNER_FEATURES` step and every org sees it.
