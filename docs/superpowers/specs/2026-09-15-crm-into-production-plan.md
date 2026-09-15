# Bringing the RTcompu CRM into production

**Date:** 2026-09-15
**Branch:** `claude/crm-into-main` (from `main`)
**Status:** plan — awaiting review, nothing integrated yet

## 1. What we are actually doing

`main` is production (Vercel deploys the live `atllanta.vercel.app` from it). The
RTcompu CRM was built on `claude/gstack-skill-install-chnb41`. The goal is to get
that CRM live **without losing what `main` has gained since the two lines split.**

This is not "merge the CRM branch". The two lineages diverged on **2026-07-23**
and became different builds of the same product:

| | `main` (production) | CRM line |
|---|---|---|
| Commits since split | 81 | 70 |
| `views/crm/` files | 24 (generic CRM + telecalling/visits) | 17 (RTcompu) |
| `supabase/migrations/` | 57 hand-authored | 107 verified |
| Has | analytics, email, outbox, rate-limit, mobile, landing, `app.html` | RTcompu CRM, `js/csv.js`, `DESIGN.md` |

Only `main` has `js/analytics/`, `lib/email.js`, `lib/langfuse.js`,
`lib/provisionMember.js`, `lib/ratelimit.js`, `js/outbox*.js`, `js/features.js`,
`mobile/`, `docs/HANDOVER.md`. **Analytics already lives in `main`** — which
matters because analytics is the next piece of work, and a careless merge is
exactly how it would be lost.

## 2. Why not just merge the branches

A trial merge produces **28 conflicted files** across `api/` (9 functions),
`views/crm/`, `views/recruitment/`, `views/settings/`, `index.html`, `login.html`,
`js/auth.js` and `CLAUDE.md`.

Measuring lines changed on each side since the merge base shows most of those
conflicts are in files **`main` owns and the CRM line barely touched**:

| File | `main` lines | CRM lines | Owner |
|---|---:|---:|---|
| `api/ai-query.js` | 315 | 8 | main |
| `api/send-notification.js` | 301 | 12 | main |
| `views/ai/assistant.js` | 253 | 2 | main |
| `api/parse-resume.js` | 186 | 69 | main |
| `views/settings/users.js` | 395 | 96 | main |
| `views/settings/integrations.js` | 215 | 87 | main |
| `views/recruitment/matcher.js` | 124 | 6 | main |
| `views/crm/sales.js` | 183 | 508 | CRM |
| `views/crm/reports.js` | 387 | 502 | CRM |
| `login.html` | 96 | 167 | CRM |
| `js/auth.js` | 1 | 33 | CRM |
| `index.html` | 1212 | 82 | contested |
| `CLAUDE.md` | 1047 | 1301 | contested |

Merging drags stale versions of `main`-owned files into production for no gain.
**Strategy: port the CRM vertical onto `main`, do not merge the branches.** Touch
only what the CRM needs.

## 3. Hard constraint: the Vercel function limit

`main` has **12** serverless functions; the CRM line has **12**; their union is
**13**. The Hobby plan caps at 12, so a naive merge does not merely conflict — it
**fails to deploy**. The odd ones out are `api/lead.js` (main) and
`api/extract-candidate.js` (CRM line).

This must be resolved before anything ships. Options, in the order I would
consider them:

1. Confirm `api/extract-candidate.js` is actually required by the RTcompu CRM. If
   the CRM views never call it, drop it and the problem disappears.
2. Fold it into an existing function (e.g. alongside `api/parse-resume.js`) behind
   a route/action parameter.
3. Drop `api/lead.js` if the landing-page lead capture is not in use.
4. Upgrade the Vercel plan.

**This is an open question for the owner — see §8.**

## 4. Work breakdown

### A. CRM views — per-file decision, NOT a wholesale replace

The two `views/crm/` folders are **not** a superset relationship. They overlap in
only 6 files — exactly the six add/add conflicts. Replacing the folder wholesale
would delete 18 files that are live in production today.

**Only in `main` (18):** `accounts.js`, `account-detail.js`, `contacts.js`,
`contact-detail.js`, `activities.js`, `common.js`, `coverage.js`,
`opportunities-coverage.js`, `opportunity-detail.js`, `lead-actions.js`,
`lead-detail.js`, `settings.js`, `targets.js`, `telecalling.js`,
`telecalling-common.js`, `telecalling-daily.js`, `to-visit.js`, `visits.js`

**Only in the CRM line (11):** `partners.js`, `partner-detail.js`,
`partner-form.js`, `account-form.js`, `field-sales.js`, `field-log.js`,
`prospects.js`, `events.js`, `exports.js`, `visit-form.js`,
`activity-timeline.js`

**In both (6, all add/add conflicts):** `index.js`, `leads.js`,
`opportunities.js`, `pjp.js`, `reports.js`, `sales.js`

So three decisions, not one:

- **Add** the CRM line's 11 new files. Low risk; they are new to `main`.
- **Resolve** the 6 shared files. `sales.js` (508 vs 183 lines) and `reports.js`
  (502 vs 387) are CRM-line dominant and should take the RTcompu version;
  `index.js` is the hub and needs a real merge, since it routes to files from
  both sets.
