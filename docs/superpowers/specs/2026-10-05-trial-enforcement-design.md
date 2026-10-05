# Trial enforcement — design

- **Date:** 2026-10-05
- **Status:** approved in conversation by the owner (approach A); this file
  is for the owner's review before the implementation plan.
- **Release:** v1.13.0 (MINOR — a new feature).
- **Part of:** the owner's four-piece sequence, piece **2 of 4**: sign-up →
  **trial** → feedback → home page.

## 1. Why

Company sign-up (v1.12.0) starts every new company on `payment_status
'trial'` with `trial_ends_at = now() + 14 days`, but nothing enforces the end
date.

- **Public sign-up waits on this.** The "Sign up" link stays hidden
  (`SIGNUP_OPEN = false` in `public/login.html`) until it ships.
- **The trial data is already stale.** Four of the five existing companies
  sit on trials that ended in July or August, RTcompu (63 people) among
  them.
- **There is no platform-owner screen at all.** The platform functions in the
  database (AI quotas, usage) have never had a screen.

**Goal:**

- A company whose trial has ended, or which the platform owner has paused,
  cannot use Atllanta in either stack, or around them, until the platform
  owner activates it or extends its trial.
- Nothing is deleted; access returns the moment it is restored.

## 2. Decisions (owner, 2026-10-05)

