# CLAUDE.md — Atllanta (Lean Session Memory)

> Kept deliberately short so it costs few tokens per session. The exhaustive blueprint (full schema, design tokens, event recipes, phase-by-phase plan) lives in **`docs/HANDOVER.md`** — read it only when you need that depth. **When docs and repo disagree, the repo wins.**

---

## 1. What Atllanta Is

A **Business Operating System** — one platform connecting people, customers, work, and operations under shared identity, AI, search, workflows, and design. It began as a CV-to-JD matching + interview scheduling tool (Groq LLM) and is expanding into a full Business OS, with recruitment as the core differentiator under the **People** app.

Pitch: *Companies come for the AI hiring tool, stay for the employee management platform.*

## 2. Current State (update this section as work lands)

Well past Phase 0. Substantially built out beyond the original recruitment-only scope:

- **`api/`** — 12 Vercel serverless functions (kept ≤12-function limit by consolidation): matching, resume/JD parsing, ai-query, bulk-import, create-org, google-auth, schedule, reports, send-notification, event-processor, extract-candidate, screen-job.
- **`supabase/migrations/`** — ~49 migrations = the real schema (foundation multi-tenant, interview scheduling, Google OAuth/invitations, business-OS platform, expense tracking, helpdesk, asset tracking, announcements, **+ the whole CRM/partner-sales vertical**).
- **`views/`** — recruitment, employees, attendance, leave, finance, helpdesk, announcements, documents, people (assets/letters/lifecycle), audit, ai, admin, settings, onboarding, reports, **`views/analytics/` (Metabase-style self-serve BI)**, **plus `views/crm/` (24 files)**.
- **Infra** — Vercel + Supabase wired (project `nburswxjpukntgdwuyme` = `atllanta`); PWA (`manifest.json`, `sw.js`); Playwright tests in `tests/`. Live-app changes verified against the real Supabase project, additive migrations applied there directly.

### Analytics (self-serve BI, Metabase-inspired)

Gated by the `analytics` feature (admins toggle per-org; defaults to managers/admins, sidebar `data-role="manager"`). Two org-scoped tables — `analytics_questions` (a saved query: `spec` JSONB + `viz`, `mode` builder|sql) and `analytics_dashboards` (`cards` JSONB = ordered {question_id,w} grid). Model catalogue in `js/analytics/models.js`; the **visual builder** aggregates RLS-scoped rows client-side (`js/analytics/engine.js`), the **SQL mode** runs through `analytics_run_sql(text,int)` — a **SECURITY INVOKER** RPC (RLS stays enforced) guarded to a single read-only SELECT/WITH, catalog-blocked, timeout + row-capped. Six chart types rendered with **Apache ECharts** (lazy-loaded from the jsdelivr CDN in `js/analytics/charts.js`; `renderChart(container, viz, result, {theme})`), with a per-question **mono / color** theme toggle; `table` + `number` stay HTML. Routes `analytics`, `analytics/question`, `analytics/dashboard`. **No new Vercel function** (stayed at 12/12).

### CRM / partner-sales vertical (tenant **RTcompu**, org `e8845b88-…`)

A telecalling/field-sales CRM gated to enabled orgs (RTcompu). Data comes from imported partner reports keyed on Site ID (`crm_report_*`), materialised into `crm_opportunity_features_mv` (per-partner facts: base size, billed rupees, last visit/activation, tier). All CRM reads go through `SECURITY DEFINER` RPCs that re-apply level scoping (own / reports / admin via `crm_report_ids()`, `crm_user_is_org_admin()`); MV/helpers revoked from `anon`. Key surfaces:

