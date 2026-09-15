# Bringing the RTcompu CRM into production

**Date:** 2026-09-15
**Branch:** `claude/crm-into-main` (from `main`)
**Status:** plan — awaiting review, nothing integrated yet

## 1. What we are actually doing

`main` is production (Vercel deploys the live `atllanta.vercel.app` from it). The
RTcompu CRM was built on `claude/gstack-skill-install-chnb41`. The goal is to get
that CRM live **without losing what `main` has gained since the two lines split.**

This is not "merge the CRM branch", and it is not "choose a CRM". **There are two
CRMs by design** — a generic one for every org and a custom partner vertical for
RTcompu — and `main` already gates them per-org (§4A). The CRM line is a newer
generation of the *partner* vertical. The job is to upgrade that vertical in
production without disturbing the generic CRM every other org uses.

The two lineages diverged on **2026-07-23** and became different builds of the
same product:

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

### A. CRM views — upgrading one of two CRMs, not choosing between them

**There are deliberately two CRMs, and `main` already implements the gating.**
`organizations` carries two flags, live today:

| Org | `crm_enabled` | `partner_crm_enabled` |
|---|---|---|
| Atllanta Pvt Ltd, BlueHire, Hiretrack, Generic CRM Test Co | yes | no |
| **RTcompu** | yes | **yes** |

`js/features.js` on `main` reads them (`setCrmEnabled`, `setPartnerPack`) and
splits the CRM surface in two:

```js
const GENERIC_CRM     = new Set(['crm','crm_leads','crm_pipeline','crm_contacts']);
const PARTNER_FEATURES = new Set(['crm_visits','crm_telecalling','crm_coverage',
  'crm_sales','crm_targets','crm_opps','crm_reports','crm_to_visit','crm_pjp']);
```

These are platform gates, explicitly **not** bypassed by an org's own admins.

That reframes the whole job. `main`'s "CRM-only" files are not generic leftovers:
`telecalling*`, `visits`, `to-visit`, `coverage`, `targets` **are the RTcompu
partner vertical** — an earlier generation of it, already gated. The CRM line is a
**later generation of the same vertical**, built without gating because that
branch only ever served RTcompu.

So the work is **upgrading the partner vertical from generation 1 to generation 2,
leaving the generic CRM and the gating machinery untouched.** Nothing about the
generic CRM changes, and no org other than RTcompu should see any difference.

Grouping the files accordingly:

- **Generic CRM — do not touch (main, 10):** `accounts.js`, `account-detail.js`,
  `contacts.js`, `contact-detail.js`, `activities.js`, `lead-actions.js`,
  `lead-detail.js`, `opportunity-detail.js`, `settings.js`, `common.js`
- **Partner vertical, gen 1 (main, 8):** `visits.js`, `telecalling.js`,
  `telecalling-common.js`, `telecalling-daily.js`, `to-visit.js`, `coverage.js`,
  `opportunities-coverage.js`, `targets.js`
- **Partner vertical, gen 2 (CRM line, 11 — to add):** `partners.js`,
  `partner-detail.js`, `partner-form.js`, `account-form.js`, `field-sales.js`,
  `field-log.js`, `prospects.js`, `events.js`, `exports.js`, `visit-form.js`,
  `activity-timeline.js`
- **In both (6, the add/add conflicts):** `index.js`, `leads.js`,
  `opportunities.js`, `pjp.js`, `reports.js`, `sales.js`

Note the 6 shared files straddle the divide: on `main` `leads.js` and
`opportunities.js` serve the **generic** CRM (`crm_leads`, `crm_pipeline`), while
on the CRM line they are RTcompu screens. These cannot be taken wholesale from
either side — each needs reading. `index.js` is the hub and must route both CRMs.

### A2. Feature keys to add

The gen-2 hub exposes routes `main` has no feature key for: `partners`,
`field-sales`, `prospects`, `events`, `exports`, `log-visit`. Each needs an entry
in `CRM_SUB` and membership in `PARTNER_FEATURES`, plus a label in `FEATURES`, or
it will not appear in the sidebar or pass the route gate. Retired gen-1 keys come
out of both sets at the same time.

Concretely:

- **Add** the CRM line's 11 gen-2 files. Low risk; they are new to `main`.
- **Resolve** the 6 shared files individually. `sales.js` (508 vs 183 lines) and
  `reports.js` (502 vs 387) are CRM-line dominant. `leads.js` and
  `opportunities.js` serve different CRMs on the two sides and need the most care.
- **Retire only gen-1 partner files that gen 2 actually replaces** — at most those
  8, never the 10 generic ones. `to-visit.js` looks superseded by the PJP work
  (there is a `claude/merge-tovisit-into-pjp` branch), and `visits.js` by
  `visit-form.js`/`field-log.js`. `telecalling*`, `coverage` and `targets` have no
  obvious gen-2 counterpart and should be assumed **kept** until the owner says
  otherwise (see §8).

Before removing any file, grep `main` for importers — `js/router.js`,
`index.html`, the nav and `js/features.js` are the likely referrers.

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
- **Manual smoke on the preview**, since these paths have no automated cover.
  Two passes, because there are two CRMs:
  - **As RTcompu** (`partner_crm_enabled = true`): CRM hub, partners, sales,
    field-sales, PJP, visit form, prospects, events, exports, report import.
  - **As a non-partner org** (e.g. "Generic CRM Test Co", which exists for this):
    the generic CRM must look and behave exactly as it does today, and none of
    the partner screens may appear in the sidebar or open by direct URL. This is
    the regression most likely to slip through, since all our attention is on
    the RTcompu side.
  - Plus what `main` owns and must not regress: analytics, login/auth,
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
3. **Which gen-1 partner screens does gen 2 replace?** Now scoped to 8 files, not
   18, because the generic CRM is settled and stays. Best guesses to confirm:
   `to-visit.js` → PJP, `visits.js` → `visit-form.js` + `field-log.js`. No gen-2
   counterpart is apparent for `telecalling.js`, `telecalling-common.js`,
   `telecalling-daily.js`, `coverage.js`, `opportunities-coverage.js` or
   `targets.js` — are those still used by RTcompu, or retired? Default if
   unanswered: keep them, since they are live and gated correctly already.
4. **`analytics_run_as`** — production is missing a function its own migration
   creates. Deferred with the rest of analytics; noted so it is not lost.
