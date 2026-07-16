# CLAUDE.md — Atllanta project briefing

> This file is the single source of truth for any AI agent (Claude Code or otherwise) working on this repo. Read it fully before writing any code.

---

## What is Atllanta

Atllanta is an AI-powered resume-to-JD matching platform for HR teams and staffing agencies. It scores candidate resumes against job descriptions using LLMs, manages candidate pipelines, and handles outreach via WhatsApp deep links. It is designed to grow into a modular HRMS + CRM suite (like Tally's core-plus-modules model).

**Founder:** Sachin (GitHub: marcilinous). Background at WorkIndia. Also building a separate product called HireTrack.

**Competitive landscape:** Darwinbox, Keka — but Atllanta differentiates with autonomous AI-driven hiring workflows and a credit-metered matching engine.

---

## Tech stack (strict — do not change without explicit approval)

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Vanilla HTML + CSS + JS | No frameworks, no build step, no React, no bundlers |
| Backend | Vercel serverless functions | Files in `/api/*.js`, Node.js ESM |
| Database | Supabase (Postgres) | Project ID: `nburswxjpukntgdwuyme`, region: `ap-south-1` |
| Auth | Supabase Auth | Email/password, RLS enforced on every table |
| AI matching | Groq API | Model: `llama-3.3-70b-versatile` |
| Hosting | Vercel | Auto-deploy from `main` branch when connected |
| WhatsApp | `wa.me` deep links (free) | No paid Business API until Phase 3 |

**CDN imports in frontend:** Supabase JS is loaded via `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`. Do not npm-install it for the frontend.

**Server-side imports:** `@supabase/supabase-js` is in `package.json` for `/api` functions.

---

## Repository structure

```
atllanta/
├── CLAUDE.md                ← you are here
├── README.md
├── package.json             (ESM, type: "module")
├── vercel.json
├── .env.example
├── .gitignore
├── index.html               ← app shell: auth screen + 64px icon rail + 6 views
├── css/
│   └── app.css              ← all styles, no CSS framework
├── js/
│   ├── config.js            ← public SUPABASE_URL + SUPABASE_ANON_KEY (safe to ship)
│   └── app.js               ← all frontend logic, views, state management
├── api/
│   ├── health.js            ← GET /api/health
│   └── match.js             ← POST /api/match (Groq scoring, credit metering, auth-checked)
├── lib/
│   └── supabaseServer.js    ← service-role Supabase client for API functions
└── supabase/
    ├── migrations/
    │   └── 20260716071923_foundation_multi_tenant_schema.sql
    └── seed.sql
```

---

## Database schema

The live Supabase project already has this schema applied. **Do not re-run the foundation migration.** Add new migrations with sequential timestamps.

### Tables

**organizations** — top-level tenant
- `id` uuid PK, `name`, `org_type` ('direct' | 'agency')
- `plan_tier` ('starter' | 'growth' | 'agency_partner' | 'enterprise')
- `payment_status` ('trial' | 'active' | 'past_due' | 'cancelled')
- `trial_started_at`, `trial_ends_at`, `trial_candidate_cap`
- `credits_included_monthly`, `credits_balance`, `credit_overage_mode` ('soft_bill' | 'hard_stop')
- `commission_percent` (for agency referral revenue share)

**clients** — companies under an org
- `id` uuid PK, `organization_id` FK → organizations, `referred_by_agency_id` FK → organizations
- `name`, `is_self` boolean (true for auto-created direct-org client)

**memberships** — links auth.users to organizations + optional client scope
- `user_id` FK → auth.users, `organization_id` FK, `client_id` FK (nullable)
- `role` ('super_admin' | 'agency_admin' | 'client_admin' | 'client_member')
- unique(user_id, organization_id, client_id)

**jobs** — `client_id` FK, `title`, `description`, `jd_raw_text`, `status` ('open' | 'paused' | 'closed')

**candidates** — `client_id` FK, `name`, `email`, `phone`, `resume_raw_text`, `resume_file_url`, `source`

**applications** — junction of job × candidate
- `job_id` FK, `candidate_id` FK, unique(job_id, candidate_id)
- `match_score` numeric, `match_summary`, `match_raw_response` jsonb
- `stage` ('new' | 'screened' | 'shortlisted' | 'interview_scheduled' | 'interviewed' | 'offered' | 'hired' | 'rejected')
- `credits_charged` int (default 1)

**credit_ledger** — audit log for credit changes
- `organization_id` FK, `action_type` ('resume_match' | 'whatsapp_message' | 'topup' | 'monthly_reset')
- `credits_delta` int, `reference_id` uuid

### Key mechanics

- **Self-client trigger:** `trg_create_self_client` — when a `direct` org is inserted, a client row with `is_self = true` is auto-created.
- **RLS:** All tables have RLS enabled. Access is scoped through `auth_accessible_client_ids()` which checks the current user's membership + role.
- **Credit metering:** `/api/match.js` deducts 1 credit per match, logs it to `credit_ledger`, and respects `credit_overage_mode`.

### Seed data (already in production)

| Organization | Type | Tier | Clients |
|---|---|---|---|
| TechNova Pvt Ltd | direct | starter | TechNova Pvt Ltd (self) |
| BlueHire Consultants | agency | agency_partner | Meridian Retail Ltd |

---

## Environment variables

These are set in **Vercel → Project → Settings → Environment Variables** (never commit real values):

| Variable | Where used | Notes |
|---|---|---|
| `SUPABASE_URL` | `/api` functions | Defaults to `https://nburswxjpukntgdwuyme.supabase.co` in code |
| `SUPABASE_SERVICE_ROLE_KEY` | `/api` functions | **Required.** Server-only. Never expose to frontend. |
| `GROQ_API_KEY` | `/api/match.js` | **Required** for AI scoring to work. |

The **anon key** is in `js/config.js` and is safe to ship — RLS enforces all access.

---

## Git workflow

- Branch: `main` only (for now)
- Commit messages: imperative tense, prefix with phase if relevant (e.g. `phase-0: add resume upload endpoint`)
- Push to `main` triggers Vercel auto-deploy (once GitHub integration is connected)
- Remote: `https://github.com/marcilinous/atllanta.git`

To set up:
```bash
git remote add origin https://github.com/marcilinous/atllanta.git
git push -u origin main
```

---

## Coding conventions

### Frontend (js/app.js, index.html, css/app.css)

- **No frameworks.** Vanilla JS with ES module imports from CDN.
- State lives in the `S` object at the top of `app.js`.
- Each view is a function that receives the `root` DOM node and renders into it: `function jobs(root) { ... }`.
- Navigation via `data-view` attributes on `.rail-btn` buttons.
- Use the `el(tag, className, innerHTML)` helper for DOM creation.
- Use `esc()` for all user-supplied text rendered as HTML.
- `toast(msg)` for notifications, `openModal(title, bodyNode)` / `closeModal()` for dialogs.
- All Supabase queries from frontend use the anon client (`sb`) which is RLS-scoped.
- **Signature design element:** the score-ring (conic-gradient circle showing match score 0-100, colored teal/amber/brick).

### Backend (api/*.js)

- Vercel serverless functions, ESM (`export default async function handler(req, res)`).
- Always verify the user's Supabase access token from `Authorization: Bearer <token>`.
- Use the service-role client from `lib/supabaseServer.js` for writes.
- Check membership/role before allowing operations on a client's data.
- Return JSON, appropriate HTTP status codes.

### CSS (css/app.css)

- CSS custom properties for all colors/spacing (defined in `:root`).
- No CSS framework. No Tailwind.
- Fonts: `Bricolage Grotesque` (display/headings), `Inter` (body).
- Palette: ink (#131C2B), paper (#F7F6F2), marigold (#E8890C), teal (#0F766E), brick (#B42318).
- Mobile-responsive, `prefers-reduced-motion` respected.

### New migrations

- File name format: `YYYYMMDDHHMMSS_descriptive_name.sql`
- Place in `supabase/migrations/`
- Always add RLS policies for new tables
- Never modify the existing foundation migration file — only add new ones

---

## Product roadmap & current status

### ✅ Done (Phase -1 + Phase 0 foundation)
- Multi-tenant schema with RLS
- Auth (email/password via Supabase)
- Six-view app shell (Jobs, Candidates, Interviews, Chat, Re-score, Analytics)
- Groq-powered resume-JD matching with credit metering
- WhatsApp outreach via wa.me deep links
- Analytics dashboard (funnel, score distribution, per-job breakdown)

### 🔜 Phase 0 remaining work
- Resume file upload (parse PDF/DOCX → `resume_raw_text`)
- JD file upload (parse PDF/DOCX → `jd_raw_text`)
- Bulk resume upload
- Candidate search/filter improvements
- Job edit and close flows
- Confirmation-link tracking for WhatsApp messages (embed trackable link, detect response without webhooks)

### Phase 1 — AI interview questions
- AI generates candidate-specific interview questions from the resume + JD match
- Candidate receives questions via link (not AI voice/video — candidates distrust robotic interviewers)
- Async video responses from candidates
- HR offers unlimited time slots for scheduling (not capped at 2-3)
- Question bank format (mix of AI-generated + manual)

### Phase 2 — Client CRM (agency-facing)
- Deal/contract management for agencies
- Agency partner model: agencies earn commission on client subscriptions
- Each client company retains independent login
- Agency extension ceiling scales with payment commitment

### Phase 3 — WhatsApp Business API (paid)
- Replace wa.me deep links with proper Business API
- Built-in chat threading
- WhatsApp message credits in credit_ledger

### Phase 4 — Candidate Nurture CRM

### Phase 5 — HRMS
- Employee directory, attendance, leave, performance
- Payroll via third-party API integration (not built from scratch)

### Phase 6 — General CRM (long-term stretch goal, do not architect for now)

---

## Design principles (from Sachin)

1. **Simple enough for anyone to operate without training.** Every action reachable in one or two clicks. Nothing hidden behind multiple menus.
2. **Clean per-stage separation via sidebar navigation.** Not everything crammed onto one page.
3. **64px icon-only sidebar** with hover tooltips (not always-visible labels).
4. **Profile section** at top of sidebar with login/logout.
5. **Credit metering is transparent** — the user always sees their remaining credits.
6. **Free tier first** — build on free tiers of Groq, Supabase, Vercel, Gmail API. Cost comes later.
7. **RAG over per-tenant vector stores** (future) — not self-hosted local LLMs. Keep candidate data private while the model improves over time.

---

## Common tasks

### Add a new API endpoint
1. Create `api/your-endpoint.js` with `export default async function handler(req, res)`
2. Verify auth token, check membership, do work with service-role client
3. Test locally with `npx vercel dev`

### Add a new view
1. Add a `<button class="rail-btn" data-view="viewname">` with SVG icon in `index.html`
2. Add the view function in `js/app.js` and register it in the `VIEWS` object
3. Add title in `TITLES` object

### Add a new database table
1. Create a new migration file in `supabase/migrations/`
2. Include RLS enable + policies
3. Apply via Supabase dashboard or MCP tools

### Test the match endpoint locally
```bash
curl -X POST http://localhost:3000/api/match \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <supabase-access-token>" \
  -d '{"job_id": "<uuid>", "candidate_id": "<uuid>"}'
```

---

## What NOT to do

- ❌ Do not introduce React, Vue, Svelte, or any frontend framework
- ❌ Do not add Tailwind, SASS, or any CSS preprocessor
- ❌ Do not add a bundler (webpack, vite, esbuild, etc.)
- ❌ Do not commit secrets or the service role key
- ❌ Do not modify the foundation migration — create new migration files
- ❌ Do not bypass RLS — all frontend queries use the anon key
- ❌ Do not build payroll from scratch (use third-party API when the time comes)
- ❌ Do not architect for Phase 6 (General CRM) yet
- ❌ Do not use AI voice/video interviews (candidates distrust them — use question bank format instead)
- ❌ Do not cap interview time slots at 2-3 (offer unlimited slots)
