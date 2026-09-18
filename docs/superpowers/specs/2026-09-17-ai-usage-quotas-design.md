# AI usage tracking, token quotas and versioned releases — Design

**Status:** approved in conversation with the owner on 2026-09-17, section by section. This document is the spec that implementation plans argue from.

**Why now:** the owner will not switch the AI assistant back on (Phase 1a) until AI usage is tracked per organisation, user and feature, and limited by quotas the owner controls.

---

## 1. Goals and non-goals

**Goals**

1. Record every AI (Groq) call with its organisation, user, feature, model and exact token counts.
2. Limit AI use with two tiers of quota: a **monthly token quota per organisation**, set by the platform owner, and a **daily token limit per user**, set by that organisation's owner/admin.
3. Give the platform owner an in-app console across all organisations, and each organisation's owner/admin a usage and limits screen for their own organisation.
4. Keep the AI assistant's data access equal to what the asking user can already view in the app.
5. Version every production release.

**Non-goals**

- Billing, invoicing or payment collection. Soft-limit overage is recorded, not charged.
- Tightening the app's existing row-level security. The assistant inherits it as is (decision 2.6).
- A UI for adding platform admins (decision 2.9).
- Changing what data the recruitment AI features read.

## 2. Decisions (owner, 2026-09-17)

| # | Decision |
|---|---|
| 2.1 | The platform owner sets each organisation's quota. The organisation's owner/admin sets per-user limits "as per their convenience". |
| 2.2 | Organisation quota unit: **tokens per calendar month**. |
| 2.3 | At the organisation limit: **chosen per organisation** by the platform owner — `hard_stop` or `soft_limit`. |
| 2.4 | User limit unit: **tokens per day**, set by the organisation owner/admin. A user's daily limit is **always a hard stop**, including in a `soft_limit` organisation. |
| 2.5 | Quotas cover **every Groq call**: the AI assistant (including analytics "Ask AI") and recruitment AI. |
| 2.6 | The assistant can answer anything the user can already view in the app, and nothing more. No extra role gating on top of RLS. |
| 2.7 | Users without their own limit get the **organisation default daily limit**, which the organisation owner/admin can change. |
| 2.8 | Existing per-action credits are **replaced** by token quotas. Credit deduction stops; credit columns, `credit_ledger` and `consume_credits` are left untouched for history. |
| 2.9 | The platform owner gets an **in-app Platform console**. Platform admins are listed in a `platform_admins` table seeded with the owner's account; more are added by SQL only. |
| 2.10 | Starting values for all 5 organisations: **2,000,000 tokens/month, `hard_stop`, default daily user limit 200,000 tokens**. |
| 2.11 | Enforcement approach **A**: a single server-side gateway checks quotas before each call and records actual usage after it. One in-flight call may finish past a limit. |
| 2.12 | Releases are versioned: `VERSION` file, `CHANGELOG.md`, git tag on the promoted commit, version shown in the app. Current production (`3b5f39b`) is **v1.0.0**. |
| 2.13 | **Bot check:** bot-like use flags the user and pauses their AI for 10 minutes. Flags stay visible to the org owner/admin and the platform owner until cleared; clearing also lifts an active pause. |
| 2.14 | **New organisations** start with **2,000 tokens/month**, `hard_stop`, and a default daily user limit of 200,000 tokens, created automatically when the organisation is created. |

## 3. Verified context (2026-09-17)

