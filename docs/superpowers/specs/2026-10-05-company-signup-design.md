# Company sign-up — design

- **Date:** 2026-10-05
- **Status:** approved in conversation by the owner (approach A); this file is
  for the owner's review before the implementation plan.
- **Release:** v1.12.0 (MINOR — a new feature).
- **Part of:** a four-piece sequence the owner set on 2026-10-05:
  1. **company sign-up** (this spec);
  2. trial enforcement — after 14 days a company is blocked until the
     platform owner activates or extends it;
  3. private in-app feedback — read only by the platform owner, nothing
     public;
  4. the public home page at atllanta.com — the #64 landing, restored, with
     Get started and Sign in.

  Each piece gets its own spec and release. Sign-up reaches the public only
  through piece 4, which ships after piece 2.

## 1. Why

A new company cannot start using Atllanta on its own today. Self-serve
company creation was removed on 2026-09-08 (Phase 1b tenancy cutover, commit
`3e87f32`) and never rebuilt:

- **Sign-up creates a login and nothing else.** "Create account" on `/login`
  calls `auth.signUp`. It creates no `organizations` row and no `users` row,
  and nothing sends the person anywhere useful.
- **The app breaks for such a person.** The legacy shell loads with
  `org = null`.
- **The old wizard can't help.** The `#/onboarding` wizard is unlinked, and
  it updates an org that must already exist.
- **The database won't allow it either.** `organizations` has no insert
  policy, and no trigger on `auth.users` creates an organisation.
- **The only way in is an invite.** Since the cutover, the only route is an
  admin invite (`server/legacy/create-org.js`, action `invite`). That creates
  the login *and* the `users` row, so an invited person always has an org.

**Goal:** a person who signs in with Google and belongs to no organisation can
create their company in two short steps and land in the app as its owner, with
the modules they chose switched on.

## 2. Decisions (owner, 2026-10-05)

| Question | Decision |
|---|---|
| Who the page serves | New companies sign up; existing staff sign in. |
| How new companies sign up | **Google now, email later.** Email+password sign-up stays hidden until Resend is set up on atllanta.com (that also fixes password-reset email). |
| Modules for a new company | **Chosen during set-up.** Everything ticked except the RTcompu partner pack, which is never offered. |
| Trial | Existing defaults (`starter`, `trial`, 14 days) are recorded here; **enforcement is piece 2**. |
| Approach | **A:** a new-stack `/start` screen, a Server Action, and one guarded `security definer` database function. Not the legacy API with the service role (forbidden by `CLAUDE.md` §1); not an `auth.users` trigger (it would fire for invited staff and has no company name). |

## 3. The flow

1. **`/login`:**
   - The "Create account" view shows only **Sign up with Google**, with one
     line: "Email sign-up is coming soon."
   - The email+password sign-up form is hidden, not deleted. It comes back
     when Resend works.
   - Sign-in (email+password and Google) is unchanged.
2. **After sign-in**, the legacy shell (`public/index.html`) loads the
   profile. If the session is valid but there is **no `users` row**, it calls
   `location.replace('/start')` before rendering anything.
   - Invited staff always have a row, so they are unaffected.
   - The new-stack pages (`/hrms/*`, `/settings/*`) are unchanged: without a
     row they already show "not available". Every sign-in returns to `/`, so
     the shell is the one entry point that needs the redirect.
3. **`/start`** is a new-stack page, `app/(auth)/start/page.tsx`:
   - Not signed in → redirect to `/login`.
   - Already has a `users` row → redirect to `/`. You can't create a second
     company, and the page can't be reopened by mistake.
   - **Step 1, Company:**
     - company name (required, 2–100 characters);
     - time zone (select, default `Asia/Kolkata`);
     - currency (select, default `INR`).
   - **Step 2, Modules:**
     - a checklist of `people`, `me`, `inbox`, `documents`, `finance`,
       `announcements`, `recruitment`, `crm`, `analytics`, `helpdesk`,
       `projects` and `ai`, with plain labels, all ticked;
     - at least one must stay ticked;
     - `crm_partner` is not listed.
   - **Create company** calls the Server Action `createCompany`. On success
     the browser does a full load of `/` (the legacy app) as the new owner.
     On failure the message is shown in place.
