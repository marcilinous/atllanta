# CLAUDE.md — Atllanta Foundation & Requirements

> **What this file is:** The definitive single source of truth for Atllanta's
> target architecture, tenancy boundaries, conventions, and functional
> modularity. Read it completely before writing any code. When code and this
> document conflict, this file wins.
>
> **Stack note:** This supersedes the earlier vanilla-JS/Supabase-only
> CLAUDE.md. Atllanta is now standardized on a type-safe **Next.js (App
> Router) + TypeScript + Supabase + Drizzle ORM + Tailwind CSS / shadcn/ui**
> full-stack monolith.
>
> **Read this before you write code — two stacks are live at once.** This file
> is the **target**. Production today still runs the vanilla-JS/Supabase-direct
> app, and it keeps running until Phase 8 of `TRANSITION.md` retires it. So:
> - **Where are we?** `TRANSITION.md` — read it first, every session. It holds
>   the current phase and the next unchecked item.
> - **Working on the live app?** Its rules are `docs/legacy/CLAUDE-legacy.md`
>   (vanilla JS, no framework) and the module map in `docs/context/`. Fixes and
>   releases there follow the legacy rules — do not half-migrate a live screen.
> - **Working on the new stack?** This file wins.
> - **Both stacks share one Supabase database** during the transition, so any
>   schema change must keep the legacy app working until its screens are retired.

---

## 1. Core Principles & Non-Negotiables

- **Single-Tenant per Company:** One company = one `organization` (`org_id`).
  Multi-tenant agency/reseller models (`client_id`, `memberships`) are
  deprecated.
- **Strict Tenant Isolation:** Every business table carries
  `org_id uuid not null references organizations(id)`.
- **Zero Trust & Client Isolation:**
  - Supabase client sessions evaluate Row-Level Security (RLS) policies via
    `auth_org_id()`.
  - All mutations run **server-side** through Next.js **Server Actions**
    with schema validation via **Zod** and transactions via **Drizzle ORM**.
  - The `service_role` key is strictly forbidden in frontend code, public
    server actions, and AI execution paths.
- **System Roles + Custom Roles:** Five built-in system roles —
  `owner`, `admin`, `developer`, `manager`, `member`. `admin` can additionally
  define **custom roles** scoped to the org, each with its own permission set
  (see §3.5, Roles & Module Access).
- **Module Enablement Per Org:** Modules are not globally always-on. `admin`
  controls which modules are enabled for their org, and which roles
  (system or custom) can access each enabled module (see §3.5).
- **Decoupled Cross-Module Communication:** Modules never perform direct
  joins or write mutations across other modules' raw transactional tables.
  Cross-module interoperability is executed exclusively via Server
  Actions/APIs or the asynchronous Event Bus.

---

## 2. Technical Stack

| Layer | Technology | Usage & Scope |
|---|---|---|
| Framework | Next.js (App Router, React 19+) | Server Components for streaming data fetch, Server Actions for mutations. |
| Language | TypeScript (Strict Mode) | End-to-end type safety across schemas, actions, and UI components. |
| Database & Auth | Supabase (PostgreSQL 15+) | Auth (SSR cookie sessions), RLS policies, Storage buckets. |
| ORM & Migrations | Drizzle ORM + Drizzle Kit | Type-safe SQL generation, relational modeling, automated migrations. |
| Design System | Tailwind CSS + shadcn/ui | Accessible components, responsive layout, inline SVG icons (no emojis as functional icons). |
| LLM & Inference | Groq SDK (LLaMA) | High-speed structured parsing for CVs, JD generation, and copilot actions. |
| Integrations | Google Calendar, Resend, WhatsApp BSP | Calendar synchronization, transactional email, and outbound messaging. |
| LLM Observability | Langfuse | Tracing, prompt/version tracking, and evaluation for all Groq calls (JD generation, resume matching, AI Assistant). |

---

## 3. Modular Architecture & Data Model

### Module 0: Shared Platform & Identity

Foundational identity, tenant isolation, global user roles, append-only
auditing, file metadata, and the decoupled system event bus.