- Production is updated by **manual promotion** of a Vercel deployment. Merging into `claude/gstack-skill-install-chnb41` only builds a preview. Production currently runs merge commit `3b5f39b`.
- Groq is called from five server files: `api/ai-query.js` (currently returns 503 before any call), `api/extract-candidate.js`, `api/match.js`, `api/parse-resume.js`, `api/screen-job.js`. No browser code calls Groq (`js/ai.js` declares an unused `GROQ_MODELS` constant).
- All four recruitment AI endpoints authenticate with the caller's Supabase access token (`getUserFromToken`). `match` and `screen-job` also check the job's `org_id` against `users.org_id`.
- `api/match.js` and `api/screen-job.js` read `organizations.credits_balance` / `credit_overage_mode` and insert into `credit_ledger` (`organization_id`, `action_type`, `credits_delta`). `credit_ledger` holds 20 rows (`resume_match`, `interview_questions`). All 5 organisations are `soft_bill`.
- `views/recruitment/jobs.js:512` shows "1 credit/resume"; `:558` shows `data.credits_used`.
- `is_super_admin()` exists and returns `false`. Nothing grants cross-tenant access today.
- All 5 organisations have `timezone = 'Asia/Kolkata'`.
- The owner's account (`anchansachinv99@gmail.com`) exists in `auth.users` and `public.users`.
- `users.role ∈ owner, admin, manager, member`; `users.status ∈ active, on_notice, exited`.
- Vercel functions are at the Hobby cap of 12.
- The repo has no `VERSION` file, no `CHANGELOG.md`, `package.json` version `0.1.0`, and one tag (`main-pre-gstack`).

## 4. Data model

One migration, applied with the Supabase `apply_migration` tool and saved under the version it records (CLAUDE.md "Migration history").

### 4.1 Tables

```
platform_admins
  user_id     uuid primary key references auth.users(id) on delete cascade
  created_at  timestamptz not null default now()

ai_org_quotas
  org_id          uuid primary key references organizations(id) on delete cascade
  monthly_tokens  bigint not null check (monthly_tokens >= 0)
  overage_mode    text   not null default 'hard_stop' check (overage_mode in ('hard_stop','soft_limit'))
  updated_by      uuid references auth.users(id) on delete set null
  updated_at      timestamptz not null default now()

ai_user_limits
  id            uuid primary key default gen_random_uuid()
  org_id        uuid not null references organizations(id) on delete cascade
  user_id       uuid references users(id) on delete cascade   -- null = organisation default
  daily_tokens  bigint not null check (daily_tokens >= 0)
  updated_by    uuid references auth.users(id) on delete set null
  updated_at    timestamptz not null default now()
  unique (org_id, user_id)            -- plus a partial unique index on (org_id) where user_id is null

ai_usage
  id                 bigint generated always as identity primary key
  org_id             uuid not null references organizations(id) on delete cascade
  user_id            uuid references users(id) on delete set null
  feature            text not null check (feature in ('assistant','analytics_ask','resume_parse','jd_parse','candidate_extract','match','screen'))
  model              text not null
  prompt_tokens      integer not null default 0
  completion_tokens  integer not null default 0
  total_tokens       integer not null default 0
  outcome            text not null check (outcome in ('ok','error','blocked'))
  block_reason       text check (block_reason in ('org_month_exhausted','user_day_exhausted','paused_bot_check'))
  request_hash       text            -- sha256 of feature + messages; used by the bot check
  created_at         timestamptz not null default now()
  index (org_id, created_at), index (user_id, created_at)

ai_usage_org_month
  org_id        uuid references organizations(id) on delete cascade
  month         date            -- first day of the month in the org's timezone
  tokens        bigint not null default 0
  calls         integer not null default 0
  blocked_calls integer not null default 0
  primary key (org_id, month)

ai_usage_user_day
  org_id        uuid references organizations(id) on delete cascade
  user_id       uuid references users(id) on delete cascade
  day           date            -- calendar day in the org's timezone
  tokens        bigint not null default 0
  calls         integer not null default 0
  blocked_calls integer not null default 0
  primary key (user_id, day)

ai_user_flags
  id            bigint generated always as identity primary key
  org_id        uuid not null references organizations(id) on delete cascade
  user_id       uuid not null references users(id) on delete cascade
  reason        text not null check (reason in ('call_rate','repeated_request'))
  detail        jsonb not null default '{}'    -- e.g. {"calls_last_minute": 74} or {"feature":"match","repeats":12}
  paused_until  timestamptz not null
  created_at    timestamptz not null default now()
  cleared_by    uuid references auth.users(id) on delete set null
  cleared_at    timestamptz
  index (org_id, created_at), index (user_id, paused_until)
```

### 4.2 Row-level security