4. **Inviting colleagues** stays where it is (Admin → Members).
   - The unlinked legacy `#/onboarding` wizard is not used. It is removed
     with the other legacy views in Phase 4 item 4.
   - Its leave-type defaults move into `create_company` (§4).

## 4. Data: `public.create_company` (written by Claude, not delegated)

New migration `…_company_signup.sql`:

```
create_company(p_name text, p_timezone text, p_currency text, p_modules text[])
  returns uuid
  security definer, search_path = public
```

### Checks (each refusal raises `42501` or `22023` with a plain message)

- `auth.uid()` must not be null.
- **There must be no `users` row with `id = auth.uid()`.** That means one
  company per account, and no hopping between organisations.
- Name: trimmed, 2–100 characters.
- Time zone must be in `pg_timezone_names`.
- Currency must match `^[A-Z]{3}$`.
- `p_modules` must be non-empty, contain only the twelve keys listed in §3,
  and never include `crm_partner`.

### Writes (one transaction)

1. **The organisation:** insert into `organizations`:
   - `name`, `timezone`, `currency`;
   - `org_type 'direct'`;
   - `slug` = the name lower-cased with non-alphanumerics turned into `-`,
     plus a 6-character random suffix, retried on a unique clash.

   Defaults supply `plan_tier 'starter'`, `payment_status 'trial'`, and
   `trial_ends_at now() + 14 days`.

   The existing `after insert` triggers then seed:
   - the five system roles;
   - the thirteen `org_modules` rows, all off;
   - the CRM pipeline stages;
   - the AI quota rows.
