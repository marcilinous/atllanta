# Trial Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A company whose trial has ended, or which the platform owner paused, cannot use Atllanta in either stack, or around them, until the platform owner activates it or extends its trial from a new `/platform` screen.

**Architecture:**

- **Database checkpoint:** `auth_org_id()` returns null for a blocked company. That covers the 176 policies built on it and every function using it.
- **Explaining the block:** `my_org_access()` tells a blocked person why. Both stacks send them to `/paused`.
- **Closing the hole:** a `BEFORE UPDATE` guard stops company admins from changing their own billing and trial fields.
- **Platform owner:** four `security definer` `platform_*` functions back the `/platform` screen.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, triggers); Next.js 16 App Router; TypeScript strict; Zod v4; Drizzle (`sql` inside `withTransaction`); the legacy vanilla-JS shell; `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-05-trial-enforcement-design.md`

## Global Constraints

- **Branch:** `claude/trial-enforcement` (off production `6f91af4`). Release **v1.13.0**.
- **Written by Claude, never delegated:**
  - the migration and every SQL function;
  - the Drizzle schema column;
  - the access helpers, the `signOut` action and the platform actions;
  - every page or layout gate and the legacy shell gate.

  Only `app/(platform)/platform/companies-table.tsx` may go to a worker (`route_task` → `delegate_groq`), and it is reviewed before use. No keys or production data go in `context`.
- **No `service_role`** in new code. Reuse the existing `public.is_platform_admin()`; never read `platform_admins` directly from the app (it is revoked from `authenticated`).
- **Blocked rule (verbatim):**
  - `cancelled` → `paused`;
  - `trial` with `trial_ends_at` not null and `<= now()` → `trial_ended`;
  - everything else → `ok`.

  The platform admin is always `ok`.
- **Extensions:** exactly 7, 14 or 30 days; only for `trial`; `trial_extended_days + days <= coalesce(max_trial_extension_days, 30)`; new end = `greatest(coalesce(trial_ends_at, now()), now()) + days`.
- **Guarded `organizations` columns:**
  - `plan_tier`, `payment_status`, `org_type`, `partner_crm_enabled`;
  - `trial_started_at`, `trial_ends_at`, `trial_extended_days`, `max_trial_extension_days`, `trial_candidate_cap`;
  - `credits_included_monthly`, `credit_overage_mode`, `commission_percent`;
  - and `credits_balance` (increases only).

  Exempt: `auth.uid() is null` and platform admins.
- **Contact (verbatim):** email `anchansachinv99@gmail.com`; phone `8073163762`; WhatsApp `https://wa.me/918073163762`.
- **Copy:**
  - guard: "Billing and trial settings are managed by Atllanta";
  - non-admin platform call: "Only the Atllanta platform owner can do that";
  - extension refusals: "Extend by 7, 14 or 30 days", "Only a company on a trial can be extended", "This would pass the N-day extension limit".
- **The migration is applied only after the owner's yes.** The file is then renamed to its recorded version.
- **Shell:** one plain command per call (the worktree guard refuses compound git commands). Tests normalise `\r\n`.

## Review Focus

1. **A company that expires while someone is using it.** Their next database call is refused, and the next page load lands on `/paused`. That load must not loop between `/` and `/paused`. Pinned in Task 4 (`/paused` sends `ok` back to `/`; the shell sends only non-`ok` to `/paused`) and Task 2's probe (state flips with `trial_ends_at`).
2. **A company admin trying to un-expire themselves through the REST API** (`payment_status`, `trial_ends_at`, `credits_balance` up). Refused, while renaming the company still works. Pinned by the Task 2 probe rows G1–G4.
3. **The platform owner's own company being paused or expired.** The owner keeps full access. Pinned by Task 2 probe row P.
4. **Extending past the cap, or a non-trial, or by 10 days.** A readable refusal, and nothing changes. Pinned by the Task 2 probe rows E2–E4 and the Task 6 allow-list test.
5. **The `my_org_access` call failing in the legacy shell.** Falls back to the existing "Try again" screen, never to the app with a blocked org. Pinned by the Task 5 static test.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261005120000_trial_enforcement.sql` (renamed after apply) | `org_access_state`, the column and launch-day update, `auth_org_id`, `my_org_access`, the guard trigger, the `platform_*` functions, grants. |
| `src/db/schema/platform.ts` | Add `trialExtendedDays`. |
| `src/lib/platform/contact.ts` | `PLATFORM_CONTACT` constant. |
| `src/lib/platform/access.ts` | `getOrgAccess(userId)` → `{ state, orgName, trialEndsAt, role } \| null`; `isPlatformAdmin(userId)`. Server-only. |
| `src/lib/auth/sign-out.ts` | `"use server"` `signOut()`. |
| `app/(auth)/paused/page.tsx`, `app/(auth)/paused/sign-out-button.tsx` | The blocked page. |
| `app/(dashboard)/layout.tsx` (new), `app/(platform)/settings/layout.tsx` | Redirect blocked people to `/paused`. |
| `public/index.html`, `public/sw.js` | Legacy gate; network-only `/paused` and `/platform`. |
| `src/lib/platform/trials/schemas.ts`, `src/lib/platform/trials/actions.ts` | `orgActionSchema`, `extendTrialSchema`; `activateOrg`, `extendTrial`, `pauseOrg`, `explainPlatformError`. |
| `app/(platform)/platform/page.tsx`, `app/(platform)/platform/companies-table.tsx` | The platform screen. |
| `tests/trial-enforcement.test.mjs` | All unit and static tests. |
| Release files | `VERSION`, `package.json`, `package-lock.json`, `public/version.json`, `public/sw.js`, `CHANGELOG.md`, `TRANSITION.md`. |

---

### Task 1: Migration and schema column

**Files:**
- Create: `supabase/migrations/20261005120000_trial_enforcement.sql`
- Modify: `src/db/schema/platform.ts` (organizations: after `maxTrialExtensionDays`)
- Test: `tests/trial-enforcement.test.mjs`

**Interfaces:**
- Produces (SQL):
  - `org_access_state(text, timestamptz) → text`;
  - `auth_org_id() → uuid` (same signature);
  - `my_org_access() → table(state, org_name, trial_ends_at, role)`;
  - `platform_orgs() → table(id uuid, name text, people bigint, plan_tier text, payment_status text, state text, trial_ends_at timestamptz, trial_extended_days int, max_trial_extension_days int, created_at timestamptz)`;
  - `platform_activate_org(uuid) → void`;
  - `platform_extend_trial(uuid, int) → timestamptz`;
  - `platform_pause_org(uuid) → void`.
- Produces (TS): `organizations.trialExtendedDays`.

- [ ] **Step 1: Write the failing test**

Create `tests/trial-enforcement.test.mjs`:

```js
// v1.13.0: trial enforcement. A company whose trial has ended, or which the
// platform owner paused, is refused everywhere (auth_org_id() returns null)
// and sent to /paused; the platform owner activates, extends or pauses
// companies at /platform. The same scenarios run against production in an
// always-rolled-back probe before the migration is applied.
// Run: node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const migDir = path.join(ROOT, 'supabase', 'migrations');
const migFile = fs.readdirSync(migDir).find((f) => f.endsWith('_trial_enforcement.sql'));
const sql = migFile ? read('supabase', 'migrations', migFile) : '';
const fnBody = (name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  return sql.slice(start, sql.indexOf('$function$;', start));
};

