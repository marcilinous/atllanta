# Journal — what changed, what we learnt

Newest first. One entry per piece of work that a future session would otherwise have to
rediscover. Keep entries short: **what changed → where to look → what it costs if
ignored.** Decisions record their reason; without it, they get reversed by accident.

Add an entry when you: finish a release, make an architectural decision, hit a gotcha
that cost you more than ten minutes, or add a capability that deserves its own context
file.

---

## 2026-09-18 — Stack transition adopted (Next.js + Drizzle)

- The owner's target architecture (`CLAUDE.md`) and migration tracker
  (`TRANSITION.md`) are now in the repo. The previous vanilla-JS charter moved to
  `docs/legacy/CLAUDE-legacy.md` and still governs the live app until Phase 8.
- **Both stacks will share one Supabase database**, so no schema change may break the
  legacy screens while they are still serving users.
- Baseline was verified against the live database before planning: CRM, HRMS,
  Recruitment, Analytics and Helpdesk already exist (the tracker assumed some were
  new), tenancy is already `org_id`, and the real migration weight is CRM —
  6,132 partners and 83,453 report rows against negligible HRMS/recruitment data.
- Six decisions are waiting on the owner (freeze depth, partner-vertical strategy,
  naming, `feature_access` vs `org_modules`, cutover shape, and whether v1.2.0 ships
  before the freeze). They are logged in `TRANSITION.md` → Decisions & Blockers.

## 2026-09-18 — Context pack created

- `docs/context/` now holds the working instructions and one file per module
  (`index.md`, `platform.md`, `people.md`, `recruitment.md`, `crm.md`, `analytics.md`,
  `ai.md`, `ops.md`, this journal). Read `index.md` + one module file instead of the
  codebase.
- **Rule:** code change and context change land in the same commit. A pack that drifts is
  worse than no pack, because it is trusted.
- Facts in the pack were taken from the live database and the current branch, not from
  memory: 64 tables, 107 migrations, 12 serverless functions (the Vercel cap), ~18k lines
  across 60+ screens.

## 2026-09-17/18 — v1.2.0: the AI gateway (PR #104, pending promotion)

- Every Groq call now goes through `lib/aiGateway.js`; recruitment AI counts tokens
  against org/user quotas and **credits are no longer deducted**. See `ai.md`.
- **Two cross-tenant holes closed:** matching never checked the candidate's org, and JD
  parsing could write to another org's job. Both are now checked before any write or AI
  call. Lesson: an `api/` endpoint uses the service role, so RLS will not save it — every
  endpoint checks `org_id` itself.
- `.single()` on zero rows returns a PGRST116 **error**, so an error-check placed before
  the not-found check turns "missing" into 503. Use `.maybeSingle()` for lookups.
- Batch AI flows stop after the first refusal *or failure*: dozens of fast failures
  otherwise trip the bot check's calls-per-minute rule and notify admins for an outage
  that was not the user's fault.
- Bulk upload survives an exhausted quota: text extraction is free, so the candidate is
  still created from the file name. Users can import all day and score later.
- Groq's raw error text stays server-side; it can name our Groq account.

## 2026-09-17 — v1.1.0: AI usage and quota database layer

- Tables, quota/bot-check functions and seeding applied to production
  (migration `20260917155318`). Existing orgs 2,000,000 tokens/month, 200,000/day per
  user; **new orgs 2,000/month** until raised.
- Tests that run as the owner cannot catch missing grants — assert privileges explicitly
  with `has_function_privilege` / `has_table_privilege`.
- Cheap models transcribing long SQL dropped lines; deterministic patch scripts with
  occurrence assertions proved far more reliable than hand transcription.
- `core.autocrlf=true`: verify file bytes with `git show <rev>:<path>`, never the working
  copy.

## 2026-09-17 — v1.0.1 / v1.0.2: versioning and exposure

- Every release bumps `VERSION`, `package.json`, `version.json`, `sw.js` `CACHE_NAME` and
  `CHANGELOG.md`, and is tagged on the promoted commit.
- The service worker served a cached `version.json`, which hid deploys — it is now
  network-only with `no-store`.
- `/docs`, `/supabase`, `/tests` and internal markdown were publicly downloadable;
  `.vercelignore` now blocks them, with a test.

## 2026-09-16 — the tenancy line was settled

- Production serves branch `claude/gstack-skill-install-chnb41` (the CRM line). `main`
  and PR #99 still read the dropped `memberships` table and break sign-in — do not
  resurrect them. Features move onto the CRM line one release at a time.
- **Merged ≠ live.** Only the owner's promotion in Vercel changes what users see.
