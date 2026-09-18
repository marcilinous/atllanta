# Operations: environments, releases, database, testing

How code gets from a worktree to `atllanta.vercel.app` without breaking a tenant.

---

## 1. Environments

| Environment | Where | Database |
|---|---|---|
| Production | `atllanta.vercel.app`, served from branch `claude/gstack-skill-install-chnb41` | Supabase `nburswxjpukntgdwuyme` |
| Preview | every branch/PR gets a Vercel preview URL | **the same production database** |
| Local | `python -m http.server` or any static server; `api/` needs `vercel dev` | production database unless pointed elsewhere |

**Previews share production data.** Any write from a preview is a real write. Test with
the owner's consent, and undo what you change.

Vercel project `prj_Y4Cq4xNUTPxvFECwtZkNyvTYFSU5`, team `marcilinous-projects`,
repo `marcilinous/atllanta`.

## 2. Release ritual (versioned since v1.0.0)

1. Work on a release branch (`claude/release-<version>`), usually in a git worktree.
2. Bump together — tests enforce that they agree:
   `VERSION`, `package.json` `version`, `version.json`, `sw.js` `CACHE_NAME = "atllanta-<version>"`,
   and a new top section in `CHANGELOG.md` (What changed / Admins need to, in plain words).
3. Open a PR against the production branch. Vercel builds a preview.
4. Preview checks: `/version.json`, unauthenticated calls refused, `BASE_URL=<preview> node tests/browser-verify.mjs` (22 checks).
5. **The owner merges.** A merge builds another preview — it does not go live.
6. **The owner promotes** that build in the Vercel dashboard. The domain can take about a
   minute to switch; poll `/version.json` before concluding it failed.
7. Tag the promoted commit `vX.Y.Z` and push the tag.

Released so far: v1.0.0 (`3b5f39b`), v1.0.1 (`044a841`), v1.0.2 (`7e580d7`),
v1.1.0 (`146779b`), v1.2.0 (PR #104, pending).

The service worker caches by version: `CACHE_NAME` must change every release, and
`/version.json` is fetched network-only with `no-store` so a stale worker can't hide a
deploy.

## 3. Environment variables (Vercel → Settings)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `CRON_SECRET`,
`RESEND_API_KEY`, `RESEND_FROM`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`,
`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` (+ optional `LANGFUSE_HOST`).
Enable each for **Production and Preview** — a preview missing a key fails in ways that
look like code bugs.

## 4. `vercel.json`

- `cleanUrls`, rewrites for `/login`, `/reset-password`, `/privacy`, `/terms`.
- **Cron:** `/api/event-processor` daily at `0 3 * * *`, authenticated with `CRON_SECRET`
  (the cron calls it with GET).
- Security headers: `X-Frame-Options SAMEORIGIN`, `X-Content-Type-Options nosniff`,
  `Referrer-Policy strict-origin-when-cross-origin`, `frame-ancestors 'self'`,
  a restrictive `Permissions-Policy`; `/api/*` is `Cache-Control: no-store`.

`.vercelignore` keeps `/docs`, `/supabase`, `/tests`, `/playwright.config.js`,
`CLAUDE.md`, `DESIGN.md`, `README.md`, `.env.example`, `.superpowers` out of every
deployment — `tests/vercelignore.test.mjs` checks nothing the site needs is listed.

## 5. Database changes

**The rule:** `supabase/migrations/` must stay byte-identical to what the database
recorded, plus clearly-marked reconstruction files for objects created outside the
migration system (there is exactly one: `20260803090049_crm_telecaller_names.sql`).

- Apply DDL with the Supabase `apply_migration` tool, then save the file under the
  **exact version the database recorded** (check `supabase_migrations.schema_migrations`;
  the tool picks its own timestamp). Verify with `md5(statements[1])`.
- Never hand-author a migration file with an invented timestamp. That is what produced
  the split lineage the project spent a release untangling.
- Test SQL on production with `begin … rollback` first, and only with the owner's
  explicit go-ahead.
- 107 migrations applied; they replay cleanly onto an empty database.

RLS checklist for a new table: `alter table … enable row level security`, the four
`org_id = auth_org_id()` policies, an index on `org_id`, and a two-org isolation check.
New SECURITY DEFINER functions: `set search_path = public`, then revoke EXECUTE from
`public` and `anon` by name (Supabase grants to both by default).

## 6. Tests

| Command | What it covers |
|---|---|
| `npm run test:unit` | node:test suite — 110 tests at v1.2.0. Runs endpoints against stubbed Supabase/gateway modules, plus source guards (Groq URL, credits, version agreement, `.vercelignore`, feature gating) |
| `BASE_URL=<url> npm run test:browser` | 22 checks against a deployed URL: shell loads, gated routes blocked, public pages, headers |
| `npm run test:e2e` | Playwright app-shell spec |

On Windows use `node --test tests/*.test.mjs` (the `tests/` form is treated as a single
file). Keep test output pristine — mock `console.error` on paths that log.

## 7. Known debt (queued, not forgotten)

- **Security advisor findings** (a patch is planned): 25 SECURITY DEFINER functions
  executable by `anon` (`crm_refresh_sales_facts`, `crm_convert_prospect`, `auth_org_id`,
  …), 2 functions with a mutable `search_path`, 3 materialised views exposed
  (`crm_opportunity_features_mv`, `crm_sales_facts`, `crm_field_facts`), leaked-password
  protection off.
- **Legacy credits columns** on `organizations` and the `credit_ledger` table remain,
  unused since v1.2.0. Keep the history; don't read them.
- **`audit_logs.entity_id` is NOT NULL** and about a dozen `logAction` calls pass null.
- **`views/reports/*`** still reads other modules' tables directly; retire as Analytics
  covers each report.
- **CRM sales facts** need a manual `crm_refresh_sales_facts()` after an import.
- **Deferred minors** from recent releases are listed in each release's SDD ledger under
  `.superpowers/sdd/<plan>/progress.md` (git-ignored, worktree-local).