RLS is enabled on all seven tables. There are **no insert/update/delete policies**: every write goes through the `SECURITY DEFINER` functions in 4.3, or the service role.

- `platform_admins`: no policies (unreadable from the browser).
- `ai_org_quotas`, `ai_usage_org_month`: select where `org_id` is the caller's org and the caller is owner/admin, or the caller is a platform admin.
- `ai_user_limits`, `ai_usage_user_day`, `ai_usage`, `ai_user_flags`: select where the caller is a platform admin; or the row's org is the caller's org and the caller is owner/admin; or `user_id = auth.uid()`.

### 4.3 Functions

All functions are `SECURITY DEFINER` with `search_path = public`. Execute is revoked from `public`/`anon` and granted to the role named below.

| Function | Granted to | Behaviour |
|---|---|---|
| `is_platform_admin() returns boolean` | authenticated | `exists (select 1 from platform_admins where user_id = auth.uid())` |
| `ai_quota_check(p_org_id uuid, p_user_id uuid) returns table(allowed boolean, reason text, paused_until timestamptz, org_used bigint, org_quota bigint, overage_mode text, user_used bigint, user_limit bigint, resets_day timestamptz, resets_month timestamptz)` | service_role | First, if the user has a flag with `paused_until > now()`, returns not allowed with `reason = 'paused_bot_check'`. Then computes today and this month in the org's timezone. A missing `ai_org_quotas` row means quota 0 and mode `hard_stop`, so the call is blocked with `org_month_exhausted`. User limit = the user's override, else the org default, else 0. `reason = 'user_day_exhausted'` when `user_used >= user_limit` (always blocks). `reason = 'org_month_exhausted'` when `org_used >= org_quota`; this blocks only if `overage_mode = 'hard_stop'`. |
| `ai_record_usage(p_org_id uuid, p_user_id uuid, p_feature text, p_model text, p_prompt int, p_completion int, p_outcome text, p_block_reason text default null, p_request_hash text default null) returns void` | service_role | Inserts one `ai_usage` row, then upserts `ai_usage_org_month` and `ai_usage_user_day` (tokens += total, calls += 1 unless blocked, blocked_calls += 1 if blocked), all in one transaction. |
| `ai_bot_check(p_org_id uuid, p_user_id uuid, p_feature text, p_request_hash text) returns table(flagged boolean, reason text, paused_until timestamptz)` | service_role | Counts the user's non-blocked `ai_usage` rows in the last 60 seconds, and rows with the same `feature` + `request_hash` in the last 5 minutes. Calls in the last minute `>= 60` (this would be the 61st) → reason `call_rate`; else same-request count `>= 9` (this would be the 10th) → `repeated_request`. On a hit: inserts `ai_user_flags` with `paused_until = now() + interval '10 minutes'` and the counts in `detail`; inserts an in-app `notifications` row for each active owner/admin of the org ("AI paused for {name}: unusual activity"); returns `flagged = true`. |
| `ai_clear_flag(p_flag_id bigint) returns void` | authenticated | Platform admins, or an owner/admin of the flag's org (`42501` otherwise). Sets `cleared_by`, `cleared_at`, and `paused_until = least(paused_until, now())`. |
| `platform_set_org_quota(p_org_id uuid, p_monthly_tokens bigint, p_overage_mode text) returns void` | authenticated | Raises `42501` unless `is_platform_admin()`. Upserts `ai_org_quotas` with `updated_by = auth.uid()`. |
| `ai_set_user_limit(p_user_id uuid, p_daily_tokens bigint) returns void` | authenticated | `p_user_id` null = the caller's organisation default. Raises `42501` unless the caller's `users.role in ('owner','admin')` and, when `p_user_id` is set, that user's `org_id` equals the caller's. `p_daily_tokens` null with a user id deletes the override (back to default). Negative values are rejected. |
| `ai_my_usage() returns table(used_today bigint, daily_limit bigint, resets_at timestamptz)` | authenticated | For `auth.uid()` in their org's timezone. |
| `ai_org_usage(p_month date) returns jsonb` | authenticated | For the caller's org, owner/admin only (`42501` otherwise). Keys: `org` {quota, overage_mode, used, remaining, blocked_calls, resets_month}; `default_daily_tokens`; `users` [{user_id, full_name, role, daily_limit, is_override, used_today, used_month, calls, blocked_calls}]; `features` [{feature, tokens, calls}]. |
| `platform_org_usage(p_month date) returns jsonb` / `platform_org_detail(p_org_id uuid, p_month date) returns jsonb` | authenticated | Platform admins only (`42501` otherwise). Usage: `orgs` [{org_id, name, quota, overage_mode, used, pct_used, blocked_calls, overage}]. Detail: `users` [{user_id, full_name, role, daily_limit, used_today, used_month, calls, blocked_calls}], `features` [{feature, tokens, calls}], `days` [{day, tokens}]. |

