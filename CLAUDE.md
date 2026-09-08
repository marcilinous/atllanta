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
the UI hides what a role can't do (`data-role` on nav in `index.html`).

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
index.html            login.html          schedule.html
css/    tokens.css  base.css  layout.css  components.css
js/     supabase.js auth.js  router.js  api.js  events.js  event-processor.js
        notifications.js  search.js  audit.js  ai.js  ui.js  config.js
views/  dashboard.js  me/  inbox.js  approvals.js  onboarding.js
        employees/  attendance/  leave/  people/  documents/  finance/
        helpdesk/  announcements/  audit/            (HRMS/People)
        recruitment/                                 (Recruitment & Interviews)
        reports/                                     (→ folds into Analytics)
        ai/  settings/  admin/
api/    parse-resume.js  match.js  screen-job.js  extract-candidate.js
        schedule.js  google-auth.js  ai-query.js  bulk-import.js  reports.js
        create-org.js  send-notification.js  event-processor.js
lib/    supabaseServer.js  googleMeet.js
supabase/migrations/*.sql   supabase/seed.sql
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

This file is the target. The code is being brought onto it in phases (full detail
in the approved plan `enchanted-sleeping-lemon.md`):

- **Phase 0 (this file)** — canonical definition + requirements. ✅
- **Phase 1** — unify tenancy: migrate recruitment tables `client_id → org_id`;
  fold `memberships` into `users`; drop `clients`; replace
  `auth_accessible_client_ids()` + `auth_user_org_ids()` with one `auth_org_id()`;
  delete the `roleMap` shim (`js/auth.js:29`); standardize `organization_id → org_id`.
- **Phase 2** — enforce module boundaries; add password-reset flow.
- **Phase 3** — design-system cleanup (inline-style removal, SVG icons, dedupe
  `index.html` helpers against `js/ui.js`).
- **Phase 4** — build CRM. **Phase 5** — build Analytics as a real module.

Until Phase 1 lands, recruitment code still queries `client_id`/`memberships`.
Do not extend that model; new work targets `org_id`.

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