**Core Tables:**
```sql
organizations(id, name, slug, logo_url, timezone, currency, plan_tier,
              payment_status, created_at, updated_at)
users(id references auth.users, org_id, full_name, email, phone, avatar_url,
      role owner|admin|developer|manager|member, custom_role_id, designation,
      department_id, team_id, reporting_manager_id, status, date_of_joining)
departments(id, org_id, name, head_id)
teams(id, org_id, department_id, name, lead_id)
invitations(id, org_id, email, role, token, status, expires_at)
audit_logs(id, org_id, user_id, module, entity_type, entity_id, action,
           old_values jsonb, new_values jsonb, created_at)
events(id, org_id, event_type, actor_id, payload jsonb, status, attempts,
       created_at, processed_at)
notifications(id, org_id, user_id, title, body, module, entity_type,
              entity_id, channel, status, sent_at)
files(id, org_id, uploaded_by, file_name, file_path, file_size, mime_type,
      entity_type, entity_id, created_at)
org_modules(id, org_id, module_key, is_enabled, enabled_by, enabled_at)
roles(id, org_id, name, slug, is_system, description, created_by, created_at)
role_permissions(id, org_id, role_id, module_key, permission text, created_at)
-- permission is one of: view | create | edit | delete | approve
```
**Directory:** `src/app/(platform)/`, `src/lib/auth/`, `src/lib/events/`,
`src/db/schema/platform.ts`

---

### 3.5 Roles & Module Access

**Module enablement (org-level):**
- Every module (HRMS, CRM, Analytics, Recruitment, Helpdesk, Projects, AI
  Assistant) has a row in `org_modules` per org, `is_enabled` defaulting to
  `false` on org creation.
- Only `owner`/`admin` can toggle `org_modules.is_enabled`. A disabled
  module is hidden from nav (`data-role`/`data-module` gating) and its
  Server Actions reject with a permission error even if called directly.
- Toggling emits `platform.module.enabled` / `platform.module.disabled`.

**Roles (system + custom):**
- `owner`, `admin`, `developer`, `manager`, `member` are **system roles**
  (`roles.is_system = true`), seeded per org, not editable/deletable.
- `admin` can create **custom roles** scoped to the org (`roles.is_system =
  false`), each with a name and a set of module-level permissions stored in
  `role_permissions` (per module: `view` / `create` / `edit` / `delete` /
  `approve`).
- A user is assigned exactly one role via `users.role` (system) **or**
  `users.custom_role_id` (custom) — never both.
- The `developer` role is a system role with technical/config-adjacent
  access (API keys, webhooks, integration settings, Langfuse trace access,
  event bus inspection) but not billing or org deletion (that stays
  `owner`-only).
- Permission checks live in one place (`js/auth.js`-equivalent
  `src/lib/auth/permissions.ts`), resolving system role defaults first,
  then custom-role `role_permissions` overrides. The AI Assistant is not an
  exception — it resolves permissions through the same path.
- Creating/editing a custom role, or changing its permissions, emits
  `platform.role.created` / `platform.role.updated`.

---

### Module 1: HRMS (Human Resource Management)

Directory management, presence tracking, leave balances, asset inventory,
employee expenses, and company notices.

**Core Tables:**
```sql
attendance(id, org_id, user_id, date, check_in, check_out, status, regularized)
attendance_regularizations(id, org_id, attendance_id, reason, status, approved_by)
work_schedules(id, org_id, name, details jsonb)
holidays(id, org_id, name, holiday_date)
leave_types(id, org_id, name, default_days)
leave_balances(id, org_id, user_id, leave_type_id, balance, year)
leave_requests(id, org_id, user_id, leave_type_id, start_date, end_date,
               reason, status, approved_by)
assets(id, org_id, name, serial_number, category, status)
asset_assignments(id, org_id, asset_id, user_id, assigned_at, returned_at)
expenses(id, org_id, user_id, category_id, amount, currency, receipt_file_id,
         status, approved_by)
expense_categories(id, org_id, name)
announcements(id, org_id, title, body, author_id, published_at)
```
**Directory:** `src/app/(dashboard)/hrms/`, `src/modules/hrms/`,
`src/db/schema/hrms.ts`

**Emitted Events:** `people.employee.created`, `leave.request.created`,
`leave.request.approved`, `attendance.checkin.completed`

---

### Module 2: CRM (Standard & Custom Developer Engine)

Combines out-of-the-box pipeline tracking with a visual and code-level
customization engine.

**1. Generic CRM (Ready-to-Use):**
- Accounts and contacts hierarchy with primary contact tags.
- Lead lifecycle tracking with source attribution and qualification scores.
- Deals across multi-stage visual Kanban funnels with win probabilities and
  expected close dates.
- Omnichannel interaction timeline logging calls, emails, notes, tasks, and
  messaging.

**2. Custom CRM (Developer & Visual Builder Mode):**
- **Dynamic Entity Definitions:** Define custom business objects beyond
  standard leads (e.g., contracts, subscriptions, vendors).