- **PJP (`views/crm/pjp.js`)** — the one field-visit block ("Who to visit" is a tab/drill-down of it, not a separate menu card). Month calendar (route-map planner, **not** the attendance heatmap look), plan an area per day, **lock the month** (`crm_pjp_month_locks`, DB-enforced on day-plan write policies). Open a planned day → partner list; each row has a **Log visit** button → `crm/visits?account=…` (prefilled).
- **Gap prediction** (`crm_pjp_gap_accounts`) — "who to visit first": `gap = expected − actual`, `expected = users × same-place peer-median business-per-user`. Peer group finest-that-clears-8-peers: **pincode → billing_city → district → region**, ≥25-user benchmark floor. Fact worklist (`crm_partner_actions`, reasons: tss_overdue/stopped_buying/base_no_buy/not_visited) still exists, ordered by billed rupees.
- **Visits** (`views/crm/visits.js`) — GPS + selfie + offline outbox; captures **Tally serial** (`tally_serial` / `tally_serial_status` ∈ shared/not_shared/no_licence).
- **Pending:** partner-wise **pincode CSV** from Sachin → load into `crm_accounts.pincode` to sharpen peer benchmarks from city to pincode level (column exists, nullable).

## 3. Source-of-Truth Files (read these, don't duplicate them here)

| Need | Look at |
|------|---------|
| DB schema / tables / RLS | `supabase/migrations/*.sql` |
| Design tokens (colors, spacing, type) | `css/tokens.css` |
| File layout | actual `api/`, `js/`, `views/`, `css/` trees |
| API surface | files in `api/` |
| Architecture diagram (interactive HTML) | `docs/architecture.html` (generated by the archify skill) |
| Full architecture rationale & phase plan | `docs/HANDOVER.md` |

**Skills:** `archify` (`.claude/skills/archify` → `.agents/skills/archify`) generates interactive HTML diagrams (architecture/workflow/sequence/dataflow/lifecycle) from prose, Mermaid, or repo code — `node bin/archify.mjs validate|deliver <type> <spec.json> <out.html> --quality showcase`.

## 4. Stack

- DB / Auth / Storage: **Supabase (Postgres 15+)**. Hosting: **Vercel**. AI: **Groq (LLaMA)**. Email: **Resend**.
- **No language/framework lock-in** (Sachin, 2026-09: "no limitation on coding languages — use multiple if required; goal is a world-class Business OS"). React/Next/TypeScript/Tailwind, other backend languages (Python/Go/… as Vercel functions or build tools), npm packages, real charting/UI libs, and a build step are all fair game **where they earn their place**. The app today is vanilla JS + HTML + CSS loading the Supabase client via CDN.
- **Adopt incrementally, don't rewrite what works.** New modules/features may use the best tool for the job; migrate existing vanilla views only when there's a concrete reason, not wholesale. Keep the app one deployable unit (see §5).
- Still true: **zero monthly cost** during build/pilot (free tiers), and the **Vercel 12-function limit** (consolidate; prefer client + RPC over new functions).
- The §5 architecture rules (modular monolith, RLS, multi-tenant, events) are **unchanged and still non-negotiable** — language freedom does not relax them.

## 5. Architecture Rules (non-negotiable)

1. **Modular monolith.** One Supabase project, one Vercel deploy. Modules separated by folders + schema boundaries, not services.
2. **Modules own their data.** Cross-module access goes through APIs/events, never direct table reads.
3. **Every mutation publishes an event** — `module.entity.action` (e.g. `recruitment.candidate.shortlisted`).
4. **All data access goes through RLS.** Never put the `service_role` key in frontend or in the AI path — if the user can't see it in the UI, the AI can't either.
5. **Multi-tenant:** every org-scoped table has `org_id`, isolated by RLS keyed on the authed user's `org_id`. Cross-tenant isolation must always hold.
6. **Every Supabase call checks `error`:** `const { data, error } = await supabase...`.

## 6. Conventions

- Tables: `snake_case` plural. Columns: `snake_case`. JS files: `kebab-case`. JS functions: `camelCase`. CSS classes: `kebab-case`. Events: `module.entity.action`.
- `const` by default, `let` when needed, never `var`. `async/await` over `.then()`. Early returns over nesting.
- Commits: imperative, short. Branches: `feature/…`, `fix/…`, `chore/…`.

## 7. Do NOT Build (until named trigger)

Payroll, visual workflow builder, custom-permissions UI (four fixed roles: owner/admin/manager/member), native mobile app (PWA first), microservices, Elasticsearch. Rationale in `docs/HANDOVER.md §15`. *(No longer deferred: framework choice — see §4. Multiple languages are fine **within the modular monolith**; splitting into separate services is still the deferred "microservices" item, a distinct architectural call.)*
