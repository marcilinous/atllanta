# Atllanta context pack — read this first

**Purpose.** One session has one context window. This pack lets you work on Atllanta
**without reading the codebase**: read this file (≈5 minutes), then the one module
file you need. Everything else stays unread until a task actually requires it.

**Two stacks, one repo (from 2026-09-18).** Atllanta is migrating to Next.js +
TypeScript + Drizzle + Server Actions. `TRANSITION.md` holds the phase plan and the
current position — **read it first every session**. Production still runs the legacy
vanilla-JS app until Phase 8 retires it, and this pack describes that live app.

**Authority order.** For new-stack work: `CLAUDE.md` (the target) → `TRANSITION.md`
(what to build next) → `DESIGN.md`. For work on the live app:
`docs/legacy/CLAUDE-legacy.md` → `DESIGN.md` → this pack → the code. When code and a
higher file disagree, the higher file is the target and the code is the debt — say so
rather than quietly following the code.

---

## 1. What Atllanta is, in six lines

- A **multi-tenant Business OS**: one company = one `organization` row = one tenant.
- **Four business modules on one platform layer**: People/HRMS, Recruitment &
  Interview Automation, CRM, Analytics.
- **One deployment, one database.** Modular monolith, not services.
- **Vanilla JS + HTML + CSS** in the browser, **Supabase** (Postgres + Auth + Storage)
  for data, **Vercel** for hosting and 12 serverless functions, **Groq** for AI.
- **Tenants never mix.** Every business table carries `org_id` and is isolated by
  row-level security. A tenant's *workflow* differs through configuration rows, not
  through forked code (see §5).
- Growth assumption: the codebase and tenant count grow fast, so **context files are
  updated with the code, in the same commit**.

## 2. Map of the repo (as of v1.2.0)

```
index.html          the app shell: imports every view, registers every route, boots auth
login.html reset-password.html privacy.html terms.html schedule.html   standalone pages
css/     tokens.css base.css layout.css components.css      design system (see DESIGN.md)
js/      platform services in the browser (see platform.md)
views/   one folder per module area, one file per screen (see module files)
api/     12 Vercel serverless functions (see §4)
lib/     server-only helpers: supabaseServer.js aiGateway.js langfuse.js googleMeet.js
supabase/migrations/   107 applied migrations — see ops.md before adding one
tests/   node:test unit + guard tests, browser-verify.mjs, Playwright app-shell spec
docs/context/          this pack        docs/superpowers/   specs and plans
```

Size guide (lines): `views/` ≈18k across 60+ screens, `js/` ≈1.5k, `api/` ≈2.1k.
The largest single files are `views/settings/org.js` (839), `views/recruitment/jobs.js`
(648), `views/dashboard.js` (593). Nothing else is above 600.

## 3. The module files

| File | Covers | Read it when |
|---|---|---|
| `platform.md` | auth, tenancy/RLS, roles, feature gating, routing, events, notifications, audit, files, search, UI helpers, public API layer | any task — this is the shared floor |
| `people.md` | HRMS: directory, attendance, leave, assets, expenses, helpdesk, announcements, documents, onboarding | People work |
| `recruitment.md` | jobs, candidates, applications, matching, screening, interviews, scheduling links | Hiring work |
| `crm.md` | leads, opportunities, partners, field sales, PJP, events, report imports, sales analytics | CRM work |
| `analytics.md` | dashboards, questions, alerts, the legacy `views/reports/*` screens | Analytics work |
| `ai.md` | the AI gateway, token quotas, bot check, Langfuse, assistant roadmap | anything that calls a model |
| `ops.md` | environments, releases, promotion, migrations, tests, env vars, cron, known debt | shipping anything |
| `journal.md` | dated log: what changed, what was learnt, which file to re-read | start of a session, and at the end of your work |

## 4. The 12 serverless functions

Vercel's plan caps this project at **12 functions — the cap is reached.** A new
endpoint means merging or replacing an existing one.

| Endpoint | Purpose |
|---|---|
| `api/parse-resume.js` | PDF/DOCX → text (free); `?action=parse-jd` parses a JD with AI |
| `api/extract-candidate.js` | resume text → name/email/phone/summary (AI) |
| `api/match.js` | score one candidate against one job (AI) |
| `api/screen-job.js` | batch scoring: AI (≤50/run) or free keyword/TF-IDF |
| `api/schedule.js` | public candidate self-scheduling by token (no login) |
| `api/google-auth.js` | per-user Google OAuth for Calendar/Meet |
| `api/event-processor.js` | drains the event queue; also the daily cron target |
| `api/create-org.js` | team administration: invite a member |
| `api/bulk-import.js` | bulk row import (employees and similar) |
| `api/ai-query.js` | **disabled (503)** until the assistant returns in v1.4.0 |