| Question | Decision |
|---|---|
| Existing companies at launch | **All five marked `active`.** |
| How extending works | **7, 14 or 30 days at a time.** The total across all extensions is capped at the company's `max_trial_extension_days` (30 for most; 90 for BlueHire). |
| Contact on the blocked screen | **anchansachinv99@gmail.com** and **8073163762**. Owners and admins see them; everyone else sees "please ask your admin" (Claude's recommendation; the owner did not object). |
| Platform screen scope | **Companies and trials only:** list, Activate, Extend, Pause. AI usage and quotas come later. |
| Approach | **A:** one checkpoint in the database (`auth_org_id()`), plus one `/paused` page both stacks send blocked people to. Not screens only (bypassable); not per-policy edits (about 200 policies). |

## 3. When a company is blocked

| `payment_status` | Blocked when | State shown |
|---|---|---|
| `trial` | `trial_ends_at` is not null and `trial_ends_at <= now()` | `trial_ended` |
| `cancelled` | always | `paused` |
| `active`, `past_due` | never | `ok` |
| `trial` with a future or null `trial_ends_at` | never | `ok` |

- It is evaluated at query time, so no scheduled job is needed. The moment
  `trial_ends_at` passes, the next request is refused.
- **The platform admin** (a row in `platform_admins`) is never blocked,
  whatever their own company's state.
- **Server code and the service role** (`auth.uid()` is null) are
  unaffected, as today. That covers the server event processor, crons and
  the legacy API handlers.

One SQL function holds this rule, so it lives in a single place:

```
public.org_access_state(p_status text, p_trial_ends_at timestamptz)
  returns text  -- 'ok' | 'trial_ended' | 'paused'
  language sql stable
```

## 4. Database (written by Claude, not delegated)

New migration `…_trial_enforcement.sql`.

### 4.1 Launch-day data

```
update organizations set payment_status = 'active'
where created_at < '<migration time>';
```

In practice this is all five existing companies; BlueHire is already
`active`.

New column: `organizations.trial_extended_days int not null default 0`.

### 4.2 The checkpoint: `auth_org_id()`

Same signature (`returns uuid`, `stable security definer`,
`search_path ''`). It now returns the caller's org only when
`org_access_state(...) = 'ok'`, or when the caller is a platform admin.
Otherwise it returns null.

- Every RLS policy that uses `auth_org_id()` or `auth_user_org_ids()`
  (176 of the 207 in `public` and `storage`), and every function built on
  them (`is_org_admin()`, the guards, the legacy RPCs), then refuses or
  returns nothing for a blocked company.
- The policies that only compare `id = auth.uid()`, such as `users_select`
  for your own row, still work. A blocked person can therefore still load
  their own profile and be told why they are blocked.

### 4.3 Explaining the block: `my_org_access()`

```
my_org_access() returns table(state text, org_name text, trial_ends_at timestamptz, role text)
  security definer, search_path public; granted to authenticated
```

It reads the caller's own `users` row joined to its organisation, not
through `auth_org_id()`, so it works while blocked. A person with no
`users` row gets no rows.

### 4.4 Closing a hole: `organizations_guard_billing_fields()`

**The hole.** The live policy `organizations_admin_update` lets an org admin
update their own organisation row with no column limits. An admin of an
expired company could therefore set `payment_status = 'active'` or move
`trial_ends_at` through the REST API.

**The fix.** A new `BEFORE UPDATE` trigger on `organizations`. When
`auth.uid()` is not null and the caller is **not** a platform admin, it
refuses (`42501`, "Billing and trial settings are managed by Atllanta") any
change to:

- `plan_tier`, `payment_status`, `org_type`, `partner_crm_enabled`;
- `trial_started_at`, `trial_ends_at`, `trial_extended_days`,
  `max_trial_extension_days`, `trial_candidate_cap`;
- `credits_included_monthly`, `credit_overage_mode`, `commission_percent`;
- `credits_balance` — **increases only**. Decreases stay allowed because
  `consume_credits()` spends credits while a user is signed in.

**What stays working:**

- The app's own writes: name, slug, time zone, currency, date format, fiscal
  year and logo, from `settings/org.js`, `src/lib/platform/actions.ts` and
  `onboarding.js`.
- The service role.
- The platform functions (§4.5), which run as a platform admin.

### 4.5 Platform functions

All are `security definer` and granted to `authenticated`. Each first
refuses (`42501`) a caller who is not in `platform_admins`.

| Function | Effect | Refusals (`22023`) | Audit `action` / event |
|---|---|---|---|
| `platform_orgs()` | Returns every org: `id, name, people, plan_tier, payment_status, state, trial_ends_at, trial_extended_days, max_trial_extension_days, created_at`. | — | — |
| `platform_activate_org(p_org uuid)` | `payment_status = 'active'`. | unknown org | `activated` / `platform.org.activated` |
| `platform_extend_trial(p_org uuid, p_days int)` | `trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + p_days days`; `trial_extended_days += p_days`. | `p_days` not 7, 14 or 30; status not `trial`; `trial_extended_days + p_days > max_trial_extension_days` ("This would pass the N-day extension limit") | `trial_extended` / `platform.org.trial_extended` |
| `platform_pause_org(p_org uuid)` | `payment_status = 'cancelled'`. | unknown org | `paused` / `platform.org.paused` |

**Audit rows:** `org_id` = the target org, `user_id` = the platform admin,
module `platform`, entity `organization`, with old and new
status/end/extended values.

**Events:** payload `{org_id, by}`. `platform.*` events are already hidden
from the org dashboard feed.

## 5. Screens

### `/paused` (new stack, `app/(auth)/paused/page.tsx`)

The page is server-rendered, using `my_org_access()`:

- **Not signed in** → `/login`.
- **No `users` row** → `/start`.
- **State `ok`** → `/`.

Otherwise:

- **Owners and admins:**
  - *Trial ended:* "Your free trial of Atllanta for {org} ended on {date}.
    To keep using it, contact us:"
  - *Paused:* "Access to Atllanta for {org} is paused. Contact us:"

  followed by the email (`mailto:`) and the phone (`tel:` link, and a
  `https://wa.me/918073163762` WhatsApp link).
- **Everyone else:** "Your company's access to Atllanta is paused. Please
  ask your admin."
- **Everyone:** a **Sign out** button.

The contact details live in one constant (`src/lib/platform/contact.ts`).

### Legacy shell (`public/index.html`)

After the v1.12.0 membership and `/start` check:

```js
const { data: access } = await sb.rpc('my_org_access')
```

If a row comes back with `state !== 'ok'`, run
`location.replace('/paused')` and stop.

If the call fails, fall back to the existing profile-error retry screen. The
database still refuses everything regardless.

### New-stack layouts

- A new `app/(dashboard)/layout.tsx` (it currently has none) checks
  `my_org_access()` and redirects to `/paused`.
- `app/(platform)/settings/layout.tsx` gets the same check.

### `/platform` (new stack, `app/(platform)/platform/page.tsx`)

- **Access:** only for platform admins. The page checks `platform_admins`
  for the session user (`notFound()` otherwise), and the SQL functions
  check again.
- **Table:** company name, people, status badge (Active / Trial / Trial
  ended / Paused / Past due), trial end, days left (negative shows as
  "ended N days ago"), and extensions used (e.g. "7 of 30").
- **Per-row actions:**
  - **Activate**, unless already active;
  - **Extend 7 / 14 / 30**, only on trials, each option disabled once it
    would pass the cap;
  - **Pause**, unless already paused, with an inline "Pause {name}?"
    confirm.
- Server Actions: `activateOrg`, `extendTrial` and `pauseOrg` in
  `src/lib/platform/trials/actions.ts`. Each requires a session, runs the
  matching SQL function inside `withTransaction` as the caller, and maps
  `42501`/`22023` to an `ActionError` using an allow-list of the functions'
  own messages, with a generic fallback (this applies the v1.12.0
  reviewer's minor).

### Service worker

Add `/paused` and `/platform` to `NETWORK_ONLY_PREFIXES` (the rule for every
App Router route).

## 6. Out of scope

- A "N days left" banner during the trial.
- Email or WhatsApp reminders.
- Billing and payments.
- AI usage and quotas on the platform screen.
- Changing `max_trial_extension_days` from the screen.
- Opening the "Sign up" link (`SIGNUP_OPEN`). Piece 4 does that, once this
  is live.
- Screens already open when a company becomes blocked are not
  force-redirected. Their next database call is refused, and the next page
  load lands on `/paused`.

## 7. Testing

### Unit (`tests/trial-enforcement.test.mjs`)

- **Migration, static checks:**
  - the `org_access_state` rule, all four rows of §3;
  - `auth_org_id()` keeps its signature, is `security definer` with a fixed
    `search_path`, uses `org_access_state` and has the platform-admin
    exemption;
  - the launch-day `active` update;
  - the guard trigger lists every protected column, exempts `auth.uid() is
    null` and platform admins, and refuses only credit increases;
  - each platform function checks `platform_admins` first, and
    `platform_extend_trial` enforces 7/14/30, `trial` status and the cap;
  - grants: `authenticated` only, revoked from anon.
- **Static checks on the screens:**
  - the shell redirects to `/paused` after the `/start` check;
  - the new layouts redirect;
  - `/platform` checks `platform_admins`;
  - both routes are network-only in the service worker;
  - the actions use no service role and map errors through the allow-list.

### Production probe (always rolled back, before applying and again live)

1. **A member of a company whose trial has ended**, set up with a
   throwaway org and two throwaway users, owner and member:
   - sees 0 rows of their company's `users`, `attendance` and `leave_types`;
   - cannot insert attendance;
   - can still read their own `users` row;
   - gets `trial_ended` from `my_org_access()`.
2. **The owner of that company** cannot set `payment_status`,
   `trial_ends_at` or `trial_extended_days` on their own org (refused), even
   after being made active through the platform function; can still rename
   it while active; cannot raise `credits_balance`.
3. **As the platform admin:**
   - `platform_extend_trial(org, 14)` → the member can read again;
   - extending past the cap is refused;
   - 7/14/30 only;
   - extending a non-trial is refused;
   - `platform_pause_org` → `paused`, blocked;
   - `platform_activate_org` → `ok`.
4. **A non-admin** calling any `platform_*` function → `42501`.
5. **The platform admin's own org**, set to `cancelled` inside the probe →
   still `ok` for them.
6. **Server code** (role reset, no claims) still reads the blocked org.
7. **After the launch update:** RTcompu, Hiretrack, Atllanta Pvt Ltd and
   Generic CRM Test Co are `active`, and an RTcompu member reads normally.
8. **Speed:** `explain analyze` on one RLS-heavy query as an RTcompu member
   (attendance for a month), before and after, inside the probe.

### Gates

- Typecheck, lint and build pass.
- The migration is applied only after the owner says yes, and the file is
  then renamed to its recorded version.

## 8. Release notes (v1.13.0)

**What changed:**

- Free trials now end. A company whose 14-day trial has ended, or which
  Atllanta has paused, sees a "trial ended" page instead of the app until
  Atllanta reactivates it. Nothing is deleted.
- Existing companies are unaffected: all are now marked active.
- New for the platform owner: a Companies page to activate, extend (7, 14 or
  30 days, within each company's limit) or pause a company.
- Admins can no longer change their company's plan or trial dates directly.

**Admins need to:** nothing.