### 4.4 Seed (same migration)

- `platform_admins`: the `auth.users.id` whose `lower(email) = 'anchansachinv99@gmail.com'`.
- `ai_org_quotas`: every existing organisation → `2000000`, `hard_stop`.
- `ai_user_limits`: every existing organisation → one default row (`user_id` null) with `200000`.
- New organisations: an `AFTER INSERT` trigger on `organizations` (`SECURITY DEFINER`) inserts `ai_org_quotas (2000, 'hard_stop')` and a default `ai_user_limits` row of `200000`. The platform owner raises the quota in the console when the tenant needs real AI use.

## 5. AI gateway

### 5.1 `lib/aiGateway.js`

The only module allowed to call `api.groq.com`.

```
runAI({ caller, feature, messages, maxTokens, temperature, metadata })   // caller = await resolveCaller(token)
  → { ok: true, text, usage: { prompt, completion, total }, user, orgId }
  | { ok: false, status, error, quota }     // status 401 | 403 | 429 | 502
```

1. Resolve the caller: `GET {SUPABASE_URL}/auth/v1/user` with the token and `apikey: ANON_KEY` (401 if invalid). Load `users` (`org_id, role, status`) with the service role (403 if there's no org, or the status isn't `active`/`on_notice`).
2. Compute `request_hash = sha256(feature + JSON(messages))`. Call `ai_bot_check(org, user, feature, hash)`. If flagged: `ai_record_usage(... 'blocked', 'paused_bot_check')` and return `429` "AI is paused for 10 minutes because of unusual activity. Your admin has been notified."
3. `ai_quota_check(org, user)`. If not allowed: `ai_record_usage(... 'blocked', reason)` and return `429` with a message:
   - `user_day_exhausted`: "You've used today's AI limit. It resets at midnight."
   - `org_month_exhausted`: "Your organisation's monthly AI quota is used up. It resets on the 1st."
   - `paused_bot_check`: the pause message above, with the time AI resumes.
4. Call Groq with `model: "openai/gpt-oss-120b"`, `reasoning_effort: "low"`, and the given messages, `max_tokens` and temperature.
5. On a Groq error: `ai_record_usage(... 0, 0, 'error')`, return `502`.
6. On success: `ai_record_usage` (with `request_hash`) using `usage.prompt_tokens` / `usage.completion_tokens`, fire-and-forget `logGroqGeneration` with `{ org_id, feature, ...metadata }`, return the text and usage.

Also exports `resolveCaller(token)` for endpoints that need the user before any AI call (e.g. job ownership checks), so a request authenticates once. `runAI` takes that caller, so each request authenticates once.

### 5.2 Endpoint changes

| Endpoint | Feature | Change |
|---|---|---|
| `api/parse-resume.js` | `resume_parse`; `?action=parse-jd` → `jd_parse` | Groq fetch → `runAI`; 429 passes through |
| `api/extract-candidate.js` | `candidate_extract` | Groq fetch → `runAI` |
| `api/match.js` | `match` | Groq fetch → `runAI`; remove the credit check (`402`), `organizations` credit update and `credit_ledger` insert; response drops `credits_remaining`, adds `tokens_used` |
| `api/screen-job.js` (`method=ai`) | `screen` | Per candidate: `runAI`; on 429 mark that and all remaining candidates `error: <quota message>` and stop calling Groq; remove credit reads/updates/ledger inserts; response `credits_used` → `tokens_used` |
| `api/ai-query.js` | `assistant`, `analytics_ask` | Delivered in Phase 1a (release v1.4.0) on top of the gateway |