Every function: ESM, `export default async function handler(req, res)`, service-role
Supabase client from `lib/supabaseServer.js`, and it must resolve the caller and check
`org_id` itself — the service role bypasses RLS.

## 5. How one tenant differs from another (without forking code)

This is the product's core claim, so know it exactly. A tenant is customised through
**rows, not branches**:

- **Module visibility:** `feature_access` (per role and per user, allow/deny), plus two
  platform gates on `organizations`: `crm_enabled` and `partner_crm_enabled`. Org
  admins bypass per-role rules but **never** the platform gates (`js/features.js`).
- **Workflow configuration tables:** `leave_types`, `work_schedules`, `work_locations`,
  `holidays`, `expense_categories`, `helpdesk_categories` (+ handlers),
  `crm_pipeline_stages`, `webhook_endpoints`, `api_keys`.
- **Org-level settings:** `organizations` carries `timezone`, `currency`,
  `date_format`, `logo_url`, `plan_tier`, `payment_status`, AI quota rows
  (`ai_org_quotas`, `ai_user_limits`).
- **Never** branch on a tenant's name or id in code. If a tenant needs different
  behaviour, it needs a configuration row and a documented default.

The one historical exception is the RTcompu partner vertical (`crm_*` partner screens),
gated by `partner_crm_enabled`. Treat it as a *pack*, not a special case: new verticals
follow the same shape.

## 6. Working rules for a single context window

1. **Never read the whole codebase.** Read this file + the module file. Open source
   files only for the screens or endpoints you are changing.
2. **Search, don't browse.** `grep` for a route name, a table name, or a function name;
   the module files tell you which name to grep for.
3. **Check the database, don't guess it.** The schema is live; the migrations folder is
   history. Use a read-only SQL query for facts about columns, policies and functions.
4. **Follow the ladder before writing code:** an existing `js/ui.js` helper → the
   stdlib → a platform service → new code.
5. **Every mutation publishes an event** (`module.entity.action`) and, where it matters,
   writes an audit row.
6. **Every Supabase call checks `error`.** Loads that fail return 503, missing rows 404,
   failed writes 500 — never a silent success.
7. **Escape everything user-supplied** with `esc()` before it reaches `innerHTML`.
8. **Tests are the gate, not the browser.** `npm run test:unit` must pass before any
   commit; `tests/browser-verify.mjs` runs against a deployed URL.
9. **The owner merges and promotes.** You never merge a PR or promote a deployment
   yourself, and you never apply production SQL without an explicit go-ahead.
10. **Update this pack in the same commit as the code.** See §7.

## 7. Keeping the pack current (the rule that keeps it useful)

When you finish a piece of work, before you commit:

- Did a **screen, endpoint, table, function, event or configuration key** change?
  → update the matching module file's tables in the same commit.
- Did you learn something a future session would otherwise rediscover the hard way
  (a gotcha, a tool quirk, a decision and its reason)? → add a dated line to
  `journal.md`. One line, with the file to look at.
- Did a **new capability, skill or integration** arrive (a new AI feature, a new
  external service, a new module)? → give it its own file in `docs/context/` and add a
  row to §3 here. Do not grow one file past ~250 lines; split it instead.
- Did an **architectural decision** get made? → record it in `journal.md` with the
  reason and what it costs if wrong. Decisions without reasons get reversed by
  accident.

`docs/` is excluded from deployments (`.vercelignore`), so this pack never ships to
users and never affects the bundle.

## 8. Current state (keep this section accurate)

- **Stack transition started 2026-09-18.** Target stack and module design:
  `CLAUDE.md`. Phase ladder, verified baseline and open owner decisions:
  `TRANSITION.md`. Legacy rules: `docs/legacy/CLAUDE-legacy.md`. The two version
  lines are independent — legacy ships `vX.Y.Z`, the new stack climbs `v0.x`.

- **Live version:** v1.1.0 in production; **v1.2.0** (AI gateway, recruitment AI on
  token quotas) is merged-pending — PR #104, awaiting the owner's merge and promotion.
- **Next:** v1.3.0 platform console + org AI usage screens + "AI today" indicator;
  v1.4.0 the AI assistant returns, scoped to what the user can see.
- **Production branch:** `claude/gstack-skill-install-chnb41` → `atllanta.vercel.app`,
  live only after the owner promotes a build in Vercel.
- **Open debt:** see `ops.md` §7 (security advisor findings, legacy credits columns,
  `views/reports/*` awaiting the Analytics module).
