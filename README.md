# Atllanta

AI-powered resume-to-JD matching for HR teams and staffing agencies — with interview scheduling, WhatsApp outreach, and a roadmap that grows into a modular HRMS + CRM suite.

## Stack

- **Frontend:** vanilla HTML/CSS/JS (no build step), Supabase JS via CDN
- **Backend:** Vercel serverless functions (`/api`)
- **Database & auth:** Supabase (Postgres + Auth + RLS)
- **AI matching:** Groq (`llama-3.3-70b-versatile`)

## Architecture

Multi-tenant from day one:

```
organizations ──< clients ──< jobs ──< applications >── candidates
      │                                     │
      └──< memberships (auth.users)         └── match_score / stage
      └──< credit_ledger
```

- **Direct orgs** get one auto-created self-client (DB trigger `trg_create_self_client`).
- **Agency orgs** manage many client companies; each client keeps its own login scope.
- All access is enforced by Postgres **Row Level Security** — the anon key in
  `js/config.js` is safe to ship.
- **Credits** meter resume-JD matches (1 credit each) via `credit_ledger`,
  with `soft_bill` (default) or `hard_stop` overage modes per org.

## Project layout

```
api/match.js       Groq scoring endpoint (auth-checked, credit-metered)
api/health.js      Health check
lib/supabaseServer.js  Service-role client for API functions
index.html         App shell: 64px icon rail + six views
css/app.css        Styles
js/config.js       Public Supabase URL + anon key
js/app.js          All views: Jobs, Candidates, Interviews, Chat, Re-score, Analytics
supabase/migrations/   Schema (already applied to the live project)
supabase/seed.sql      Demo orgs (Atllanta, BlueHire)
```

## Environment variables (Vercel → Settings → Environment Variables)

| Name | Purpose |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access for `/api` (never in frontend) |
| `GROQ_API_KEY` | Resume-JD matching |
| `SUPABASE_URL` | Optional — defaults to the Atllanta project URL |

## Run locally

```bash
npm install
npx vercel dev
```

## Deploy

Push to `main` with the Vercel GitHub integration connected, or:

```bash
npx vercel --prod
```

## First login

Create a user in Supabase Dashboard → Authentication → Users, then link them:

```sql
insert into memberships (user_id, organization_id, client_id, role)
select '<auth-user-uuid>', o.id, c.id, 'client_admin'
from organizations o join clients c on c.organization_id = o.id
where o.name = 'Atllanta Pvt Ltd';
```

## Roadmap

| Phase | Scope |
|---|---|
| −1 ✅ | Multi-tenant schema, RLS, auth, credits foundation |
| 0 | Resume filter + candidate contact management (this app) |
| 1 | AI-generated candidate-specific questions + async video responses |
| 2 | Client CRM (agency deal/contract management) |
| 3 | WhatsApp Business API (paid), built-in chat threading |
| 4 | Candidate Nurture CRM |
| 5 | HRMS: directory, attendance, leave, performance (payroll via 3rd-party API) |
| 6 | General-purpose CRM (long-term) |