- **Drag-and-Drop Form Builder:** Add custom fields (text, number, select,
  date, formula, lookup) and define multi-column form layouts and
  validation rules.
- **Code Hooks & Scripting:** Sandboxed execution triggers (`beforeInsert`,
  `afterChange`) for advanced calculations and third-party webhook
  dispatches.

**Core Tables:**
```sql
-- Generic CRM
crm_accounts(id, org_id, name, industry, website, owner_id, created_at, updated_at)
crm_contacts(id, org_id, account_id, full_name, email, phone, title,
             is_primary, created_at)
crm_leads(id, org_id, full_name, company, email, phone, source, status,
          qualification_score, owner_id, created_at)
crm_pipelines(id, org_id, name, is_default, stages jsonb, created_at)
crm_deals(id, org_id, account_id, pipeline_id, title, value, currency,
          stage, status, expected_close, owner_id, created_at)
crm_activities(id, org_id, entity_type, entity_id, type, body, due_at,
               done, actor_id, created_at)

-- Custom CRM (Developer Mode)
crm_entity_definitions(id, org_id, name, label, description,
                        layout_schema jsonb, code_hooks jsonb, is_system,
                        created_at)
crm_field_definitions(id, org_id, entity_id, name, label, type,
                       is_required, default_value jsonb, options jsonb,
                       validation_rules jsonb, formula_expression text,
                       display_order, created_at)
crm_custom_records(id, org_id, entity_id, data jsonb, created_by,
                    created_at, updated_at)
-- Indexing: GIN index applied on crm_custom_records(data)
```
**Directory:** `src/app/(dashboard)/crm/`, `src/modules/crm/`,
`src/db/schema/crm.ts`

**Emitted Events:** `crm.lead.converted`, `crm.deal.won`

---

### Module 3: Self-Serve Analytics (Metabase-Inspired)

A self-serve business intelligence workspace operating strictly on
read-only analytical views to ensure non-blocking transactional
performance.

- **Visual "Ask a Question" Builder:** Select any entity, filter
  conditions, group dimensions, and select aggregate operations (Sum,
  Average, Count, Distinct) without writing SQL.
- **Native SQL Editor:** Monaco-based editor supporting parameterized
  variables (`{{start_date}}`), autocomplete, and schema inspection.
- **Visualizations & Dashboards:** Dynamic tables, multi-series lines, bar
  charts, funnels, and KPI trends placed on a draggable, resizable canvas
  with top-level shared date and department filters.
- **Automated Pulses:** Scheduled cron-based digests and threshold alerts
  dispatched via email (Resend) or in-app notifications.

**Core Tables:**
```sql
analytics_questions(id, org_id, title, description, query_type,
                     query_payload jsonb, raw_sql text,
                     display_settings jsonb, created_by, created_at,
                     updated_at)
analytics_dashboards(id, org_id, title, description, parameters jsonb,
                      is_favorite, created_by, created_at, updated_at)
analytics_dashboard_cards(id, org_id, dashboard_id, question_id,
                           layout jsonb, parameter_mappings jsonb,
                           display_order)
analytics_subscriptions(id, org_id, dashboard_id, question_id, channel,
                         recipient_ids jsonb, cron_schedule,
                         condition_rule jsonb, is_active, created_at)
```
**Directory:** `src/app/(dashboard)/analytics/`, `src/modules/analytics/`,
`src/db/schema/analytics.ts`

---

### Module 4: Recruitment & Interview Automation

End-to-end talent acquisition loop structured across 7 functional pillars:

1. **JD Maker** — Structured job description builder utilizing Groq LLaMA
   to generate role responsibilities, required skills, and grading
   criteria.
2. **Resume Collector** — Multi-channel CV intake via drag-and-drop file
   upload, public candidate submission forms, and bulk PDF/DOCX import.
3. **Resume-to-JD Matcher (AI + ATS)** — Groq extracts skills, parses
   career history, and scores candidate-to-job relevance (0–100%) with a
   breakdown of matches and gaps.
4. **Custom ATS** — Kanban-style candidate pipelines with configurable
   stages per job, stage-gate actions, and candidate activity histories.
5. **Calendar Checker** — Direct OAuth sync with interviewers' Google
   Calendars, running real-time availability checks against working hours
   and busy slots to prevent double-booking.
6. **Form-Like Slot Fixing Link** — Public, lightweight booking page
   (`/schedule/[token]`) allowing candidates to pick an interviewer's open
   slot, automatically generating a Google Meet link and calendar entry
   upon confirmation.