describe('migration: the blocked rule and the checkpoint', () => {
  test('org_access_state: cancelled → paused, an ended trial → trial_ended, else ok', () => {
    assert.ok(migFile, 'migration file exists');
    const f = fnBody('org_access_state');
    assert.match(f, /when p_status = 'cancelled' then 'paused'/);
    assert.match(f, /when p_status = 'trial' and p_trial_ends_at is not null and p_trial_ends_at <= now\(\) then 'trial_ended'/);
    assert.match(f, /else 'ok'/);
  });

  test('all existing companies become active; the extension counter exists', () => {
    assert.match(sql, /alter table public\.organizations add column if not exists trial_extended_days int not null default 0;/);
    assert.match(sql, /update public\.organizations set payment_status = 'active' where payment_status <> 'active';/);
  });

  test('auth_org_id keeps its shape and returns nothing for a blocked company, except for the platform admin', () => {
    const f = fnBody('auth_org_id');
    assert.match(f, /returns uuid/);
    assert.match(f, /stable security definer/);
    assert.match(f, /set search_path to ''/);
    assert.match(f, /public\.org_access_state\(o\.payment_status, o\.trial_ends_at\) = 'ok'/);
    assert.match(f, /or public\.is_platform_admin\(\)/);
  });

  test('my_org_access explains the block without going through auth_org_id', () => {
    const f = fnBody('my_org_access');
    assert.match(f, /returns table\(state text, org_name text, trial_ends_at timestamptz, role text\)/);
    assert.match(f, /where u\.id = auth\.uid\(\)/);
    assert.doesNotMatch(f, /auth_org_id/);
    assert.match(sql, /grant execute on function public\.my_org_access\(\) to authenticated;/);
  });
});

describe('migration: the billing guard', () => {
  test('protects every billing and trial column; exempts server code and the platform admin; credits may only go down', () => {
    const g = fnBody('organizations_guard_billing_fields');
    assert.match(g, /if auth\.uid\(\) is null or public\.is_platform_admin\(\) then\s+return new;/);
    for (const col of ['plan_tier', 'payment_status', 'org_type', 'partner_crm_enabled', 'trial_started_at', 'trial_ends_at',
      'trial_extended_days', 'max_trial_extension_days', 'trial_candidate_cap', 'credits_included_monthly',
      'credit_overage_mode', 'commission_percent']) {
      assert.match(g, new RegExp(`new\\.${col} is distinct from old\\.${col}`), col);
    }
    assert.match(g, /coalesce\(new\.credits_balance, 0\) > coalesce\(old\.credits_balance, 0\)/);
    assert.match(g, /'Billing and trial settings are managed by Atllanta' using errcode = '42501'/);
    assert.match(sql, /create trigger trg_organizations_guard_billing_fields\s+before update on public\.organizations/);
  });
});