2. **The owner:** insert into `users`:
   - `id = auth.uid()`, `org_id`, `role 'owner'`, `status 'active'`;
   - `email` from `auth.users`;
   - `full_name` from the Google metadata (`full_name`, else `name`, else the
     email's local part);
   - `avatar_url` from the metadata, if present;
   - `date_of_joining` = today in the chosen time zone.
3. **The modules:** update `org_modules` to `is_enabled = true`,
   `enabled_by = auth.uid()`, `enabled_at = now()` for every chosen key.
4. **Leave types:** insert three, the ones the old wizard offered:
   - Casual Leave, `CL`, 12;
   - Sick Leave, `SL`, 12;
   - Earned Leave, `EL`, 15.

   All are `is_paid`. Leave works on day one.
5. **Audit and event:**
   - insert into `audit_logs`: module `platform`, entity
     `organization`/org id, action `created`, new values name/slug/modules;
   - insert the event `platform.org.created` with
     `{org_id, owner_id, name, modules}`.

### The users guard needs one narrow exception

`users_guard_admin_fields()` (an `INSERT`/`UPDATE` trigger on `users`) refuses
an insert with `role = 'owner'` unless the caller `is_org_owner()`. For a
non-admin caller it also rewrites `role` to `member`. The founder of a new
organisation is neither, so the owner insert in step 2 would fail.

The migration replaces the function with the same body plus one clause, placed
first in the signed-in path.

**Allow an `INSERT` with `role = 'owner'` only when all three hold:**

- `new.id = auth.uid()`;
- `current_setting('atllanta.bootstrap_org', true) = new.org_id::text`;
- no `users` row exists yet for `new.org_id`.

`create_company` sets `atllanta.bootstrap_org` with
`set_config(…, true)`, which is transaction-local, immediately before the
owner insert.

**Why this can't be abused:**

- Only `create_company` can create an organisation; there is still no insert
  policy on `organizations`.
- An organisation with no users exists only inside that transaction.
- `users_insert` RLS still requires the row's org to be one the caller already
  belongs to.
- Clients cannot set that setting: PostgREST sets only `request.*`.

Every other rule in the guard is unchanged:

- no moving users between organisations;
- no changing your own role;
- only an owner grants or removes the owner role;
- at least one owner is always kept;
- the custom-role check.

### Grants

- `revoke all … from public, anon`; `grant execute … to authenticated`.
- No new table policies: `organizations` still has no insert policy, so this
  function is the only way in.

### Concurrency

Two simultaneous calls by the same person: the second fails on the
`users_pkey` unique violation, which rolls back its organisation too. The
function maps that to "You already belong to an organisation."

## 5. Server side (new stack)

- `src/lib/platform/signup/schemas.ts`:
  - `createCompanySchema` (Zod): name, timeZone, currency, modules (enum of
    the twelve keys, min 1);
  - the module list with labels;
  - a short list of common time zones and currencies for the selects. The
    database is the final check.
- `src/lib/platform/signup/actions.ts` (`"use server"`), `createCompany`:
  - requires a session (`getSessionUser`); no permission gate, because the
    caller has no org yet, which is the point;
  - runs `select public.create_company(...)` inside `withTransaction` as the
    caller;
  - maps `42501`/`22023`/`23505` to an `ActionError`;
  - returns `ActionResponse<{ orgId }>`.

  The event and audit are written by the function itself, in the same
  transaction, so the action does not publish separately.
- `app/(auth)/start/page.tsx` (server) and `start-form.tsx` (client, the two
  steps). The client form may be delegated to a worker and reviewed; the
  page, action, schema and SQL are written directly.

## 6. Legacy changes

- **`public/index.html`:** after `loadUserProfile()`, if a session exists but
  there is no profile, `location.replace('/start')` and stop.
- **`public/login.html`:**
  - the sign-up view shows only the Google button plus the "coming soon"
    line; `#signup-form` gets `hidden`;
  - the Google button in that view reads **Sign up with Google**;
  - `redirectTo` stays `origin + '/'`, so the shell routes to `/start`.

## 7. Out of scope (later pieces)

- Trial expiry and blocking, and the platform-owner activate/extend screen
  (piece 2).
- Feedback (piece 3).
- The home page and its Get started link (piece 4).
- Email+password sign-up and Resend on atllanta.com.
- Supabase Auth redirect URLs for atllanta.com. The owner adds
  `https://atllanta.com/**` and `https://www.atllanta.com/**` in the Supabase
  dashboard; this is a checklist item in the release notes.

## 8. Testing

### Unit (`tests/company-signup.test.mjs`)

- **Schema:** name bounds; time zone and currency shapes; modules non-empty,
  only known keys, `crm_partner` rejected; no `orgId`/`role`/`userId`
  accepted.
- **Static:**
  - the action calls `create_company` inside `withTransaction`;
  - no service role anywhere in the new files;
  - the shell redirects to `/start` when there is no profile;
  - `/login`'s email sign-up form is hidden;
  - the migration revokes from `anon`, grants to `authenticated`, has
    `security definer` and a fixed `search_path`, and refuses a caller who
    already has a `users` row;
  - the guard's bootstrap clause checks all three conditions;
  - the rest of the guard body is otherwise identical to the live function.

### Production probe (always rolled back, before applying and again live)

Inside one `DO` block that raises at the end:

1. Create a throwaway `auth.users` row.
2. As that user, `create_company` succeeds. Check:
   - org defaults (`trial`, `trial_ends_at` about 14 days out);
   - five roles;
   - only the chosen modules enabled;
   - three leave types;
   - an owner `users` row;
   - one audit row and one event.
3. The same user calling it a second time is refused.
4. An existing RTcompu member calling it is refused.
5. An anonymous call is refused.
6. Bad inputs are refused: a 1-character name, the time zone `Mars/Base`,
   `crm_partner` among the modules, an empty module list.
7. **The guard exception stays narrow.** Each of these is still refused, or
   still downgraded to `member`, as before:
   - a direct `insert into users (…, role 'owner')` by a signed-in user
     without the marker;
   - the same insert with the marker set for a *different* organisation;
   - an owner insert with the marker into an organisation that already has
     users.

### Gates

- Typecheck, lint, build.
- The migration is applied only after the owner says yes. The file is then
  renamed to its recorded version.

## 9. Release notes (v1.12.0)

**What changed:** a new company can sign up with Google, name the company,
choose its modules, and start as owner. Email sign-up is coming once email is
set up.

**Admins need to:**

- **Owner, before testing on atllanta.com:** add `https://atllanta.com/**`
  and `https://www.atllanta.com/**` to Supabase → Authentication → URL
  Configuration → Redirect URLs.
- **Sign-up is not advertised anywhere yet.** The home page (piece 4) comes
  after trial enforcement (piece 2).
