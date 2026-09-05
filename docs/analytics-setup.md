# Analytics — admin setup checklist

One-time setup to enable the Analytics module (self-serve BI) for an org. The
database migrations are already applied to the live Supabase project; this
covers the environment and per-org configuration an admin controls.

## 1. Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Needed for | Notes |
|----------|-----------|-------|
| `SUPABASE_JWT_SECRET` | **Scheduled reports & alerts** | The daily cron mints a short-lived JWT for each report's creator so the query runs under that user's RLS. Copy from Supabase → Settings → API → **JWT Secret**. **Without it, scheduled reports/alerts safely do nothing** (no errors) — everything else works. |
| `GROQ_API_KEY` | **AI ask** (plain-English → query) | Already set (the AI assistant uses it). |
| `RESEND_API_KEY` | Email delivery of reports/alerts | Already set (notification emails use it). |
| `RESEND_FROM` | Sender address on emails | Optional; defaults to `Atllanta <notifications@atllanta.app>`. |
| `CRON_SECRET` | Authorizes the daily cron endpoint | Already set. |

After adding `SUPABASE_JWT_SECRET`, redeploy so the cron picks it up.

The daily cron (`vercel.json` → `/api/event-processor`, `0 3 * * *`) is what
evaluates due reports/alerts, so delivery happens around 03:00 UTC. Cadences:
daily / weekly / monthly.

## 2. Turn on the feature (per org)

- The **Analytics** module is a toggleable feature (Admin → access settings),
  the same way other modules are enabled/disabled.
- Default visibility is **managers & admins** (owner / admin / manager), the
  same gate as Reports. Give it to more roles there if wanted — row-level
  security still limits each person to the data they may see.

## 3. Access & data scope (how it stays safe)

- Every query — visual builder, AI ask, SQL editor, scheduled report — runs
  through the caller's Row-Level Security. A member sees only their own rows, a
  manager their team's, an admin the org's. There is no `service_role` read
  path.
- Scheduled reports/alerts are emailed to their **creator** at the creator's
  own data scope.

## 4. Quick smoke test after enabling

1. Open **Analytics** in the sidebar → **New question**.
2. Pick a data model (e.g. *CRM · Deals*), a measure (e.g. *Win rate %*), a
   group-by (e.g. *Owner*) → a chart renders.
3. Try **Ask AI**: e.g. "deals by stage".
4. **Save** the question, then open **🔔 Alerts** on it and create a daily
   schedule. (It will send on the next cron run, once `SUPABASE_JWT_SECRET` is
   set.)

## 5. Routes

- `analytics` — question & dashboard library
- `analytics/question` — question editor (visual + SQL)
- `analytics/dashboard` — a dashboard