describe('migration: platform functions', () => {
  test('each checks the platform admin first and is only for signed-in users', () => {
    for (const [name, sig] of [['platform_orgs', ''], ['platform_activate_org', 'uuid'], ['platform_extend_trial', 'uuid, int'], ['platform_pause_org', 'uuid']]) {
      const f = fnBody(name);
      assert.match(f, /security definer/, name);
      assert.match(f, /if not public\.is_platform_admin\(\) then\s+raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';/, name);
      assert.ok(sql.includes(`revoke all on function public.${name}(${sig}) from public, anon;`), `${name} revoked from anon`);
      assert.ok(sql.includes(`grant execute on function public.${name}(${sig}) to authenticated;`), `${name} granted`);
    }
  });

  test('extending: 7/14/30 only, trials only, within the cap, from today or the old end', () => {
    const f = fnBody('platform_extend_trial');
    assert.match(f, /p_days not in \(7, 14, 30\)/);
    assert.match(f, /if v_status <> 'trial' then/);
    assert.match(f, /if v_used \+ p_days > v_cap then/);
    assert.match(f, /coalesce\(max_trial_extension_days, 30\)/);
    assert.match(f, /greatest\(coalesce\(v_ends, now\(\)\), now\(\)\) \+ make_interval\(days => p_days\)/);
  });

  test('every change is audited against the target company and published', () => {
    for (const [name, action, event] of [
      ['platform_activate_org', 'activated', 'platform.org.activated'],
      ['platform_extend_trial', 'trial_extended', 'platform.org.trial_extended'],
      ['platform_pause_org', 'paused', 'platform.org.paused'],
    ]) {
      const f = fnBody(name);
      assert.ok(f.includes(`'platform', 'organization', p_org, '${action}'`), `${name} audit`);
      assert.ok(f.includes(`'${event}'`), `${name} event`);
    }
  });
});

describe('schema mirror', () => {
  test('Drizzle knows trial_extended_days', () => {
    assert.match(read('src', 'db', 'schema', 'platform.ts'), /trialExtendedDays: integer\("trial_extended_days"\)\.notNull\(\)\.default\(0\),/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/trial-enforcement.test.mjs`
Expected: FAIL on "migration file exists" and the schema mirror.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261005120000_trial_enforcement.sql`:

```sql
-- v1.13.0: trial enforcement (spec docs/superpowers/specs/2026-10-05-trial-enforcement-design.md).
--
-- A company is blocked when its trial has ended or the platform owner paused
-- it (payment_status 'cancelled'). auth_org_id() — behind 176 of the 207
-- policies and every org-scoped function — returns null for a blocked
-- company, so it is refused everywhere at once; my_org_access() tells the
-- person why. The platform admin is never blocked; server code (no
-- auth.uid()) is unaffected. A guard stops company admins changing their
-- own billing and trial fields, which organizations_admin_update allowed.

-- 1. The one place the rule lives.
create or replace function public.org_access_state(p_status text, p_trial_ends_at timestamptz)
returns text
language sql
stable
set search_path to ''
as $function$
  select case
    when p_status = 'cancelled' then 'paused'
    when p_status = 'trial' and p_trial_ends_at is not null and p_trial_ends_at <= now() then 'trial_ended'
    else 'ok'
  end
$function$;

grant execute on function public.org_access_state(text, timestamptz) to authenticated;

-- 2. Extension counter; every company that exists today is active (owner, 2026-10-05).
alter table public.organizations add column if not exists trial_extended_days int not null default 0;
update public.organizations set payment_status = 'active' where payment_status <> 'active';

-- 3. The checkpoint.
create or replace function public.auth_org_id()
returns uuid
language sql
stable security definer
set search_path to ''
as $function$
  select u.org_id
  from public.users u
  join public.organizations o on o.id = u.org_id
  where u.id = auth.uid()
    and (public.org_access_state(o.payment_status, o.trial_ends_at) = 'ok'
         or public.is_platform_admin())
$function$;

-- 4. Why am I blocked? Reads the caller's own row, not through auth_org_id().
create or replace function public.my_org_access()
returns table(state text, org_name text, trial_ends_at timestamptz, role text)
language sql
stable security definer
set search_path to ''
as $function$
  select case when public.is_platform_admin() then 'ok'
              else public.org_access_state(o.payment_status, o.trial_ends_at) end,
         o.name, o.trial_ends_at, u.role
  from public.users u
  join public.organizations o on o.id = u.org_id
  where u.id = auth.uid()
$function$;

revoke all on function public.my_org_access() from public, anon;
grant execute on function public.my_org_access() to authenticated;

-- 5. Billing and trial fields are Atllanta's, not the company's.
create or replace function public.organizations_guard_billing_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or public.is_platform_admin() then
    return new;
  end if;
  if new.plan_tier is distinct from old.plan_tier
     or new.payment_status is distinct from old.payment_status
     or new.org_type is distinct from old.org_type
     or new.partner_crm_enabled is distinct from old.partner_crm_enabled
     or new.trial_started_at is distinct from old.trial_started_at
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.trial_extended_days is distinct from old.trial_extended_days
     or new.max_trial_extension_days is distinct from old.max_trial_extension_days
     or new.trial_candidate_cap is distinct from old.trial_candidate_cap
     or new.credits_included_monthly is distinct from old.credits_included_monthly
     or new.credit_overage_mode is distinct from old.credit_overage_mode
     or new.commission_percent is distinct from old.commission_percent
     or coalesce(new.credits_balance, 0) > coalesce(old.credits_balance, 0) then
    raise exception 'Billing and trial settings are managed by Atllanta' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_organizations_guard_billing_fields on public.organizations;
create trigger trg_organizations_guard_billing_fields
  before update on public.organizations
  for each row execute function public.organizations_guard_billing_fields();

-- 6. The platform owner's screen.
create or replace function public.platform_orgs()
returns table(id uuid, name text, people bigint, plan_tier text, payment_status text, state text,
              trial_ends_at timestamptz, trial_extended_days int, max_trial_extension_days int, created_at timestamptz)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';
  end if;
  return query
    select o.id, o.name,
           (select count(*) from public.users u where u.org_id = o.id),
           o.plan_tier, o.payment_status,
           public.org_access_state(o.payment_status, o.trial_ends_at),
           o.trial_ends_at, o.trial_extended_days, coalesce(o.max_trial_extension_days, 30), o.created_at
    from public.organizations o
    order by o.created_at;
end;
$function$;

create or replace function public.platform_activate_org(p_org uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';
  end if;
  select o.payment_status into v_old from public.organizations o where o.id = p_org for update;
  if not found then
    raise exception 'Company not found' using errcode = '22023';
  end if;
  update public.organizations set payment_status = 'active', updated_at = now() where id = p_org;
  insert into public.audit_logs (org_id, user_id, module, entity_type, entity_id, action, old_values, new_values)
  values (p_org, auth.uid(), 'platform', 'organization', p_org, 'activated',
          jsonb_build_object('payment_status', v_old), jsonb_build_object('payment_status', 'active'));
  insert into public.events (org_id, event_type, actor_id, payload)
  values (p_org, 'platform.org.activated', auth.uid(), jsonb_build_object('org_id', p_org, 'by', auth.uid()));
end;
$function$;

create or replace function public.platform_extend_trial(p_org uuid, p_days int)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_ends timestamptz;
  v_used int;
  v_cap int;
  v_new timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 14, 30) then
    raise exception 'Extend by 7, 14 or 30 days' using errcode = '22023';
  end if;
  select payment_status, trial_ends_at, trial_extended_days, coalesce(max_trial_extension_days, 30)
    into v_status, v_ends, v_used, v_cap
  from public.organizations where id = p_org for update;
  if not found then
    raise exception 'Company not found' using errcode = '22023';
  end if;
  if v_status <> 'trial' then
    raise exception 'Only a company on a trial can be extended' using errcode = '22023';
  end if;
  if v_used + p_days > v_cap then
    raise exception 'This would pass the %-day extension limit', v_cap using errcode = '22023';
  end if;
  v_new := greatest(coalesce(v_ends, now()), now()) + make_interval(days => p_days);
  update public.organizations
     set trial_ends_at = v_new, trial_extended_days = v_used + p_days, updated_at = now()
   where id = p_org;
  insert into public.audit_logs (org_id, user_id, module, entity_type, entity_id, action, old_values, new_values)
  values (p_org, auth.uid(), 'platform', 'organization', p_org, 'trial_extended',
          jsonb_build_object('trial_ends_at', v_ends, 'trial_extended_days', v_used),
          jsonb_build_object('trial_ends_at', v_new, 'trial_extended_days', v_used + p_days));
  insert into public.events (org_id, event_type, actor_id, payload)
  values (p_org, 'platform.org.trial_extended', auth.uid(),
          jsonb_build_object('org_id', p_org, 'by', auth.uid(), 'days', p_days, 'trial_ends_at', v_new));
  return v_new;
end;
$function$;

create or replace function public.platform_pause_org(p_org uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';
  end if;
  select o.payment_status into v_old from public.organizations o where o.id = p_org for update;
  if not found then
    raise exception 'Company not found' using errcode = '22023';
  end if;
  update public.organizations set payment_status = 'cancelled', updated_at = now() where id = p_org;
  insert into public.audit_logs (org_id, user_id, module, entity_type, entity_id, action, old_values, new_values)
  values (p_org, auth.uid(), 'platform', 'organization', p_org, 'paused',
          jsonb_build_object('payment_status', v_old), jsonb_build_object('payment_status', 'cancelled'));
  insert into public.events (org_id, event_type, actor_id, payload)
  values (p_org, 'platform.org.paused', auth.uid(), jsonb_build_object('org_id', p_org, 'by', auth.uid()));
end;
$function$;

revoke all on function public.platform_orgs() from public, anon;
grant execute on function public.platform_orgs() to authenticated;
revoke all on function public.platform_activate_org(uuid) from public, anon;
grant execute on function public.platform_activate_org(uuid) to authenticated;
revoke all on function public.platform_extend_trial(uuid, int) from public, anon;
grant execute on function public.platform_extend_trial(uuid, int) to authenticated;
revoke all on function public.platform_pause_org(uuid) from public, anon;
grant execute on function public.platform_pause_org(uuid) to authenticated;
```

- [ ] **Step 4: Add the Drizzle column**

In `src/db/schema/platform.ts`, after `maxTrialExtensionDays: integer("max_trial_extension_days").default(30),` add:

```ts
  // v1.13.0: days already granted by platform_extend_trial(); capped at maxTrialExtensionDays.
  trialExtendedDays: integer("trial_extended_days").notNull().default(0),
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `node --test tests/trial-enforcement.test.mjs`. Expected: PASS (all tests).
Run: `npx tsc --noEmit -p .`. Expected: no output.

- [ ] **Step 6: Check against the live database before probing**

With `mcp__claude_ai_Supabase__execute_sql`:
- confirm `public.is_platform_admin()` is `select exists (select 1 from public.platform_admins where user_id = auth.uid())`;
- confirm `authenticated` has `execute` on it;
- confirm `auth_org_id()`'s live grants. `create or replace` keeps them.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261005120000_trial_enforcement.sql src/db/schema/platform.ts tests/trial-enforcement.test.mjs
git commit -m "v1.13.0: trial enforcement migration (not yet applied)"
```

---

### Task 2: Rolled-back production probe (apply later, on the owner's yes)

**Files:** none until the apply. Then rename `supabase/migrations/20261005120000_trial_enforcement.sql` → `<recorded>_trial_enforcement.sql`.

**Interfaces:**
- Consumes: the Task 1 SQL verbatim.

- [ ] **Step 1: Run the probe, always rolled back**

One `DO $probe$ … $probe$` block via `mcp__claude_ai_Supabase__execute_sql`:

1. **Set up.**
   - `execute $mig$ <Task 1 SQL> $mig$;`
   - Look up the platform admin: `select user_id from platform_admins limit 1` → `v_pa`.
   - Look up an RTcompu member: `9d92f586-27f9-4988-bcf0-7f7cce49d298` (re-check the role first: `select role from users where id = …`).
   - Create two throwaway `auth.users` rows, `u_owner` and `u_mem`. Then, as server code (role reset, no claims):
     - insert org `X` with `payment_status 'trial'` and `trial_ends_at now() - interval '1 day'`;
     - insert `users` rows for both (owner and member);
     - insert one `attendance` row for `u_mem`.
2. **B (blocked).** As `u_mem` (claims plus `set local role authenticated`), record:
   - `count(*)` from `users`, `attendance` and `leave_types` (expect 0);
   - own row visible (`select 1 from users where id = auth.uid()`, expect 1);
   - `my_org_access()` state (expect `trial_ended`);
   - an attendance insert for today, which must fail.
3. **G (the guard).** As `u_owner`, each attempt in its own `begin … exception` block:
   - G1: `update organizations set payment_status='active' where id = X`. Expect refused, or 0 rows, since `organizations_admin_update` needs `auth_org_id()`, which is null while blocked.
   - Then, as the platform admin, `platform_activate_org(X)`.
   - Back as `u_owner`:
     - G2: `set payment_status='trial'` → `42501`;
     - G3: `set trial_ends_at = now() + interval '1 year'` → `42501`;
     - G4: `set credits_balance = credits_balance + 100` → `42501`;
     - G5: `set name = 'Renamed'` → 1 row.
4. **E (extensions).** As `v_pa`:
   - `platform_pause_org(X)` → as `u_mem`, state `paused`, reads 0.
   - Set X back to `trial` as server code (role reset), with `trial_ends_at` in the past.
   - E1: `platform_extend_trial(X, 14)` → as `u_mem`, state `ok`, reads > 0.
   - E2: `platform_extend_trial(X, 10)` → `22023`.
   - E3: `platform_extend_trial(X, 30)` (14 + 30 > 30) → `22023`.
   - E4: activate, then `platform_extend_trial(X, 7)` → `22023` (not a trial).
5. **N (not admin).** As `u_mem`, each `platform_*` function → `42501`.
6. **P (platform admin's own org).** As server code, set `v_pa`'s org to `cancelled`. As `v_pa`:
   - `my_org_access()` state is `ok`;
   - `count(*)` of own-org `users` is > 0.
7. **S (server code).** Role reset, `request.jwt.claims` cleared: `count(*)` of org X's users is 2.
8. **L (launch).** Count orgs with `payment_status <> 'active'` among the five pre-existing ones (expect 0 after the migration body ran). As the RTcompu member, `count(*)` from `users` is > 0.
9. **Speed.** As the RTcompu member, time `select count(*) from attendance where date >= current_date - 30` with `clock_timestamp()` before and after, both before running `$mig$` and after.

   *Ruling allowed:* if measuring "before" needs a second probe without the migration, run it.
10. Finally: `raise exception 'PROBE (rolled back): %', r;`

Expected:
- B: 0 / 0 / 0, own row 1, `trial_ended`, insert refused.
- G1 refused or 0 rows; G2–G4 `42501`; G5 1 row.
- Pause → `paused`; E1 `ok`; E2–E4 `22023`.
- N all `42501`.
- P `ok` and > 0.
- S 2.
- L 0 non-active, RTcompu reads.
- Speed: same order of magnitude.

- [ ] **Steps 2–6 run after Task 7, with a single owner question**

The steps:
- (2) report and ask for a yes;
- (3) `apply_migration` named `trial_enforcement`, then read its version from `supabase_migrations.schema_migrations`;
- (4) `git mv` to the recorded version;
- (5) re-run the probe live without `$mig$`, still rolled back;
- (6) run the tests, commit "v1.13.0: trial_enforcement migration applied; file renamed to its recorded version".

---

### Task 3: Shared server helpers — contact, access, sign-out

**Files:**
- Create: `src/lib/platform/contact.ts`, `src/lib/platform/access.ts`, `src/lib/auth/sign-out.ts`
- Test: `tests/trial-enforcement.test.mjs` (append)

**Interfaces:**
- Produces:
  - `PLATFORM_CONTACT: { email: string; phone: string; whatsapp: string }`;
  - `type OrgAccess = { state: "ok" | "trial_ended" | "paused"; orgName: string; trialEndsAt: string | null; role: string }`;
  - `getOrgAccess(userId: string): Promise<OrgAccess | null>`;
  - `isPlatformAdmin(userId: string): Promise<boolean>`;
  - `signOut(): Promise<void>` (Server Action; redirects to `/login`).

- [ ] **Step 1: Write the failing test (append)**

```js
describe('static: shared helpers', () => {
  test('the contact shown to blocked companies is the owner\'s', async () => {
    const { PLATFORM_CONTACT } = await import('../src/lib/platform/contact.ts');
    assert.deepEqual(PLATFORM_CONTACT, {
      email: 'anchansachinv99@gmail.com',
      phone: '8073163762',
      whatsapp: 'https://wa.me/918073163762',
    });
  });

  test('access helpers ask the database as the caller, never the table directly', () => {
    const a = read('src', 'lib', 'platform', 'access.ts');
    assert.match(a, /^import "server-only";/m);
    assert.match(a, /select \* from public\.my_org_access\(\)/);
    assert.match(a, /select public\.is_platform_admin\(\) as is_admin/);
    assert.match(a, /withTransaction\(\{ id: userId \}/);
    assert.doesNotMatch(a, /from platform_admins|platformAdmins|service_?role/i);
  });

  test('sign-out is a server action that clears the session and goes to /login', () => {
    const s = read('src', 'lib', 'auth', 'sign-out.ts');
    assert.match(s, /^"use server";/);
    assert.match(s, /await supabase\.auth\.signOut\(\);/);
    assert.match(s, /redirect\("\/login"\);/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/trial-enforcement.test.mjs`
Expected: FAIL (module not found / ENOENT).

- [ ] **Step 3: Implement**

`src/lib/platform/contact.ts`:

```ts
// Who a blocked company contacts (owner, 2026-10-05). Shown on /paused to
// owners and admins only. No `server-only`: tests import it.
export const PLATFORM_CONTACT = {
  email: "anchansachinv99@gmail.com",
  phone: "8073163762",
  whatsapp: "https://wa.me/918073163762",
} as const;
```

`src/lib/platform/access.ts`:

```ts
// Is this person's company allowed in, and are they the platform owner?
// Both ask the database as the caller: my_org_access() works even while the
// company is blocked (it reads the caller's own row, not auth_org_id()), and
// is_platform_admin() is the only way the app reads platform_admins.
import "server-only";
import { sql } from "drizzle-orm";
import { withTransaction } from "../../db/transaction";

export type OrgAccessState = "ok" | "trial_ended" | "paused";

export interface OrgAccess {
  state: OrgAccessState;
  orgName: string;
  trialEndsAt: string | null;
  role: string;
}

export async function getOrgAccess(userId: string): Promise<OrgAccess | null> {
  const rows = (await withTransaction({ id: userId }, (tx) =>
    tx.execute(sql`select * from public.my_org_access()`)
  )) as unknown as { state: OrgAccessState; org_name: string; trial_ends_at: string | Date | null; role: string | null }[];
  const r = rows[0];
  if (!r) return null;
  return {
    state: r.state,
    orgName: r.org_name,
    trialEndsAt: r.trial_ends_at ? new Date(r.trial_ends_at).toISOString() : null,
    role: r.role ?? "member",
  };
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const rows = (await withTransaction({ id: userId }, (tx) =>
    tx.execute(sql`select public.is_platform_admin() as is_admin`)
  )) as unknown as { is_admin: boolean }[];
  return rows[0]?.is_admin === true;
}
```

`src/lib/auth/sign-out.ts`:

```ts
"use server";

// Ends the session (both stacks share the cookie) and goes to sign-in.
// Used from /paused, where the legacy app's own sign-out is out of reach.
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "../supabase/server";

export async function signOut(): Promise<void> {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `node --test tests/trial-enforcement.test.mjs`. Expected: PASS.
Run: `npx tsc --noEmit -p .`. Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platform/contact.ts src/lib/platform/access.ts src/lib/auth/sign-out.ts tests/trial-enforcement.test.mjs
git commit -m "v1.13.0: org access helpers, platform contact, sign-out action"
```

---

### Task 4: `/paused` page

**Files:**
- Create: `app/(auth)/paused/page.tsx`, `app/(auth)/paused/sign-out-button.tsx`
- Test: `tests/trial-enforcement.test.mjs` (append)

**Interfaces:**
- Consumes: `getSessionUser`, `getOrgAccess`, `PLATFORM_CONTACT`, `signOut`, `formatDate` (from `app/(dashboard)/hrms/format.ts`: `formatDate(day: "YYYY-MM-DD"): string`).
- Produces: the route `/paused`.

- [ ] **Step 1: Write the failing test (append)**

```js
describe('static: /paused', () => {
  const page = () => read('app', '(auth)', 'paused', 'page.tsx');

  test('routes the signed-out, the company-less and the allowed away; never loops', () => {
    const p = page();
    assert.match(p, /if \(!user\) redirect\("\/login"\);/);
    assert.match(p, /if \(!access\) redirect\("\/start"\);/);
    assert.match(p, /if \(access\.state === "ok"\) redirect\("\/"\);/);
  });

  test('only owners and admins see the contact; everyone can sign out', () => {
    const p = page();
    assert.match(p, /const canContact = access\.role === "owner" \|\| access\.role === "admin";/);
    assert.match(p, /PLATFORM_CONTACT\.email/);
    assert.match(p, /PLATFORM_CONTACT\.phone/);
    assert.match(p, /PLATFORM_CONTACT\.whatsapp/);
    assert.match(p, /Please ask your admin\./);
    assert.match(p, /<SignOutButton \/>/);
    const b = read('app', '(auth)', 'paused', 'sign-out-button.tsx');
    assert.match(b, /^"use client";/);
    assert.match(b, /signOut\(\)/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/trial-enforcement.test.mjs`
Expected: FAIL (ENOENT on `page.tsx`).

- [ ] **Step 3: Implement**

`app/(auth)/paused/page.tsx`:

```tsx
// Where a blocked company lands (v1.13.0): its trial has ended or Atllanta
// paused it. The database already refuses everything; this page explains.
// Owners and admins get the contact; everyone else is told to ask them.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { getOrgAccess } from "@/src/lib/platform/access";
import { PLATFORM_CONTACT } from "@/src/lib/platform/contact";
import { formatDate } from "../../(dashboard)/hrms/format";
import SignOutButton from "./sign-out-button";

export const metadata: Metadata = {
  title: "Access paused · Atllanta",
};

export default async function PausedPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await getOrgAccess(user.id);
  if (!access) redirect("/start");
  if (access.state === "ok") redirect("/");

  const canContact = access.role === "owner" || access.role === "admin";
  const ended = access.trialEndsAt ? formatDate(access.trialEndsAt.slice(0, 10)) : null;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-4 py-16 sm:px-6">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">
          {access.state === "trial_ended" ? "Your free trial has ended" : "Access is paused"}
        </h1>
        {canContact ? (
          <>
            <p className="text-sm">
              {access.state === "trial_ended"
                ? `Your free trial of Atllanta for ${access.orgName} ended${ended ? ` on ${ended}` : ""}. To keep using it, contact us:`
                : `Access to Atllanta for ${access.orgName} is paused. Contact us:`}
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              <li>
                Email: <a className="text-primary hover:underline" href={`mailto:${PLATFORM_CONTACT.email}`}>{PLATFORM_CONTACT.email}</a>
              </li>
              <li>
                Phone: <a className="text-primary hover:underline" href={`tel:+91${PLATFORM_CONTACT.phone}`}>{PLATFORM_CONTACT.phone}</a>
                {" · "}
                <a className="text-primary hover:underline" href={PLATFORM_CONTACT.whatsapp} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">Nothing has been deleted. Everything is back as soon as access is restored.</p>
          </>
        ) : (
          <p className="text-sm">Your company&rsquo;s access to Atllanta is paused. Please ask your admin.</p>
        )}
        <div>
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
```

`app/(auth)/paused/sign-out-button.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { signOut } from "@/src/lib/auth/sign-out";
import { Button } from "@/components/ui/button";

export default function SignOutButton() {
  const [isPending, startTransition] = useTransition();
  return (
    <Button type="button" variant="outline" disabled={isPending} onClick={() => startTransition(() => signOut())}>
      {isPending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
```

- [ ] **Step 4: Run the tests, typegen, typecheck and lint**

```bash
node --test tests/trial-enforcement.test.mjs
npx next typegen
npx tsc --noEmit -p .
npx eslint "app/(auth)/paused" src/lib/platform src/lib/auth/sign-out.ts
```

Expected: PASS, no output, no output, 0 problems.

- [ ] **Step 5: Commit**

```bash
git add "app/(auth)/paused" tests/trial-enforcement.test.mjs
git commit -m "v1.13.0: /paused page"
```

---

### Task 5: Gates — new-stack layouts, legacy shell, service worker

**Files:**
- Create: `app/(dashboard)/layout.tsx`
- Modify: `app/(platform)/settings/layout.tsx` (make it `async`; add the check at the top)
- Modify: `public/index.html` (after the v1.12.0 `if (!getMembership()) { … }` block)
- Modify: `public/sw.js:3`
- Test: `tests/trial-enforcement.test.mjs` (append)

**Interfaces:**
- Consumes: `getSessionUser`, `getOrgAccess` (Task 3).

- [ ] **Step 1: Write the failing test (append)**

```js
describe('static: gates', () => {
  test('new-stack layouts send a blocked company to /paused', () => {
    for (const file of [['app', '(dashboard)', 'layout.tsx'], ['app', '(platform)', 'settings', 'layout.tsx']]) {
      const l = read(...file);
      assert.match(l, /const access = user \? await getOrgAccess\(user\.id\) : null;\s+if \(access && access\.state !== "ok"\) redirect\("\/paused"\);/, file.join('/'));
    }
  });

  test('the legacy shell checks access after the /start check, and a failed check shows the retry', () => {
    const html = read('public', 'index.html');
    const start = html.indexOf("window.location.replace('/start');");
    const check = html.indexOf("await sb.rpc('my_org_access')");
    assert.ok(start > -1 && check > start, 'after the /start check');
    const gate = html.slice(check, check + 900);
    assert.match(gate, /if \(accessError\) \{/);
    assert.match(gate, /showProfileRetry\(\);/);
    assert.match(gate, /if \(access && access\.state !== 'ok'\) \{\s+window\.location\.replace\('\/paused'\);/);
  });

  test('/paused and /platform are never served from the service-worker cache', () => {
    const list = read('public', 'sw.js').match(/const NETWORK_ONLY_PREFIXES = \[([^\]]*)\]/)[1];
    assert.match(list, /"\/paused"/);
    assert.match(list, /"\/platform"/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/trial-enforcement.test.mjs`
Expected: FAIL (ENOENT on `app/(dashboard)/layout.tsx`).

- [ ] **Step 3: Implement**

`app/(dashboard)/layout.tsx`:

```tsx
// Every new-stack workspace screen (/hrms/*) sits under this layout. A
// company whose trial has ended or which Atllanta paused goes to /paused —
// the database refuses its data anyway; this just explains (v1.13.0).
import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { getOrgAccess } from "@/src/lib/platform/access";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const access = user ? await getOrgAccess(user.id) : null;
  if (access && access.state !== "ok") redirect("/paused");
  return <>{children}</>;
}
```

`app/(platform)/settings/layout.tsx`:
- Change `export default function SettingsLayout(` to `export default async function SettingsLayout(`.
- Add the imports:
  ```tsx
  import { redirect } from "next/navigation";
  import { getSessionUser } from "@/src/lib/supabase/server";
  import { getOrgAccess } from "@/src/lib/platform/access";
  ```
- Insert as the first lines of the function body:
  ```tsx
    // v1.13.0: a blocked company goes to /paused.
    const user = await getSessionUser();
    const access = user ? await getOrgAccess(user.id) : null;
    if (access && access.state !== "ok") redirect("/paused");
  ```

`public/index.html`:

1. Extract the retry markup into a function, defined just above `if (!getMembership()) {`:
   ```js
   function showProfileRetry() {
     document.body.innerHTML = '<main style="max-width:28rem;margin:4rem auto;padding:0 1rem;font-family:system-ui,sans-serif">'
       + '<p>We couldn&rsquo;t load your account. Check your connection and try again.</p>'
       + '<button type="button" class="btn btn-primary" id="profile-retry">Try again</button></main>';
     document.getElementById('profile-retry').addEventListener('click', () => window.location.reload());
   }
   ```
2. Inside `if (getProfileError()) {`, replace the three lines that set `innerHTML` and add the listener with `showProfileRetry();`. Keep the `throw`.
3. Immediately after the closing `}` of `if (!getMembership()) { … }`, add:
   ```js
   // v1.13.0: a company whose trial has ended, or which Atllanta paused, goes
   // to /paused. The database refuses its data anyway; a failed check is not
   // "allowed" — show the retry instead of an app that cannot load.
   const { data: accessRows, error: accessError } = await sb.rpc('my_org_access');
   if (accessError) {
     showProfileRetry();
     throw new Error('Access could not be checked');
   }
   const access = accessRows?.[0];
   if (access && access.state !== 'ok') {
     window.location.replace('/paused');
     throw new Error('Company access paused');
   }
   ```
   Verify that `sb` is imported in `public/index.html` (`grep -n "import sb" public/index.html`). If it is not, add `import sb from '/js/supabase.js';` beside the auth import and ledger the ruling.

`public/sw.js` line 3 becomes:

```js
const NETWORK_ONLY_PREFIXES = ["/settings", "/session", "/auth", "/health", "/hrms", "/start", "/paused", "/platform"];
```

- [ ] **Step 4: Run the tests and the full suite**

```bash
node --test tests/trial-enforcement.test.mjs
npm run test:unit
npx tsc --noEmit -p .
```

Expected: all PASS (`tests/company-signup.test.mjs` included — its retry and redirect assertions still hold); no type errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/layout.tsx" "app/(platform)/settings/layout.tsx" public/index.html public/sw.js tests/trial-enforcement.test.mjs
git commit -m "v1.13.0: send blocked companies to /paused from both stacks"
```

---

### Task 6: `/platform` screen and actions

**Files:**
- Create: `src/lib/platform/trials/schemas.ts`, `src/lib/platform/trials/actions.ts`
- Create: `app/(platform)/platform/page.tsx`, `app/(platform)/platform/companies-table.tsx` (client; may be delegated, then reviewed)
- Test: `tests/trial-enforcement.test.mjs` (append)

**Interfaces:**
- Consumes: `isPlatformAdmin` (Task 3); `platform_orgs`, `platform_activate_org`, `platform_extend_trial`, `platform_pause_org` (Task 1); `action`, `ActionError`; `withTransaction`; `getSessionUser`.
- Produces:
  - `orgActionSchema` (`{ orgId: uuid }`);
  - `extendTrialSchema` (`{ orgId: uuid; days: 7 | 14 | 30 }`);
  - `explainPlatformError(err): string | null`;
  - `activateOrg(raw) → ActionResponse<{ orgId }>`;
  - `extendTrial(raw) → ActionResponse<{ orgId; trialEndsAt }>`;
  - `pauseOrg(raw) → ActionResponse<{ orgId }>`;
  - `type PlatformOrg = { id; name; people: number; planTier; paymentStatus; state: "ok" | "trial_ended" | "paused"; trialEndsAt: string | null; trialExtendedDays: number; maxTrialExtensionDays: number; createdAt: string }`.

- [ ] **Step 1: Write the failing test (append)**

```js
describe('platform: schemas and actions', () => {
  test('extend accepts only 7, 14 or 30 days and a real company id', async () => {
    const { extendTrialSchema, orgActionSchema } = await import('../src/lib/platform/trials/schemas.ts');
    const id = '7b0e6c1e-1234-4abc-8def-0123456789ab';
    for (const d of [7, 14, 30]) assert.ok(extendTrialSchema.safeParse({ orgId: id, days: d }).success, String(d));
    for (const d of [0, 10, 31, '7']) assert.equal(extendTrialSchema.safeParse({ orgId: id, days: d }).success, false, String(d));
    assert.equal(orgActionSchema.safeParse({ orgId: 'x' }).success, false);
  });

  test('only the functions\' own refusals reach the screen', async () => {
    const { explainPlatformError } = await import('../src/lib/platform/trials/explain.ts');
    const e = (code, message) => ({ code, message });
    assert.equal(explainPlatformError(e('22023', 'This would pass the 30-day extension limit')), 'This would pass the 30-day extension limit');
    assert.equal(explainPlatformError(e('22023', 'Only a company on a trial can be extended')), 'Only a company on a trial can be extended');
    assert.equal(explainPlatformError(e('42501', 'Only the Atllanta platform owner can do that')), 'Only the Atllanta platform owner can do that');
    assert.equal(explainPlatformError(e('42501', 'new row violates row-level security policy for table "organizations"')), null);
    assert.equal(explainPlatformError(e('XX000', 'boom')), null);
  });

  test('actions run the platform functions as the caller, without the service role', () => {
    const s = read('src', 'lib', 'platform', 'trials', 'actions.ts');
    assert.match(s, /^"use server";/);
    for (const fn of ['platform_activate_org', 'platform_extend_trial', 'platform_pause_org']) assert.ok(s.includes(`public.${fn}(`), fn);
    assert.match(s, /withTransaction\(\{ id: user\.id \}/);
    assert.match(s, /revalidatePath\("\/platform"\)/);
    assert.doesNotMatch(s, /service_?role/i);
  });

  test('the page is for the platform owner only and lists companies through platform_orgs()', () => {
    const p = read('app', '(platform)', 'platform', 'page.tsx');
    assert.match(p, /if \(!user\) redirect\("\/login"\);/);
    assert.match(p, /if \(!\(await isPlatformAdmin\(user\.id\)\)\) notFound\(\);/);
    assert.match(p, /select \* from public\.platform_orgs\(\)/);
    const t = read('app', '(platform)', 'platform', 'companies-table.tsx');
    assert.match(t, /^"use client";/);
    for (const fn of ['activateOrg', 'extendTrial', 'pauseOrg']) assert.ok(t.includes(`${fn}(`), fn);
    assert.match(t, /trialExtendedDays \+ d > o\.maxTrialExtensionDays/);
    assert.match(t, /Pause \{/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/trial-enforcement.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the schemas and the error explainer**

*Ruling built into the plan:* `explainPlatformError` lives in its own file, `src/lib/platform/trials/explain.ts`. A `"use server"` file may export only async functions, and tests import it.

`src/lib/platform/trials/schemas.ts`:

```ts
// Input for the platform owner's company actions. No `server-only`: tests import it.
import { z } from "zod";

export const orgActionSchema = z.object({ orgId: z.uuid("Choose a company.") });

export const extendTrialSchema = z.object({
  orgId: z.uuid("Choose a company."),
  days: z.union([z.literal(7), z.literal(14), z.literal(30)], { message: "Extend by 7, 14 or 30 days." }),
});

export type PlatformOrgState = "ok" | "trial_ended" | "paused";

export interface PlatformOrg {
  id: string;
  name: string;
  people: number;
  planTier: string;
  paymentStatus: string;
  state: PlatformOrgState;
  trialEndsAt: string | null;
  trialExtendedDays: number;
  maxTrialExtensionDays: number;
  createdAt: string;
}
```

`src/lib/platform/trials/explain.ts`:

```ts
// The platform functions' own refusals, and nothing else, reach the screen.
// Any other database message (RLS, constraint names) becomes the generic error.
// No `server-only`: tests import it.
const OWN_MESSAGES = [
  /^Only the Atllanta platform owner can do that$/,
  /^Company not found$/,
  /^Extend by 7, 14 or 30 days$/,
  /^Only a company on a trial can be extended$/,
  /^This would pass the \d+-day extension limit$/,
];

export function explainPlatformError(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") {
      const message = String((e as { message?: unknown }).message ?? "");
      if ((code === "42501" || code === "22023") && OWN_MESSAGES.some((re) => re.test(message))) return message;
      return null;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}
```

- [ ] **Step 4: Implement the actions**

`src/lib/platform/trials/actions.ts`:

```ts
"use server";

// The platform owner's company actions (v1.13.0). Each runs one platform_*
// function as the caller; the function itself refuses anyone who is not a
// platform admin, writes the audit row and publishes the event.

import { revalidatePath } from "next/cache";
import { sql, type SQL } from "drizzle-orm";
import { action, ActionError } from "../../actions";
import { withTransaction } from "../../../db/transaction";
import { getSessionUser } from "../../supabase/server";
import { explainPlatformError } from "./explain";
import { extendTrialSchema, orgActionSchema } from "./schemas";

async function run<T>(query: SQL): Promise<T[]> {
  const user = await getSessionUser();
  if (!user) throw new ActionError("Sign in first.");
  return withTransaction({ id: user.id }, async (tx) => {
    try {
      return (await tx.execute(query)) as unknown as T[];
    } catch (err) {
      const message = explainPlatformError(err);
      if (message) throw new ActionError(message);
      throw err;
    }
  });
}

export const activateOrg = action(orgActionSchema, async (input) => {
  await run(sql`select public.platform_activate_org(${input.orgId}::uuid)`);
  revalidatePath("/platform");
  return { orgId: input.orgId };
});

export const extendTrial = action(extendTrialSchema, async (input) => {
  const [row] = await run<{ ends: string | Date }>(
    sql`select public.platform_extend_trial(${input.orgId}::uuid, ${input.days}::int) as ends`
  );
  revalidatePath("/platform");
  return { orgId: input.orgId, trialEndsAt: new Date(row.ends).toISOString() };
});

export const pauseOrg = action(orgActionSchema, async (input) => {
  await run(sql`select public.platform_pause_org(${input.orgId}::uuid)`);
  revalidatePath("/platform");
  return { orgId: input.orgId };
});
```

- [ ] **Step 5: Implement the page**

`app/(platform)/platform/page.tsx`:

```tsx
// The platform owner's Companies screen (v1.13.0): every company, its trial,
// and Activate / Extend / Pause. Anyone who is not a platform admin gets a
// 404 — the page does not admit it exists — and the SQL functions refuse
// them anyway.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getSessionUser } from "@/src/lib/supabase/server";
import { isPlatformAdmin } from "@/src/lib/platform/access";
import { withTransaction } from "@/src/db/transaction";
import type { PlatformOrg, PlatformOrgState } from "@/src/lib/platform/trials/schemas";
import CompaniesTable from "./companies-table";

export const metadata: Metadata = {
  title: "Companies · Atllanta platform",
};

type Row = {
  id: string;
  name: string;
  people: number | string;
  plan_tier: string;
  payment_status: string;
  state: PlatformOrgState;
  trial_ends_at: string | Date | null;
  trial_extended_days: number;
  max_trial_extension_days: number;
  created_at: string | Date;
};

export default async function PlatformPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!(await isPlatformAdmin(user.id))) notFound();

  const rows = (await withTransaction({ id: user.id }, (tx) =>
    tx.execute(sql`select * from public.platform_orgs()`)
  )) as unknown as Row[];

  const orgs: PlatformOrg[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    people: Number(r.people),
    planTier: r.plan_tier,
    paymentStatus: r.payment_status,
    state: r.state,
    trialEndsAt: r.trial_ends_at ? new Date(r.trial_ends_at).toISOString() : null,
    trialExtendedDays: r.trial_extended_days,
    maxTrialExtensionDays: r.max_trial_extension_days,
    createdAt: new Date(r.created_at).toISOString(),
  }));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-1">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/#/dashboard" className="text-sm text-primary hover:underline">
          &larr; Back to Atllanta
        </a>
        <h1 className="text-2xl font-semibold">Companies</h1>
        <p className="text-sm text-muted-foreground">
          Trials end after 14 days. Activate a company, extend its trial (7, 14 or 30 days, within its limit), or pause it.
          Every change is audited.
        </p>
      </div>
      <CompaniesTable orgs={orgs} now={new Date().toISOString()} />
    </main>
  );
}
```

- [ ] **Step 6: Write `companies-table.tsx`**

`route_task`, then `delegate_groq`. Pass this spec, `PlatformOrg`, the action signatures and the leave `approvals-list.tsx` as the style example. Review it and fix it until it matches this reference implementation:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { activateOrg, extendTrial, pauseOrg } from "@/src/lib/platform/trials/actions";
import type { PlatformOrg } from "@/src/lib/platform/trials/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const DAYS = [7, 14, 30] as const;

function statusBadge(o: PlatformOrg) {
  if (o.state === "paused") return <Badge variant="destructive">Paused</Badge>;
  if (o.state === "trial_ended") return <Badge variant="destructive">Trial ended</Badge>;
  if (o.paymentStatus === "trial") return <Badge variant="secondary">Trial</Badge>;
  if (o.paymentStatus === "past_due") return <Badge variant="outline">Past due</Badge>;
  return <Badge variant="default">Active</Badge>;
}

function daysLeft(o: PlatformOrg, now: string): string {
  if (o.paymentStatus !== "trial" || !o.trialEndsAt) return "—";
  const d = Math.ceil((Date.parse(o.trialEndsAt) - Date.parse(now)) / 86_400_000);
  if (d > 0) return `${d} day${d === 1 ? "" : "s"} left`;
  return d === 0 ? "ends today" : `ended ${-d} day${d === -1 ? "" : "s"} ago`;
}

function formatEnd(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export default function CompaniesTable({ orgs, now }: { orgs: PlatformOrg[]; now: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPauseId, setConfirmPauseId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (o: PlatformOrg, label: string, call: () => Promise<{ success: boolean; error?: string }>) => {
    setBusyId(o.id);
    setError(null);
    startTransition(async () => {
      const res = await call();
      if (res.success) {
        setSaved(`${label}: ${o.name}.`);
        setConfirmPauseId(null);
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong.");
        setSaved(null);
      }
      setBusyId(null);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div aria-live="polite" className="min-h-5">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : saved ? (
          <p role="status" className="text-xs text-muted-foreground">
            {saved}
          </p>
        ) : null}
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {orgs.map((o) => {
          const busy = busyId === o.id || isPending;
          return (
            <li key={o.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{o.name}</p>
                  {statusBadge(o)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {o.people} {o.people === 1 ? "person" : "people"} · plan {o.planTier}
                  {o.paymentStatus === "trial"
                    ? ` · trial ends ${formatEnd(o.trialEndsAt)} (${daysLeft(o, now)}) · extended ${o.trialExtendedDays} of ${o.maxTrialExtensionDays} days`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {o.paymentStatus !== "active" ? (
                  <Button type="button" size="sm" disabled={busy} onClick={() => run(o, "Activated", () => activateOrg({ orgId: o.id }))}>
                    Activate
                  </Button>
                ) : null}
                {o.paymentStatus === "trial"
                  ? DAYS.map((d) => (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || o.trialExtendedDays + d > o.maxTrialExtensionDays}
                        onClick={() => run(o, `Extended by ${d} days`, () => extendTrial({ orgId: o.id, days: d }))}
                      >
                        +{d} days
                      </Button>
                    ))
                  : null}
                {o.paymentStatus !== "cancelled" ? (
                  confirmPauseId === o.id ? (
                    <>
                      <span className="text-sm">Pause {o.name}?</span>
                      <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => run(o, "Paused", () => pauseOrg({ orgId: o.id }))}>
                        Yes, pause
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmPauseId(null)}>
                        Keep it
                      </Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmPauseId(o.id)}>
                      Pause…
                    </Button>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: Run the tests, typegen, typecheck and lint**

```bash
node --test tests/trial-enforcement.test.mjs
npx next typegen
npx tsc --noEmit -p .
npx eslint "app/(platform)/platform" src/lib/platform
```

Expected: PASS, no output, no output, 0 problems.

- [ ] **Step 8: Commit**

```bash
git add src/lib/platform/trials "app/(platform)/platform" tests/trial-enforcement.test.mjs
git commit -m "v1.13.0: /platform companies screen — activate, extend, pause"
```

---

### Task 7: Release files, full checks, final review, the owner's yes, apply, push

**Files:**
- Modify:
  - `VERSION`, `package.json:3`, `package-lock.json:3,9`, `public/version.json` → `1.13.0`;
  - `public/sw.js:1` → `atllanta-1.13.0`;
  - `CHANGELOG.md`, `TRANSITION.md`.

- [ ] **Step 1: Bump the versions** (one command each)

```bash
printf '1.13.0\n' > VERSION
printf '{ "version": "1.13.0" }\n' > public/version.json
sed -i '3s/"1.12.0"/"1.13.0"/' package.json
sed -i '3s/"1.12.0"/"1.13.0"/;9s/"1.12.0"/"1.13.0"/' package-lock.json
sed -i '1s/atllanta-1\.12\.0/atllanta-1.13.0/' public/sw.js
```

- [ ] **Step 2: Add the CHANGELOG entry above `## v1.12.0`**

```markdown
## v1.13.0 — 2026-10-05

### What changed
- **Free trials now end.** A company whose 14-day trial has ended, or which Atllanta has paused, sees a "trial ended" page instead of the app until Atllanta reactivates it. Owners and admins see how to contact us; everyone else is asked to speak to their admin. Nothing is deleted — everything is back as soon as access is restored.
- **Existing companies are unaffected:** all are now marked active.
- Admins can no longer change their company's plan, trial dates or credits directly — those are managed by Atllanta.
- New for the Atllanta platform owner: a **Companies** page to activate a company, extend its trial (7, 14 or 30 days, within its limit) or pause it.

### Admins need to
- Nothing.
```

- [ ] **Step 3: Update `TRANSITION.md`**

- In Current State, add an "Update 2026-10-05 (later)" bullet:
  - v1.12.0 live (#140 → `6f91af4`, tagged);
  - v1.13.0 built on `claude/trial-enforcement`;
  - the migration status.
- Add a Decisions entry "2026-10-05 — Trial enforcement (v1.13.0)" with:
  - the owner's four answers;
  - the `auth_org_id` checkpoint;
  - the billing-field hole and its guard;
  - the probe results.

- [ ] **Step 4: Full checks**

```bash
npm run test:unit
npx tsc --noEmit -p .
npm run lint
npm run build
```

Expected:
- all pass;
- no type errors;
- lint 0 errors;
- the build lists `/paused` and `/platform`.

- [ ] **Step 5: Commit**

```bash
git add VERSION package.json package-lock.json public/version.json public/sw.js CHANGELOG.md TRANSITION.md
git commit -m "v1.13.0: trial enforcement release files"
```

- [ ] **Step 6: Final whole-branch review**

Per `superpowers:executing-plans`: run a fresh reviewer on the most capable model, then do one fix pass, with RED→GREEN for each Critical or Important finding.

- [ ] **Step 7: Ask the owner once**

Ask for (a) a yes to apply the migration, and (b) "yes, push". Then:
- run Task 2 steps 2–6;
- `git push -u origin claude/trial-enforcement`;
- `gh pr create` against `claude/gstack-skill-install-chnb41`.

After the merge, the owner promotes the **merge-commit** deployment and tags it `v1.13.0`.