7. **WhatsApp Integration (With Real-User Safety Gate)** — Dispatches
   interview links and status notifications via WhatsApp. **Safety Gate:**
   messages trigger only after candidate phone verification or explicit
   recruiter action, blocking unauthorized dispatch or spam loops.

**Core Tables:**
```sql
jobs(id, org_id, title, department_id, description, skills_required jsonb,
     min_experience_years, status, custom_stages jsonb, hiring_manager_id,
     created_at, updated_at)
candidates(id, org_id, full_name, email, phone, is_phone_verified,
           resume_file_id, parsed_skills jsonb, parsed_experience jsonb,
           raw_resume_text text, created_at)
applications(id, org_id, job_id, candidate_id, current_stage,
             match_score numeric, match_summary jsonb, notes text,
             created_at, updated_at)
interviewer_calendars(id, org_id, user_id, provider, access_token,
                       refresh_token, token_expiry, working_hours jsonb,
                       created_at)
interview_booking_links(id, org_id, application_id, interviewer_id, token,
                         duration_minutes, is_used, expires_at, created_at)
interviews(id, org_id, application_id, interviewer_id, scheduled_at,
           duration_minutes, meet_link, calendar_event_id, status,
           feedback_notes, feedback_rating, created_at)
whatsapp_messages(id, org_id, candidate_id, template_name, recipient_phone,
                   payload jsonb, status, error_message, sent_at, created_at)
```
**Directory:** `src/app/(dashboard)/recruitment/`,
`src/app/schedule/[token]/`, `src/modules/recruitment/`,
`src/db/schema/recruitment.ts`

**Emitted Events:** `recruitment.candidate.shortlisted`,
`recruitment.interview.scheduled`, `recruitment.candidate.hired`

---

### Module 5: Helpdesk (Round-Robin Support Engine)

Ticketing hub for internal IT, HR queries, and workplace operations
featuring automated load distribution.

- **Round-Robin Assignment Engine:** Automatically routes incoming tickets
  sequentially among assigned department category handlers using
  row-level transactional locking.
- **Presence & Shift Awareness:** Automatically skips agents marked away,
  on leave, or off-shift without breaking rotation order.
- **SLA & Escalation Matrices:** Priority countdown timers (Urgent, High,
  Medium, Low) flagging overdue items to department leads.

**Core Tables:**
```sql
helpdesk_categories(id, org_id, name, department_id,
                     last_assigned_user_id references users(id), created_at)
helpdesk_category_handlers(id, org_id, category_id, user_id, is_available,
                            order_index)
helpdesk_tickets(id, org_id, ticket_number, category_id, raised_by,
                  assigned_to references users(id), subject, description,
                  priority, status, created_at, resolved_at)
helpdesk_comments(id, org_id, ticket_id, user_id, message, is_internal,
                   created_at)
```
**Directory:** `src/app/(dashboard)/helpdesk/`, `src/modules/helpdesk/`,
`src/db/schema/helpdesk.ts`

**Emitted Events:** `helpdesk.ticket.created`, `helpdesk.ticket.assigned`,
`helpdesk.ticket.resolved`

---

### Module 6: Project Tracking

Operational execution layer managing project roadmaps, Kanban task boards,
milestones, and assignments.

- **Project & Task Hierarchy:** Scoped across
  Projects → Milestones → Tasks → Subtasks.
- **Multiple Visual Modes:** Real-time toggling between Kanban boards,
  list views, and milestone roadmaps.
- **Cross-Module Linkage:** Directly linkable to CRM Won Deals (client
  onboarding) or Helpdesk Tickets (escalated issues).

**Core Tables:**
```sql
pm_projects(id, org_id, name, description, status,
            lead_id references users(id), start_date, target_date, created_at)
pm_milestones(id, org_id, project_id, title, due_date, status)
pm_tasks(id, org_id, project_id, milestone_id, title, description,
         priority, status, assignee_id references users(id), due_date,
         created_at)
pm_task_comments(id, org_id, task_id, user_id references users(id), body,
                  created_at)
```
**Directory:** `src/app/(dashboard)/projects/`, `src/modules/projects/`,
`src/db/schema/projects.ts`

**Emitted Events:** `pm.task.assigned`, `pm.project.completed`

---

### Module 7: AI Assistant (Context & Permission Aware)

Copilot running over Groq (LLaMA) that performs operational task
automation and natural-language data retrieval.

- **Zero Privilege Escalation:** Executes actions strictly through the
  authenticated user's session context; prohibited from reading across
  organizational boundaries or bypassing RLS.