`views/recruitment/jobs.js`: "1 credit/resume" → "uses AI tokens"; the status line shows `tokens_used`; a 429 shows the gateway message.

### 5.3 Bot check

The bot check (decision 2.13, `ai_bot_check`) replaces a fixed per-minute rate limit and runs before the quota check. Thresholds (the 61st call in a minute; the 10th identical request in 5 minutes) and the 10-minute pause are constants in the function, not owner settings. The gateway does not use `lib/ratelimit.js`. `api/screen-job.js` includes each candidate's application id in the hashed messages, so a batch never counts as repeated requests, and accepts at most 50 candidates per request, so one batch stays under the per-minute threshold.

## 6. Screens

### 6.1 Platform console — `#/platform`

- The route and sidebar link render only when `is_platform_admin()` is true; the database functions enforce it regardless.
- **Organisations table:** name, monthly quota, mode, used this month (number + bar), % used, blocked calls, overage (soft limit).
- **Edit:** monthly quota and mode → `platform_set_org_quota`; takes effect on the next call.
- **Flags:** open flags across all organisations (org, user, reason, detail, when, paused until) with **Clear** → `ai_clear_flag`.
- **Org drill-down:** by user (today, month, limit, calls, blocked), by feature, tokens per day this month.
- **Month picker:** current month by default.

### 6.2 Organisation AI usage — `#/settings/ai`

- Linked from the Admin page. Owner/admin only (others see Access Denied; functions refuse too).
- **Header:** monthly quota and mode (read-only), used, remaining, reset date.
- **Default daily limit:** editable → `ai_set_user_limit(null, n)`.
- **Users:** name, role, daily limit (default/override label), used today, used this month, blocked this month. **Set limit** / **Reset to default** → `ai_set_user_limit(user, n|null)`.
- **By feature:** tokens and calls this month.
- **Flags:** this org's open and recent flags (user, reason, detail, when, paused until, cleared by) with **Clear** → `ai_clear_flag`. A flagged user's row shows a "Flagged" badge.

### 6.3 Every user

- The AI panel shows "AI today: {used} / {limit} tokens" from `ai_my_usage()`.
- Quota errors show the gateway message verbatim.

## 7. Versioned releases

- `VERSION` at the repo root holds `MAJOR.MINOR.PATCH`. `package.json` `version` matches.
- **MINOR** for a release that adds or changes a feature; **PATCH** for fixes only; **MAJOR** for breaking changes to data, tenancy or behaviour users would notice.
- `CHANGELOG.md`: newest first; per release: version, date, "What changed" (plain language), "Admins need to" (if anything).
- `version.json` at the site root: `{ "version": "x.y.z" }`, served statically (no function) with `Cache-Control: no-store`. (No commit hash: the merge commit is not known when the release PR is written; the git tag records it.)
- The version is shown as "Atllanta vX.Y.Z" at the bottom of the account menu (click the avatar), read from `/version.json` at load. (The sidebar is icon-only, 64px wide, so it has no room for text.)
- Each release PR bumps `VERSION`, `package.json`, `version.json`, `sw.js` `CACHE_NAME` and `CHANGELOG.md`. After the owner promotes it and the live check passes, the promoted commit is tagged `vX.Y.Z` and pushed.
- `sw.js` `CACHE_NAME` is `"atllanta-" + VERSION` (a unit test enforces it), so each release installs a new service worker that deletes old caches. The service worker fetches `/version.json` from the network only, never from Cache Storage. Pages served from the old cache can still show the previous app for one load after a release; the version label itself is always current.
- A unit test fails if `VERSION`, `package.json` `version` and `version.json` disagree.
- Baseline: tag `3b5f39b` as `v1.0.0` with a changelog entry describing the Phase 0 production state.

