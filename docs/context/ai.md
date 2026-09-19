# AI: the gateway, quotas and tracing

Everything that spends a model token. One rule governs the whole module: **every Groq
call goes through `lib/aiGateway.js`, and every call is counted.**

---

## 1. The gateway (`lib/aiGateway.js`, v1.2.0)

```js
resolveCaller(token)  → { ok:true, userId, orgId, role, db } | { ok:false, status, error }
runAI({ caller, feature, messages, maxTokens, temperature, metadata })
                      → { ok:true, text, usage:{prompt,completion,total} }
                      | { ok:false, status, body }
```

Order of operations, and why each step exists:

1. **`resolveCaller`** — validates the session against Supabase Auth, loads the user's
   `org_id`, `role`, `status`. 401 no/invalid token, 403 no org or `exited`, 503 if the
   account can't be loaded.
2. **`ai_bot_check`** — flags automated bursts. Errors → **503, fail closed**. Flagged →
   record a `blocked` row and return 429 with the pause message.
3. **`ai_quota_check`** — org monthly quota and user daily limit. Error or no row →
   **503, fail closed**. Not allowed → record `blocked` with the reason, return 429.
4. **Groq** — `openai/gpt-oss-120b`, `reasoning_effort: "low"`, 30-second timeout.
   Failure, network error, abort or unreadable body → record an `error` row (0 tokens,
   **null request hash** so outages never look like repeated requests), log the detail
   server-side, return 502 `{ error: "AI request failed — please try again" }`.
5. **`ai_record_usage`** — exact prompt/completion tokens. If this write fails it is
   logged and the result is still returned.
6. **Langfuse** — `logGroqGeneration(...)`, fire-and-forget, never awaited.

Constants worth knowing: the three 429 messages are fixed strings (users see them
verbatim); `org_used`/`org_quota` appear in a 429 body only for owners and admins;
caller `metadata` can never override `org_id`/`feature` in a trace.

**Guard test:** `tests/groq-model.test.mjs` fails the build if `api.groq.com` appears
anywhere under `api/`, `js/`, `lib/`, `views/` except `lib/aiGateway.js`.

## 2. Features (the labels usage is recorded under)

`assistant`, `analytics_ask`, `resume_parse`, `jd_parse`, `candidate_extract`, `match`,
`screen`. Live today: `jd_parse`, `candidate_extract`, `match`, `screen`. Reserved for
v1.4.0: `assistant`, `analytics_ask`.

## 3. Quota model (migration `20260917155318`, live since 2026-09-17)

| Table | Holds |
|---|---|
| `ai_org_quotas` | `monthly_tokens`, `overage_mode` (`hard_stop` \| `soft_limit`), `updated_by` |
| `ai_user_limits` | per-org default (`user_id is null`) + per-user overrides; always a hard stop |
| `ai_usage` | one row per call: feature, model, tokens, `outcome` (`ok`\|`error`\|`blocked`), `block_reason`, `request_hash` |
| `ai_usage_org_month`, `ai_usage_user_day` | running totals |
| `ai_user_flags` | bot-check flags: reason, `paused_until`, `cleared_by`, `cleared_at` |
| `platform_admins` | who may set org quotas (the platform owner) |

**Defaults:** existing orgs 2,000,000 tokens/month with a 200,000/day default per user;
**new orgs 2,000 tokens/month** (`ai_seed_new_org` trigger) until the platform owner
raises them — worth remembering when a new tenant says "AI stopped working".

**Functions.** Service-role only: `ai_quota_check`, `ai_record_usage`, `ai_bot_check`.
Authenticated (each re-checks the caller): `platform_set_org_quota`, `ai_set_user_limit`,
`ai_clear_flag`, `ai_my_usage`, `ai_org_usage`, `platform_org_usage`,
`platform_org_detail`, `is_platform_admin`, `ai_is_org_admin_of`. Internal:
`ai_usage_report`, `ai_org_tz`, `ai_seed_new_org`.

**Bot check rules:** 61 calls in 60 seconds, or 10 identical requests in 5 minutes →
flag, pause 10 minutes, notify the org's active owners/admins. Counting starts after the
most recent flag, so clearing a flag doesn't immediately re-flag. Blocked rows never
count; error rows carry no hash, so they can't look like repeats — but they *do* count
toward the calls-per-minute rule, which is why batch flows stop after the first failure.

## 4. Tracing (`lib/langfuse.js`)

Owner decision: **full tracing** — prompts, outputs, token usage, org id and feature go
to Langfuse. The module is a no-op unless `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`
are set; it posts one `trace-create` + one `generation-create`, times out after 1.2s, and
never throws. Because it is fire-and-forget on Vercel, a trace can be dropped when the
function freezes right after the response — accepted.

Privacy note: resumes and JDs are personal data and they do leave the system in traces.
If the privacy policy changes, this is the file to change.

## 5. The assistant (off until v1.4.0)

`api/ai-query.js` returns 503 and contains nothing else. The old implementation chose a
table and filters with the **service-role** client, so it could read data the caller
could not — that is why it is off. `tests/ai-query-disabled.test.mjs` asserts it makes no
auth, Groq or database call.

When it returns (v1.4.0) it must: run every query under the caller's own RLS (anon key,
or the analytics `SECURITY INVOKER` path), go through `runAI` with the `assistant`
feature, and require a confirmation dialog for any mutation.

## 6. Roadmap

- **v1.3.0** — platform console (set org quotas), per-org AI usage screen (owners/admins
  set user limits, clear flags), "AI today" indicator for every user.
- **v1.4.0** — the assistant returns, RLS-scoped, on quotas.

Spec: `docs/superpowers/specs/2026-09-17-ai-usage-quotas-design.md`.
