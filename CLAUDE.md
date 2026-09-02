# CLAUDE.md — Atllanta (Lean Session Memory)

> Kept deliberately short so it costs few tokens per session. The exhaustive blueprint (full schema, design tokens, event recipes, phase-by-phase plan) lives in **`docs/HANDOVER.md`** — read it only when you need that depth. **When docs and repo disagree, the repo wins.**

---

## 1. What Atllanta Is

A **Business Operating System** — one platform connecting people, customers, work, and operations under shared identity, AI, search, workflows, and design. It began as a CV-to-JD matching + interview scheduling tool (Groq LLM) and is expanding into a full Business OS, with recruitment as the core differentiator under the **People** app.

Pitch: *Companies come for the AI hiring tool, stay for the employee management platform.*

## 2. Current State (update this section as work lands)

Well past Phase 0. Substantially built out beyond the original recruitment-only scope:

- **`api/`** — 13 Vercel serverless functions (kept ≤12-function limit by consolidation): matching, resume/JD parsing, ai-query, bulk-import, create-org, google-auth, schedule, reports, send-notification, event-processor, extract-candidate, screen-job.
- **`supabase/migrations/`** — 14 migrations = the real schema (foundation multi-tenant, interview scheduling + per-candidate slots, Google OAuth/invitations, business-OS platform, expense tracking, helpdesk, asset tracking, announcements).
- **`views/`** — recruitment, employees, attendance, leave, **plus** finance, helpdesk, announcements, documents, people (assets/letters/lifecycle), audit, ai, admin, settings, onboarding, reports.
- **Infra** — Vercel + Supabase wired; PWA (`manifest.json`, `sw.js`); Playwright tests in `tests/`.

## 3. Source-of-Truth Files (read these, don't duplicate them here)

| Need | Look at |
|------|---------|
| DB schema / tables / RLS | `supabase/migrations/*.sql` |
| Design tokens (colors, spacing, type) | `css/tokens.css` |
| File layout | actual `api/`, `js/`, `views/`, `css/` trees |
| API surface | files in `api/` |
| Full architecture rationale & phase plan | `docs/HANDOVER.md` |

## 4. Stack (hard rules)

- DB / Auth / Storage: **Supabase (Postgres 15+)**. Hosting: **Vercel**. AI: **Groq (LLaMA)**. Email: **Resend**.
- Frontend: **vanilla JS + HTML + CSS**. **No React/Next/TypeScript/Tailwind** unless Sachin explicitly asks.
- Supabase JS client via **CDN**, not npm. No npm packages for what vanilla JS can do.
- Zero monthly cost during build/pilot — free tiers only.

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

Payroll, visual workflow builder, custom-permissions UI (four fixed roles: owner/admin/manager/member), native mobile app (PWA first), CRM module, microservices, Elasticsearch, React/Next migration. Rationale in `docs/HANDOVER.md §15`.