- **Decide, file by file,** what happens to `main`'s 18. Some are the generic-CRM
  blocks the RTcompu line deliberately retired (`accounts`, `contacts`,
  `activities`, and their detail views). Others — `telecalling*`, `visits`,
  `to-visit`, `coverage`, `targets` — look like real features currently live in
  production, and at least one (`to-visit`) appears superseded by the RTcompu PJP
  work (there is a `claude/merge-tovisit-into-pjp` branch). **Nothing here gets
  deleted without the owner confirming it is superseded** (see §8).

Before removing any file, grep `main` for importers — `js/router.js`,
`index.html` and the nav are the likely referrers.

### B. Shared files — keep main's version

For every file in the "main owns" rows above, keep `main` unchanged. Then check the
CRM line's diff on each for anything CRM-specific worth cherry-picking; the line
counts suggest there is little to nothing (8, 12, 2, 6 lines).

### C. Shared files — genuine merge required

- `index.html` — register CRM routes/nav. Main changed 1212 lines here; take main's
  file and add only the CRM entries.
- `js/auth.js` — CRM line has 33 lines main lacks. Read and port deliberately.
- `login.html` — CRM line dominant (167 vs 96). Inspect before choosing.
- `api/create-org.js`, `api/google-auth.js` — both sides heavy; needs a real read.
- `CLAUDE.md` — two different documents. Decide which is canonical (see §8) rather
  than mechanically merging.

### D. Migrations — reuse the verified work

`main` carries the same broken hand-authored lineage this project already fixed on
the CRM line: 57 files with synthetic timestamps that cannot rebuild the database.
PR #98 replaced those with the 107 migrations the database actually recorded, plus
one reconstruction migration, **verified by replaying onto an empty database** with
a clean structural diff against production.

Apply the same replacement to `main`: drop its 57, take the CRM line's 107. Only
one migration conflicts by name (`20260829115612_add_customer_count_to_crm_accounts.sql`).

Re-run the replay verification after the port, since the file set will differ.

## 5. Order of operations

1. Resolve the function-limit question (§3). Nothing ships until this is settled.
2. Port migrations (D) and re-verify by replay.
3. Port CRM views (A), delete main's generic-CRM files, fix referrers.
4. Merge the contested shared files (C), keeping main's versions elsewhere (B).
5. Push the branch, let Vercel build a **preview** deployment.
6. Verify against the preview (§6).
7. Only then open a PR into `main` — merging deploys to production.

## 6. Verification

The existing safety net is thin: two Playwright specs (`tests/app-shell.spec.js`,
`tests/recruitment-view.spec.js`). So verification is mostly explicit:

- **Migrations**: replay all onto an empty database, diff the resulting schema
  against production's catalogue. Method already proven in this project.
- **Build**: the preview deployment must succeed — this is what catches the
  function-limit breach.
- **Playwright**: both specs pass against the preview.
- **Manual smoke on the preview**, since these paths have no automated cover:
  CRM hub, leads, sales, partners, field-sales, PJP, visit form, report import;
  plus the things `main` owns and must not regress — analytics, login/auth,
  recruitment, employees, settings.

## 7. Risks and rollback

- **Production is live.** Merging to `main` deploys immediately. Everything happens
  on the branch behind a preview URL first.
- **Rollback** is Vercel's "promote previous deployment" plus `git revert` of the
  merge commit. Worth confirming the current production deployment id before
  merging, so there is a known-good target.
- **Analytics is the loss to fear.** It lives only in `main`. Any resolution that
  takes the CRM line's version of a shared file risks it. Explicit check before the
  PR: `js/analytics/` intact and the analytics views still load.
- **The database is shared.** Both lineages point at the same Supabase project
  (`nburswxjpukntgdwuyme`), so schema changes are already live. The port changes
  the repo's record of them, not the database.

## 8. Open questions

1. **Function limit** — may `api/extract-candidate.js` be dropped or folded, or is
   `api/lead.js` disposable? Nothing ships until this is answered.
2. **`CLAUDE.md`** — `main`'s is a lean pointer to `docs/HANDOVER.md`; the CRM
   line's is a 400-line canonical spec with the §13 migration history. They cannot
   both be the source of truth. Recommendation: keep the CRM line's as the
   canonical document and fold `main`'s current-state notes into it.
3. **`main`'s 18 CRM-only files** — the biggest open question, because these are
   live in production. Which are superseded by RTcompu and safe to retire, and
   which must stay? Specifically: are `telecalling*.js`, `visits.js`,
   `to-visit.js`, `coverage.js` and `targets.js` still in use, or did the RTcompu
   field-sales/PJP work replace them? The generic-CRM set (`accounts`,
   `contacts`, `activities` and their detail views) looks retired, but that should
   be confirmed rather than assumed.
4. **`analytics_run_as`** — production is missing a function its own migration
   creates. Deferred with the rest of analytics; noted so it is not lost.