- **Two-Step Mutation Guard:** All read queries execute dynamically, while
  any destructive mutation (INSERT, UPDATE, DELETE) requires explicit
  confirmation via an interactive UI modal prior to execution.
- **Observability:** Every Groq call (intent parsing, JD generation, resume
  matching) is traced through **Langfuse** — prompt, input/output, latency,
  and cost logged per `org_id`. `developer` role has read access to traces;
  other roles do not.

**Directory:** `src/app/(dashboard)/ai/`, `src/modules/ai/`, `src/lib/ai/`

---

## 4. Cross-Module Event Bus Subscriptions

All cross-module business flows are decoupled via the system `events`
table and background worker drain:

| Source Module | Published Event | Target Module & Automated Reaction |
|---|---|---|
| Recruitment | `recruitment.candidate.hired` | HRMS: Provisions draft employee profile and initializes annual leave balances. |
| Recruitment | `recruitment.candidate.shortlisted` | Recruitment: Generates booking link and prepares candidate communication. |
| CRM | `crm.deal.won` | Projects: Automatically provisions a customer onboarding project and task checklist. |
| HRMS | `leave.request.approved` | HRMS: Deducts leave balances and updates daily attendance status. |
| Helpdesk | `helpdesk.ticket.created` | Helpdesk: Evaluates category handler pool and assigns via round-robin. |
| Projects | `pm.task.assigned` | Platform: Dispatches email and in-app notifications to assignee. |

---

## 5. Next.js App Router Structure

```
├── drizzle/                          # Migration SQL output files
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (auth)/                   # Login, register, password reset, invites
│   │   ├── (dashboard)/              # Authenticated workspace
│   │   │   ├── hrms/                 # Module 1: HRMS
│   │   │   ├── crm/                  # Module 2: CRM & Developer Mode
│   │   │   ├── analytics/            # Module 3: Metabase Analytics
│   │   │   ├── recruitment/          # Module 4: Recruitment & ATS
│   │   │   ├── helpdesk/             # Module 5: Helpdesk & Round-Robin
│   │   │   ├── projects/             # Module 6: Project Tracking
│   │   │   ├── ai/                   # Module 7: AI Assistant Copilot
│   │   │   └── settings/             # Company settings & members
│   │   ├── schedule/[token]/         # Module 4: Public booking portal
│   │   ├── api/                      # Webhooks (Google, Resend, WhatsApp)
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/                   # shadcn/ui and shared UI components
│   ├── db/
│   │   ├── index.ts                  # Drizzle ORM client instance
│   │   └── schema/                   # Modular schema definitions
│   │       ├── platform.ts           # Module 0
│   │       ├── hrms.ts               # Module 1
│   │       ├── crm.ts                # Module 2
│   │       ├── analytics.ts          # Module 3
│   │       ├── recruitment.ts        # Module 4
│   │       ├── helpdesk.ts           # Module 5
│   │       ├── projects.ts           # Module 6
│   │       └── index.ts              # Aggregated schema export
│   ├── lib/
│   │   ├── auth/                     # Supabase SSR session helpers
│   │   ├── events/                   # Event publisher & subscribers
│   │   ├── groq.ts                   # Groq LLaMA client
│   │   └── google-calendar.ts        # Google Calendar API integration
│   ├── modules/                      # Domain-specific Server Actions & services
│   └── types/                        # Global TypeScript interfaces
├── drizzle.config.ts
├── package.json
└── tsconfig.json
```

---

## 6. Coding & Development Standards

- **Server Actions for Mutations:** Mutations run via Server Actions
  validating payloads through Zod schemas.
- **Uniform Action Responses:** Every action must return a consistent
  typed structure:
  ```typescript
  type ActionResponse<T> =
    | { success: true; data: T }
    | { success: false; error: string; fieldErrors?: Record<string, string[]> };
  ```
- **Naming Conventions:**
  - Database tables and columns: `snake_case`
  - TypeScript variables and functions: `camelCase`
  - React Components and Types: `PascalCase`
  - File paths: `kebab-case`
  - Event Types: `module.entity.action`

---

## 7. What NOT to Build

| Item | Reason |
|---|---|
| Multi-Tier Agency Hierarchy | Single organization tenancy only. |
| Client-Side DB Mutations | Browser components cannot mutate tables directly; all mutations go through Server Actions. |
| Standalone Microservices | Maintain a single full-stack deployable monolith. |
| Complex Unbounded Visual Workflow Builders | Predefined asynchronous event recipes only. |