## 8. Release sequence

| Version | Contents | User-visible |
|---|---|---|
| v1.0.0 | Baseline tag on `3b5f39b` (current production) | — |
| v1.0.1 | Versioning mechanics (section 7) | Version line in account menu |
| v1.1.0 | Migration: tables, RLS, functions, seed (section 4) | No |
| v1.2.0 | `lib/aiGateway.js` + recruitment endpoints on quotas; credits stop (section 5) | Recruitment AI shows tokens / quota messages |
| v1.3.0 | Platform console + organisation AI usage page + "AI today" indicator (section 6) | Yes |
| v1.4.0 | Phase 1a: AI assistant on via the gateway, RLS-scoped reads | Assistant answers again |

Each version: its own branch and PR into `claude/gstack-skill-install-chnb41`, preview checks, owner signed-in check where relevant, merge, **owner promotes**, live check, tag.

## 9. Testing

**Database** (on the live project inside `begin … rollback`, using `set local role authenticated` and `request.jwt.claims`):
- `ai_quota_check`: under quota → allowed. Org at quota → blocked in `hard_stop`, allowed in `soft_limit`. User at limit → blocked in both modes. User override beats the org default. Missing quota row → blocked with `org_month_exhausted`. Day/month boundaries follow the org's timezone.
- `ai_bot_check`: with 60 recent calls the 61st flags `call_rate`, pauses 10 minutes and notifies the org's owners/admins; with 9 identical recent requests the 10th flags `repeated_request`; different hashes are not repeats; `ai_quota_check` returns `paused_bot_check` while paused; `ai_clear_flag` lifts the pause for org owner/admin and platform admin, and is refused for a member and for another org's admin.
- Inserting an organisation creates `ai_org_quotas (2000, hard_stop)` and a `200000` default limit.
- `ai_record_usage`: ledger row plus both counters in one call; blocked rows count `blocked_calls`, not tokens.
- `platform_set_org_quota`: refused for an org owner; works for a platform admin.
- `ai_set_user_limit`: works for owner/admin of the same org; refused for manager, member, and an admin of another org; negative values rejected.
- RLS reads: a member sees only their own usage rows; an org admin sees only their org; the platform admin sees all; an admin of org A sees nothing of org B.

**Unit** (`node:test`, stubs):
- gateway: 401/403/429 paths, blocked row recorded, exact usage recorded, Groq error recorded with 0 tokens, `reasoning_effort: "low"`, Langfuse tagged.
- Each endpoint calls `runAI` with its feature label and no longer reads or writes credits.
- `api.groq.com` appears in no file other than `lib/aiGateway.js`.
- Version files agree.

**Browser:** the Platform link and route are hidden and refused for an org admin. `#/settings/ai` is refused for a member. The "AI today" indicator renders.

**Preview with the owner signed in:** set their own daily limit to 1 token, run one AI action → expect it recorded, next blocked with the daily message. Restore the limit, run one resume match → it appears under Matching in both consoles.

## 10. Risks and follow-ups

- **Overshoot:** parallel calls can each pass the check before any records usage, so one in-flight call per request may exceed a limit (accepted, decision 2.11).
- **Langfuse** receives prompts, outputs and metadata for every AI call (configured on production). With the assistant, up to 20 result rows per question are included.
- **New organisations start at 2,000 tokens/month** (a few AI calls) until the platform owner raises it (section 4.4).
- **Bot-check false positives:** a legitimate burst can pause a user for 10 minutes; their admin can clear it immediately. Thresholds are fixed constants; changing them is a code change. **Open (owner, 2026-09-17): the owner will revisit how genuine bursts should be handled; ship with the behaviour above until then.**
- **`ai_usage` grows without bound.** Retention (e.g. 13 months) is a follow-up; counters keep monthly totals indefinitely.
- `rate_limits` grows until `rate_limit_gc()` runs in the cron (Phase 1b).
- **RLS breadth:** members can read org-wide `users`, `jobs`, `candidates`, `interviews`, `expenses`, `helpdesk_tickets`; the assistant inherits this (decision 2.6).
