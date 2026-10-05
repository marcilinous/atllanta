# Company Sign-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person who signs in with Google and belongs to no organisation can create their company at `/start`: name, time zone, currency, then modules. They land in the app as its owner.

**Architecture:**

- **Database:** one `security definer` function, `public.create_company`, creates the organisation, the owner `users` row, the chosen modules, three leave types, an audit row and a `platform.org.created` event. It all happens in one transaction. A narrow bootstrap clause is added to `users_guard_admin_fields()` so the founding owner row is allowed.
- **New stack:** the Next.js `/start` page calls the Server Action `createCompany`, which runs the function as the caller through `withTransaction`.
- **Legacy app:** the shell sends a session with no `users` row to `/start`. `/login` offers Google-only sign-up.

**Tech Stack:**
- Next.js 16 App Router, TypeScript strict, Zod v4, Drizzle (`sql` template inside `withTransaction`);
- Supabase Postgres (plpgsql, RLS, triggers);
- the legacy vanilla-JS shell (`public/index.html`, `public/login.html`);
- tests via `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-05-company-signup-design.md`

## Global Constraints

- **Branch:** `claude/company-signup` (off production `fe1809e`). Release **v1.12.0**.
- **Written by Claude, never delegated** (`CLAUDE.local.md`): the migration SQL, the guard change, the Server Action, the schemas, the `/start` page gate, and the legacy shell redirect. Only `app/(auth)/start/start-form.tsx` may go to a worker (`route_task` → `delegate_groq`). It is reviewed before use, and no keys or production data go in its `context`.
- **No `service_role`** anywhere in new code.
- **The migration is applied to production only after the owner says yes.** The file is then renamed to its recorded version.
- **Module keys offered** (exactly these twelve): `people, me, inbox, documents, finance, announcements, recruitment, crm, analytics, helpdesk, projects, ai`. **`crm_partner` is never offered and is always rejected.**
- **Inputs:**
  - name 2–100 characters, trimmed;
  - time zone must exist in `pg_timezone_names`;
  - currency `^[A-Z]{3}$`.
- **Defaults:**
  - time zone `Asia/Kolkata`, currency `INR`;
  - leave types Casual Leave `CL` 12, Sick Leave `SL` 12, Earned Leave `EL` 15, all paid.
- **Copy:**
  - sign-up view button: "Sign up with Google";
  - note: "Email sign-up is coming soon.";
  - refusal: "You already belong to an organisation".
- **Line endings:** tests normalise `\r\n`. Shell commands: one plain command per call. The worktree guard refuses compound git commands.

## Review Focus

1. **Google profile with no name.** The owner's `full_name` falls back to the email's local part. Pinned by the probe in Task 2 (step 1, row C).
2. **A company name with no letters or digits** (e.g. `"!!"` or `"--"`). The slug becomes `org-xxxxxx` instead of failing. Pinned by the probe in Task 2 (row D).
3. **Double-clicking "Create company".** Exactly one organisation is created; the second call says "You already belong to an organisation". Pinned by the button-disabled check in Task 5 and the second-call refusal in the Task 2 probe (row B).
4. **An invited staff member signing in.** They are never sent to `/start`, because they have a `users` row. Pinned by the Task 6 test: the redirect is keyed on `getMembership()`, not on the org.
5. **Someone who already has a company opening `/start`**, or a signed-out visitor opening it. Sent to `/` or `/login`, never shown the form. Pinned by the static test in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261005090000_company_signup.sql` (renamed after apply) | `users_guard_admin_fields()` with the bootstrap clause; `create_company()`; grants. |
| `tests/company-signup.test.mjs` | All unit and static tests for this feature: migration, schema, action, page, legacy. |
| `src/lib/platform/signup/schemas.ts` | `createCompanySchema`, `SIGNUP_MODULES` (key + label), `TIME_ZONES`, `CURRENCIES`. No `server-only`, because tests import it. |
| `src/lib/platform/signup/actions.ts` | `"use server"` `createCompany`. |
| `app/(auth)/start/page.tsx` | Server gate (signed out → `/login`; has a row → `/`), renders the form. |
| `app/(auth)/start/start-form.tsx` | Client two-step form. |
| `public/index.html` | Redirect a no-row session to `/start`. |
| `public/login.html` | Google-only sign-up view. |
| `VERSION`, `package.json`, `package-lock.json`, `public/version.json`, `public/sw.js`, `CHANGELOG.md`, `TRANSITION.md` | Release files. |

---

### Task 1: Migration — guard bootstrap clause and `create_company`

**Files:**
- Create: `supabase/migrations/20261005090000_company_signup.sql`
- Test: `tests/company-signup.test.mjs`

**Interfaces:**
- Produces:
  - `public.create_company(p_name text, p_timezone text, p_currency text, p_modules text[]) returns uuid` (the new org id);
  - errors: `42501` "Sign in to create a company" / "You already belong to an organisation"; `22023` for bad input; `23505` on a concurrent second call;
  - the transaction-local setting `atllanta.bootstrap_org`.

- [ ] **Step 1: Write the failing test**

Create `tests/company-signup.test.mjs`:

```js
// v1.12.0: company sign-up. A person who signs in with Google and belongs to
// no organisation creates their company at /start; create_company() makes
// the org, the owner, the chosen modules and three leave types in one
// transaction. The same scenarios run against production in an
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
const migFile = fs.readdirSync(migDir).find((f) => f.endsWith('_company_signup.sql'));
const sql = migFile ? read('supabase', 'migrations', migFile) : '';
const fnBody = (name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  return sql.slice(start, sql.indexOf('$function$;', start));
};

describe('migration: create_company', () => {
  test('exists, is security definer with a fixed search_path, callable only by signed-in users', () => {
    assert.ok(migFile, 'migration file exists');
    const f = fnBody('create_company');
    assert.match(f, /returns uuid/);
    assert.match(f, /security definer/);
    assert.match(f, /set search_path to 'public'/);
    assert.match(sql, /revoke all on function public\.create_company\(text, text, text, text\[\]\) from public, anon;/);
    assert.match(sql, /grant execute on function public\.create_company\(text, text, text, text\[\]\) to authenticated;/);
  });

  test('refuses the signed-out and anyone who already belongs to an organisation', () => {
    const f = fnBody('create_company');
    assert.match(f, /if v_uid is null then\s+raise exception 'Sign in to create a company' using errcode = '42501';/);
    assert.match(f, /if exists \(select 1 from public\.users where id = v_uid\) then\s+raise exception 'You already belong to an organisation' using errcode = '42501';/);
  });

  test('validates name, time zone, currency and modules; crm_partner is never accepted', () => {
    const f = fnBody('create_company');
    assert.match(f, /char_length\(v_name\) < 2 or char_length\(v_name\) > 100/);
    assert.match(f, /pg_timezone_names where name = p_timezone/);
    assert.match(f, /p_currency !~ '\^\[A-Z\]\{3\}\$'/);
    assert.match(f, /cardinality\(p_modules\) = 0/);
    assert.match(f, /p_modules <@ v_known/);
    const known = f.match(/v_known text\[\] := array\[([^\]]+)\]/)[1];
    for (const k of ['people', 'me', 'inbox', 'documents', 'finance', 'announcements', 'recruitment', 'crm', 'analytics', 'helpdesk', 'projects', 'ai']) {
      assert.match(known, new RegExp(`'${k}'`), k);
    }
    assert.doesNotMatch(known, /crm_partner/);
  });

  test('creates org, owner, modules, leave types, audit and event', () => {
    const f = fnBody('create_company');
    assert.match(f, /insert into public\.organizations \(name, slug, org_type, timezone, currency\)/);
    assert.match(f, /perform set_config\('atllanta\.bootstrap_org', v_org::text, true\);/);
    assert.match(f, /insert into public\.users \(id, org_id, email, full_name, avatar_url, role, status, date_of_joining\)/);
    assert.match(f, /'owner', 'active'/);
    assert.match(f, /update public\.org_modules set is_enabled = true, enabled_by = v_uid, enabled_at = now\(\)\s+where org_id = v_org and module_key = any \(p_modules\);/);
    assert.match(f, /'Casual Leave', 'CL', 12/);
    assert.match(f, /'Sick Leave', 'SL', 12/);
    assert.match(f, /'Earned Leave', 'EL', 15/);
    assert.match(f, /insert into public\.audit_logs/);
    assert.match(f, /'platform\.org\.created'/);
  });
});

describe('migration: users_guard_admin_fields bootstrap clause', () => {
  test('allows only the founding owner of an empty org, inside create_company', () => {
    const g = fnBody('users_guard_admin_fields');
    const clause = g.match(/if tg_op = 'INSERT' and new\.role = 'owner'\s+and new\.id = auth\.uid\(\)\s+and current_setting\('atllanta\.bootstrap_org', true\) = new\.org_id::text\s+and not exists \(select 1 from public\.users u where u\.org_id = new\.org_id\) then\s+return new;\s+end if;/);
    assert.ok(clause, 'the three-condition bootstrap clause');
    assert.ok(g.indexOf(clause[0]) > g.indexOf('if auth.uid() is null then'), 'after the server-code bypass');
    assert.ok(g.indexOf(clause[0]) < g.indexOf("if tg_op = 'INSERT' and new.role = 'owner' and not is_org_owner() then"), 'before the owner check');
  });

  test('every other rule of the live guard is kept', () => {
    const g = fnBody('users_guard_admin_fields');
    for (const msg of [
      "A custom role must be one of this organisation''s custom roles",
      'org_id is assigned by Atllanta and cannot be changed',
      'You cannot change your own role',
      'Only an owner can grant or remove the owner role',
      'An organisation must keep at least one owner',
    ]) assert.ok(g.includes(msg), msg);
    assert.match(g, /if tg_op = 'INSERT' then\s+new\.role := 'member';\s+new\.custom_role_id := null;\s+return new;\s+end if;/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/company-signup.test.mjs`
Expected: FAIL. "migration file exists" (`migFile` is undefined).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261005090000_company_signup.sql`:

```sql
-- v1.12.0: company sign-up (spec docs/superpowers/specs/2026-10-05-company-signup-design.md).
--
-- Self-serve company creation was removed on 2026-09-08 (Phase 1b) and never
-- rebuilt. organizations still has no insert policy; create_company() is the
-- only way a signed-in person without an organisation can create one, and it
-- makes them its owner in the same transaction.
--
-- 1. users_guard_admin_fields(): identical to the live function except one
--    clause. It lets create_company() insert the founding owner row: the
--    caller's own row, only while create_company's transaction-local marker
--    names this org, and only while the org has no users at all.
-- 2. create_company(): checks the caller and the input, then creates the org
--    (existing triggers seed roles, modules (off), CRM stages and AI quota
--    rows), the owner, the chosen modules, three leave types, an audit row
--    and the platform.org.created event.

create or replace function public.users_guard_admin_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- A custom role must belong to the caller's own org and be one of that
  -- org's custom (non-system) roles. This holds for everyone, including
  -- service-role writes, so it runs before the service-role bypass below.
  if new.custom_role_id is not null and not exists (
    select 1 from public.roles r
    where r.id = new.custom_role_id and r.org_id = new.org_id and not r.is_system
  ) then
    raise exception 'A custom role must be one of this organisation''s custom roles' using errcode = '42501';
  end if;

  -- Service role / server code: Atllanta assigns org_id and admin fields.
  if auth.uid() is null then
    return new;
  end if;

  -- Founding owner (v1.12.0): create_company() inserts the first user of a
  -- brand-new organisation as its owner. Only the caller's own row, only
  -- while create_company's transaction-local marker names this org, and
  -- only while the org has no users at all.
  if tg_op = 'INSERT' and new.role = 'owner'
     and new.id = auth.uid()
     and current_setting('atllanta.bootstrap_org', true) = new.org_id::text
     and not exists (select 1 from public.users u where u.org_id = new.org_id) then
    return new;
  end if;

  -- Nobody signed in may move a user between organisations, admins included.
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'org_id is assigned by Atllanta and cannot be changed'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    -- Nobody may change their own role.
    if old.id = auth.uid() then
      raise exception 'You cannot change your own role' using errcode = '42501';
    end if;
    -- Only an owner may grant or remove the owner role.
    if (old.role = 'owner' or new.role = 'owner') and not is_org_owner() then
      raise exception 'Only an owner can grant or remove the owner role' using errcode = '42501';
    end if;
    -- An org must always keep at least one owner.
    if old.role = 'owner' and not exists (select 1 from public.users u where u.org_id = old.org_id and u.role = 'owner' and u.id <> old.id) then
      raise exception 'An organisation must keep at least one owner' using errcode = '42501';
    end if;
  end if;

  -- Changing your own custom_role_id is a role change too.
  if tg_op = 'UPDATE' and new.custom_role_id is distinct from old.custom_role_id and old.id = auth.uid() then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and new.role = 'owner' and not is_org_owner() then
    raise exception 'Only an owner can grant or remove the owner role' using errcode = '42501';
  end if;

  if is_org_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.role := 'member';
    new.custom_role_id := null;
    return new;
  end if;

  new.role := old.role;
  new.status := old.status;
  new.org_id := old.org_id;
  new.department_id := old.department_id;
  new.team_id := old.team_id;
  new.reporting_manager_id := old.reporting_manager_id;
  new.designation := old.designation;
  new.date_of_joining := old.date_of_joining;
  new.custom_role_id := old.custom_role_id;
  return new;
end;
$function$;

create or replace function public.create_company(p_name text, p_timezone text, p_currency text, p_modules text[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_known text[] := array['people', 'me', 'inbox', 'documents', 'finance', 'announcements', 'recruitment', 'crm', 'analytics', 'helpdesk', 'projects', 'ai'];
  v_org uuid;
  v_slug text;
  v_base text;
  v_email text;
  v_meta jsonb;
  v_full_name text;
  v_tries int := 0;
begin
  if v_uid is null then
    raise exception 'Sign in to create a company' using errcode = '42501';
  end if;
  if exists (select 1 from public.users where id = v_uid) then
    raise exception 'You already belong to an organisation' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'Company name must be 2 to 100 characters' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Choose a valid time zone' using errcode = '22023';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Choose a valid currency' using errcode = '22023';
  end if;
  if p_modules is null or cardinality(p_modules) = 0 then
    raise exception 'Choose at least one module' using errcode = '22023';
  end if;
  if not (p_modules <@ v_known) then
    raise exception 'Unknown module' using errcode = '22023';
  end if;

  select u.email, coalesce(u.raw_user_meta_data, '{}'::jsonb) into v_email, v_meta
  from auth.users u where u.id = v_uid;
  if v_email is null then
    raise exception 'Sign in to create a company' using errcode = '42501';
  end if;
  v_full_name := coalesce(
    nullif(btrim(v_meta->>'full_name'), ''),
    nullif(btrim(v_meta->>'name'), ''),
    split_part(v_email, '@', 1)
  );

  v_base := left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 40);
  if v_base = '' then
    v_base := 'org';
  end if;
  loop
    v_slug := v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
    exit when not exists (select 1 from public.organizations o where o.slug = v_slug);
    v_tries := v_tries + 1;
    if v_tries > 5 then
      raise exception 'Could not create the company, please try again';
    end if;
  end loop;

  insert into public.organizations (name, slug, org_type, timezone, currency)
  values (v_name, v_slug, 'direct', p_timezone, p_currency)
  returning id into v_org;

  perform set_config('atllanta.bootstrap_org', v_org::text, true);
  insert into public.users (id, org_id, email, full_name, avatar_url, role, status, date_of_joining)
  values (v_uid, v_org, v_email, v_full_name, nullif(v_meta->>'avatar_url', ''), 'owner', 'active',
          (now() at time zone p_timezone)::date);
  perform set_config('atllanta.bootstrap_org', '', true);

  update public.org_modules set is_enabled = true, enabled_by = v_uid, enabled_at = now()
  where org_id = v_org and module_key = any (p_modules);

  insert into public.leave_types (org_id, name, code, annual_quota, is_paid)
  values (v_org, 'Casual Leave', 'CL', 12, true),
         (v_org, 'Sick Leave', 'SL', 12, true),
         (v_org, 'Earned Leave', 'EL', 15, true);

  insert into public.audit_logs (org_id, user_id, module, entity_type, entity_id, action, new_values)
  values (v_org, v_uid, 'platform', 'organization', v_org, 'created',
          jsonb_build_object('name', v_name, 'slug', v_slug, 'modules', to_jsonb(p_modules)));

  insert into public.events (org_id, event_type, actor_id, payload)
  values (v_org, 'platform.org.created', v_uid,
          jsonb_build_object('org_id', v_org, 'owner_id', v_uid, 'name', v_name, 'modules', to_jsonb(p_modules)));

  return v_org;
end;
$function$;

revoke all on function public.create_company(text, text, text, text[]) from public, anon;
grant execute on function public.create_company(text, text, text, text[]) to authenticated;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/company-signup.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Confirm the guard body matches live, apart from the new clause**

Run `select pg_get_functiondef('public.users_guard_admin_fields'::regproc);` with `mcp__claude_ai_Supabase__execute_sql` (project `nburswxjpukntgdwuyme`). Compare it with the migration's version: the only difference must be the "Founding owner" comment and clause. If live has changed since 2026-10-05, copy the live body and re-add the clause.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261005090000_company_signup.sql tests/company-signup.test.mjs
git commit -m "v1.12.0: create_company() and the founding-owner guard clause (not yet applied)"
```

---

### Task 2: Rolled-back production probe, then apply (owner's yes)

**Files:**
- Modify (rename after apply): `supabase/migrations/20261005090000_company_signup.sql` → `<recorded_version>_company_signup.sql`

**Interfaces:**
- Consumes: the migration SQL from Task 1, verbatim.

- [ ] **Step 1: Run the probe (always rolled back)**

Use `mcp__claude_ai_Supabase__execute_sql`. Pick a real RTcompu member id first:

```sql
select id from users where org_id = 'e8845b88-b73d-4af1-8cce-3ca7a4b3cf6b' and role = 'member' limit 1;
```

Then run one `DO $probe$ … $probe$` block that:

1. executes the whole migration body (both `create or replace function` statements and the grants) via `execute $mig$ … $mig$`, or pasted inline;
2. inserts a throwaway `auth.users` row:
   ```sql
   insert into auth.users (id, email, raw_user_meta_data, aud, role)
   values (gen_random_uuid(), 'probe-<random>@example.invalid', '{}', 'authenticated', 'authenticated')
   ```
   It has no name, which is Review Focus 1;
3. as that user (`set_config('request.jwt.claims', json_build_object('sub', <id>, 'role','authenticated')::text, true); set local role authenticated;`), calls `create_company('!!', 'Asia/Kolkata', 'INR', array['me','people'])`. Collect row **A**:
   - org `payment_status = 'trial'`, `trial_ends_at` between 13.9 and 14.1 days from now;
   - 5 roles;
   - enabled modules exactly `{me, people}`;
   - 3 leave types;
   - owner row role `owner`;
   - 1 audit row and 1 `platform.org.created` event;
   - slug like `org-______` (row **D**);
   - `full_name` = the email's local part (row **C**);
4. calls `create_company` again as the same user. Expect `42501` "You already belong" (row **B**);
5. as a second throwaway user, expects `22023` for each of:
   - name `'x'`;
   - time zone `'Mars/Base'`;
   - currency `'inr'`;
   - modules `array[]::text[]`;
   - modules `array['crm_partner']`;
6. as the RTcompu member, `create_company('Probe', 'Asia/Kolkata', 'INR', array['me'])` → `42501`;
7. as the anon role (`reset role; set local role anon;`), the call fails with permission denied (`42501`);
8. **guard stays narrow.** As the second throwaway user:
   - `insert into users (id, org_id, role) values (<self>, <org from A>, 'owner')` with no marker → refused;
   - with the marker set to a different org → refused;
   - with the marker set to A's org, which already has users → refused;
9. ends with `raise exception 'PROBE (rolled back): %', <summary>;`.

Expected: every row as described; the summary shows A–D and all refusals.

- [ ] **Step 2: Stop and ask the owner**

Report the probe summary. Then say what applying does: production database, shared by both stacks, visible to every org; it adds `create_company` and changes `users_guard_admin_fields`. **Wait for a clear yes.**

- [ ] **Step 3: Apply**

`mcp__claude_ai_Supabase__apply_migration`, name `company_signup`, with the file's SQL. Then:

```sql
select version, name from supabase_migrations.schema_migrations where name = 'company_signup';
```

- [ ] **Step 4: Rename the file to the recorded version**

```bash
git mv supabase/migrations/20261005090000_company_signup.sql supabase/migrations/<version>_company_signup.sql
```

- [ ] **Step 5: Re-run the probe live (without the migration body), still rolled back**

Expected: the same summary as Step 1.

- [ ] **Step 6: Run the tests and commit**

Run: `node --test tests/company-signup.test.mjs`. Expected: PASS.

```bash
git commit -m "v1.12.0: company_signup migration applied; file renamed to its recorded version"
```

---

### Task 3: Input schema

**Files:**
- Create: `src/lib/platform/signup/schemas.ts`
- Test: `tests/company-signup.test.mjs` (append)

**Interfaces:**
- Produces:
  - `createCompanySchema` (Zod object `{ name: string; timeZone: string; currency: string; modules: SignupModuleKey[] }`);
  - `type CreateCompanyInput`;
  - `SIGNUP_MODULES: readonly { key: SignupModuleKey; label: string }[]`;
  - `type SignupModuleKey`;
  - `TIME_ZONES: readonly string[]`;
  - `CURRENCIES: readonly string[]`.

- [ ] **Step 1: Write the failing test (append to `tests/company-signup.test.mjs`)**

```js
import { createCompanySchema, SIGNUP_MODULES, TIME_ZONES, CURRENCIES } from '../src/lib/platform/signup/schemas.ts';

describe('input schema', () => {
  const ok = { name: 'Acme Pvt Ltd', timeZone: 'Asia/Kolkata', currency: 'INR', modules: ['me', 'people'] };

  test('accepts a normal company and trims the name', () => {
    const r = createCompanySchema.parse({ ...ok, name: '  Acme  ' });
    assert.equal(r.name, 'Acme');
  });

  test('rejects bad names, zones, currencies and module lists', () => {
    for (const bad of [
      { ...ok, name: 'A' },
      { ...ok, name: 'x'.repeat(101) },
      { ...ok, timeZone: 'not a zone' },
      { ...ok, currency: 'inr' },
      { ...ok, modules: [] },
      { ...ok, modules: ['crm_partner'] },
      { ...ok, modules: ['payroll'] },
    ]) assert.equal(createCompanySchema.safeParse(bad).success, false, JSON.stringify(bad));
  });

  test('never accepts an org, role or user from input', () => {
    const r = createCompanySchema.parse({ ...ok, orgId: 'x', role: 'owner', userId: 'y' });
    for (const k of ['orgId', 'role', 'userId']) assert.equal(k in r, false, k);
  });

  test('offers exactly the twelve modules, never the partner pack; defaults are first', () => {
    assert.deepEqual(SIGNUP_MODULES.map((m) => m.key), ['people', 'me', 'inbox', 'documents', 'finance', 'announcements', 'recruitment', 'crm', 'analytics', 'helpdesk', 'projects', 'ai']);
    assert.equal(TIME_ZONES[0], 'Asia/Kolkata');
    assert.equal(CURRENCIES[0], 'INR');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/company-signup.test.mjs`
Expected: FAIL, "Cannot find module …/signup/schemas.ts".

- [ ] **Step 3: Implement `src/lib/platform/signup/schemas.ts`**

```ts
// Input for company sign-up (/start). The org, the person and the role never
// come from input — create_company() takes the caller from the session and
// always makes them owner. The database checks everything again; these
// lists are only what the form offers.
//
// No `server-only` import: tests import this file directly.
import { z } from "zod";

export const SIGNUP_MODULES = [
  { key: "people", label: "People — directory, assets, letters" },
  { key: "me", label: "Me — attendance and leave" },
  { key: "inbox", label: "Inbox and approvals" },
  { key: "documents", label: "Documents" },
  { key: "finance", label: "Finance — expenses" },
  { key: "announcements", label: "Announcements" },
  { key: "recruitment", label: "Recruitment" },
  { key: "crm", label: "CRM" },
  { key: "analytics", label: "Analytics" },
  { key: "helpdesk", label: "Helpdesk" },
  { key: "projects", label: "Projects" },
  { key: "ai", label: "AI Assistant" },
] as const;

export type SignupModuleKey = (typeof SIGNUP_MODULES)[number]["key"];

const MODULE_KEYS = SIGNUP_MODULES.map((m) => m.key) as [SignupModuleKey, ...SignupModuleKey[]];

export const TIME_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
] as const;

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD"] as const;

export const createCompanySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Company name must be at least 2 characters.")
    .max(100, "Company name must be 100 characters or fewer."),
  timeZone: z.string().regex(/^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/, "Choose a time zone."),
  currency: z.string().regex(/^[A-Z]{3}$/, "Choose a currency."),
  modules: z.array(z.enum(MODULE_KEYS)).min(1, "Choose at least one module."),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/company-signup.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platform/signup/schemas.ts tests/company-signup.test.mjs
git commit -m "v1.12.0: company sign-up input schema"
```

---

### Task 4: Server Action `createCompany`

**Files:**
- Create: `src/lib/platform/signup/actions.ts`
- Test: `tests/company-signup.test.mjs` (append)

**Interfaces:**
- Consumes:
  - `createCompanySchema` (Task 3);
  - `public.create_company(text, text, text, text[]) returns uuid` (Task 1);
  - `withTransaction(caller: { id: string }, fn)` from `src/db/transaction.ts`;
  - `getSessionUser(): Promise<{ id: string; email?: string } | null>` from `src/lib/supabase/server.ts`;
  - `action`, `ActionError` from `src/lib/actions.ts`.
- Produces: `createCompany(raw: unknown): Promise<ActionResponse<{ orgId: string }>>`.

- [ ] **Step 1: Write the failing test (append)**

```js
describe('static: createCompany', () => {
  const src = () => read('src', 'lib', 'platform', 'signup', 'actions.ts');

  test('is a server action that needs a session and runs create_company as the caller', () => {
    const s = src();
    assert.match(s, /^"use server";/);
    assert.match(s, /export const createCompany = action\(createCompanySchema,/);
    assert.match(s, /const user = await getSessionUser\(\);\s+if \(!user\) throw new ActionError\("Sign in to create a company\."\);/);
    assert.match(s, /withTransaction\(\{ id: user\.id \}/);
    assert.match(s, /select public\.create_company\(/);
  });

  test('maps the database refusals to readable messages and never uses the service role', () => {
    const s = src();
    assert.match(s, /code === "23505"/);
    assert.match(s, /code === "42501" \|\| code === "22023"/);
    assert.doesNotMatch(s, /service_?role|SERVICE_ROLE/i);
    assert.doesNotMatch(s, /input\.(orgId|role|userId)/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/company-signup.test.mjs`
Expected: FAIL, ENOENT for `actions.ts`.

- [ ] **Step 3: Implement `src/lib/platform/signup/actions.ts`**

```ts
"use server";

// Company sign-up (v1.12.0). The caller has no organisation yet — that is the
// point — so there is no permission gate; create_company() itself refuses
// anyone who already belongs to one, checks the input again, and makes the
// org, the owner, the chosen modules, three leave types, the audit row and
// the platform.org.created event in this one transaction.

import { sql } from "drizzle-orm";
import { action, ActionError } from "../../actions";
import { withTransaction } from "../../../db/transaction";
import { getSessionUser } from "../../supabase/server";
import { createCompanySchema } from "./schemas";

/** Walks Drizzle/postgres.js error wrapping. */
function pgError(err: unknown): { code?: string; message?: string } {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return { code, message: String((e as { message?: unknown }).message ?? "") };
    e = (e as { cause?: unknown }).cause;
  }
  return {};
}

export const createCompany = action(createCompanySchema, async (input) => {
  const user = await getSessionUser();
  if (!user) throw new ActionError("Sign in to create a company.");

  const orgId = await withTransaction({ id: user.id }, async (tx) => {
    try {
      const rows = (await tx.execute(
        sql`select public.create_company(
          ${input.name},
          ${input.timeZone},
          ${input.currency},
          array(select jsonb_array_elements_text(${JSON.stringify(input.modules)}::jsonb))
        ) as id`
      )) as unknown as { id: string }[];
      return rows[0].id;
    } catch (err) {
      const { code, message = "" } = pgError(err);
      // A second, simultaneous click: the first call's owner row wins.
      if (code === "23505") throw new ActionError("You already belong to an organisation.");
      if (code === "42501" || code === "22023") throw new ActionError(message.replace(/^.*?:\s*/, "") || "That isn't allowed.");
      throw err;
    }
  });

  return { orgId };
});
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `node --test tests/company-signup.test.mjs`. Expected: PASS.
Run: `npx tsc --noEmit -p .`. Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platform/signup/actions.ts tests/company-signup.test.mjs
git commit -m "v1.12.0: createCompany server action"
```

---

### Task 5: `/start` page and form

**Files:**
- Create: `app/(auth)/start/page.tsx`
- Create: `app/(auth)/start/start-form.tsx` (client; may be delegated, then reviewed)
- Test: `tests/company-signup.test.mjs` (append)

**Interfaces:**
- Consumes:
  - `createCompany` (Task 4);
  - `SIGNUP_MODULES`, `TIME_ZONES`, `CURRENCIES` (Task 3);
  - `getSessionUser` (`@/src/lib/supabase/server`);
  - `withTransaction`;
  - `users` from `@/src/db/schema/platform`;
  - `Button` from `@/components/ui/button`.
- Produces: the route `/start`.

- [ ] **Step 1: Write the failing test (append)**

```js
describe('static: /start', () => {
  test('the page sends the signed-out to /login and anyone with an account row to /', () => {
    const p = read('app', '(auth)', 'start', 'page.tsx');
    assert.match(p, /if \(!user\) redirect\("\/login"\);/);
    assert.match(p, /if \(member\) redirect\("\/"\);/);
    assert.match(p, /eq\(users\.id, user\.id\)/);
  });

  test('the form calls createCompany, cannot double-submit, and lands with a full page load', () => {
    const f = read('app', '(auth)', 'start', 'start-form.tsx');
    assert.match(f, /^"use client";/);
    assert.match(f, /await createCompany\(/);
    assert.match(f, /disabled=\{[^}]*isPending/);
    assert.match(f, /window\.location\.assign\("\/"\)/);
    assert.doesNotMatch(f, /crm_partner/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/company-signup.test.mjs`
Expected: FAIL, ENOENT for `page.tsx`.

- [ ] **Step 3: Write `app/(auth)/start/page.tsx` (directly; it is the gate)**

```tsx
// Company sign-up (v1.12.0). Reached from the legacy shell when a signed-in
// person has no account row. Anyone who already belongs to an organisation
// is sent back to the app — one company per account.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/src/lib/supabase/server";
import { withTransaction } from "@/src/db/transaction";
import { users } from "@/src/db/schema/platform";
import { CURRENCIES, SIGNUP_MODULES, TIME_ZONES } from "@/src/lib/platform/signup/schemas";
import StartForm from "./start-form";

export const metadata: Metadata = {
  title: "Set up your company · Atllanta",
};

export default async function StartPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [member] = await withTransaction({ id: user.id }, (tx) =>
    tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).limit(1)
  );
  if (member) redirect("/");

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Set up your company</h1>
        <p className="text-sm text-muted-foreground">
          You&rsquo;ll be its owner. Your 14-day trial starts today.
        </p>
      </div>
      <StartForm
        modules={SIGNUP_MODULES.map((m) => ({ key: m.key, label: m.label }))}
        timeZones={[...TIME_ZONES]}
        currencies={[...CURRENCIES]}
      />
    </main>
  );
}
```

- [ ] **Step 4: Write `app/(auth)/start/start-form.tsx`**

`route_task`, then `delegate_groq`. Give it this file's spec plus the leave `approvals-list.tsx` as the style example. Then review and fix it so it matches the following. Reference implementation:

```tsx
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { createCompany } from "@/src/lib/platform/signup/actions";
import type { SignupModuleKey } from "@/src/lib/platform/signup/schemas";
import { Button } from "@/components/ui/button";

const inputClass = "rounded-md border border-border bg-field px-2 py-1.5 text-sm";

type Props = {
  modules: { key: SignupModuleKey; label: string }[];
  timeZones: string[];
  currencies: string[];
};

export default function StartForm({ modules, timeZones, currencies }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState(timeZones[0]);
  const [currency, setCurrency] = useState(currencies[0]);
  const [chosen, setChosen] = useState<SignupModuleKey[]>(modules.map((m) => m.key));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setFieldErrors({ name: ["Company name must be at least 2 characters."] });
      return;
    }
    setFieldErrors({});
    setStep(2);
  };

  const toggle = (key: SignupModuleKey) =>
    setChosen((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (chosen.length === 0) {
      setError("Choose at least one module.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createCompany({ name, timeZone, currency, modules: chosen });
      if (res.success) {
        // A full load: the app is the legacy shell outside the App Router.
        window.location.assign("/");
        return;
      }
      setError(res.error);
      setFieldErrors(res.fieldErrors ?? {});
      if (res.fieldErrors?.name || res.fieldErrors?.timeZone || res.fieldErrors?.currency) setStep(1);
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-6">
      <p className="text-xs text-muted-foreground">Step {step} of 2</p>
      <div aria-live="polite" className="min-h-5">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {step === 1 ? (
        <form onSubmit={next} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Company name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? "name-error" : undefined}
              className={inputClass}
            />
            {fieldErrors.name ? (
              <span id="name-error" className="text-xs text-destructive">
                {fieldErrors.name[0]}
              </span>
            ) : null}
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1 text-sm">
              Time zone
              <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className={inputClass}>
                {timeZones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Currency
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <Button type="submit">Next</Button>
          </div>
        </form>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Modules for {name.trim()}</legend>
            <p className="text-xs text-muted-foreground">You can change these later in Admin &rarr; Modules &amp; roles.</p>
            {modules.map((m) => (
              <label key={m.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chosen.includes(m.key)} onChange={() => toggle(m.key)} />
                {m.label}
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending || chosen.length === 0}>
              {isPending ? "Creating…" : "Create company"}
            </Button>
            <Button type="button" variant="ghost" disabled={isPending} onClick={() => setStep(1)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests, typecheck and lint**

```bash
node --test tests/company-signup.test.mjs
npx next typegen
npx tsc --noEmit -p .
npx eslint "app/(auth)/start" src/lib/platform/signup
```

Expected: tests PASS; typecheck has no output; lint reports no errors.

- [ ] **Step 6: Commit**

```bash
git add "app/(auth)/start" tests/company-signup.test.mjs
git commit -m "v1.12.0: /start company set-up page"
```

---

### Task 6: Legacy entry points — shell redirect and Google-only sign-up

**Files:**
- Modify: `public/index.html:227-230` (after `const profile = await loadUserProfile();`)
- Modify: `public/login.html` (the Google button label, the sign-up section, `setView`)
- Test: `tests/company-signup.test.mjs` (append)

**Interfaces:**
- Consumes: `getMembership()` from `/js/auth.js` (null when there is no `users` row).
- Produces: legacy routing into `/start`.

- [ ] **Step 1: Write the failing test (append)**

```js
describe('legacy entry points', () => {
  test('the shell sends a session with no account row to /start, keyed on the membership', () => {
    const html = read('public', 'index.html');
    assert.match(html, /const profile = await loadUserProfile\(\);[\s\S]{0,300}?if \(!getMembership\(\)\) \{\s+window\.location\.replace\('\/start'\);/);
    assert.doesNotMatch(html, /if \(!org\)[^\n]*\/start/, 'keyed on the account row, not the org');
  });

  test('login offers Google-only sign-up for now; the email form is kept but hidden', () => {
    const login = read('public', 'login.html');
    assert.match(login, /<form id="signup-form" class="login-form hidden"/);
    assert.match(login, /Email sign-up is coming soon\./);
    assert.match(login, /googleLabel\.textContent = view === 'signup' \? 'Sign up with Google' : 'Continue with Google';/);
    assert.match(login, /<span id="google-label">Continue with Google<\/span>/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/company-signup.test.mjs`
Expected: FAIL on both new tests.

- [ ] **Step 3: Edit `public/index.html`**

Replace:

```js
const profile = await loadUserProfile();
```

with:

```js
const profile = await loadUserProfile();
// Signed in but no account row: a new company, not an invited colleague
// (invites create the row). Company sign-up lives on the new stack (v1.12.0).
if (!getMembership()) {
  window.location.replace('/start');
  throw new Error('No organisation yet');
}
```

- [ ] **Step 4: Edit `public/login.html`**

1. In the Google button, replace the text node `      Continue with Google` with:
   `      <span id="google-label">Continue with Google</span>`
2. Change `<form id="signup-form" class="login-form" style="margin-top: var(--space-4)">` to
   `<form id="signup-form" class="login-form hidden" style="margin-top: var(--space-4)">`.
   Then insert this as the first child of `<div id="signup-section" class="hidden">`:
   ```html
      <p class="login-subtitle" id="signup-note" style="margin-top: var(--space-4)">Email sign-up is coming soon. Use your Google account to create your company.</p>
   ```
3. After `const googleBtn = document.getElementById('google-btn');` add:
   ```js
   const googleLabel = document.getElementById('google-label');
   ```
4. In `setView`, after `googleBtn.classList.toggle('hidden', !oauthVisible);` add:
   ```js
     googleLabel.textContent = view === 'signup' ? 'Sign up with Google' : 'Continue with Google';
   ```
   and change `loginDivider.classList.toggle('hidden', !oauthVisible);` to:
   ```js
     loginDivider.classList.toggle('hidden', view !== 'login');
   ```

- [ ] **Step 5: Run the tests and a syntax check**

```bash
node --test tests/company-signup.test.mjs
npm run test:unit
```

Expected: all PASS (the existing app-shell, auth and login tests included).

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/login.html tests/company-signup.test.mjs
git commit -m "v1.12.0: send new sign-ups to /start; Google-only sign-up for now"
```

---

### Task 7: Release files, full checks, push on the owner's yes

**Files:**
- Modify:
  - `VERSION`, `package.json:3`, `package-lock.json:3,9`, `public/version.json` → `1.12.0`;
  - `public/sw.js:1` → `atllanta-1.12.0`;
  - `CHANGELOG.md` (new top entry);
  - `TRANSITION.md` (Current State and a Decisions entry).

- [ ] **Step 1: Bump the versions**

```bash
printf '1.12.0\n' > VERSION
printf '{ "version": "1.12.0" }\n' > public/version.json
sed -i '3s/"1.11.0"/"1.12.0"/' package.json
sed -i '3s/"1.11.0"/"1.12.0"/;9s/"1.11.0"/"1.12.0"/' package-lock.json
sed -i '1s/atllanta-1\.11\.0/atllanta-1.12.0/' public/sw.js
```

- [ ] **Step 2: Add the CHANGELOG entry above `## v1.11.0`**

```markdown
## v1.12.0 — 2026-10-05

### What changed
- **New companies can sign up.** Choose "Sign up" on the sign-in page and use your Google account. Then name your company, pick your time zone and currency, and choose which modules to switch on. You start as the company's owner on a 14-day trial, with Casual, Sick and Earned leave already set up.
- Email-and-password sign-up is coming once email is set up for atllanta.com. Signing in is unchanged.
- People you invite are not affected — they join your company as before.

### Admins need to
- Owner: in Supabase → Authentication → URL Configuration → Redirect URLs, add `https://atllanta.com/**` and `https://www.atllanta.com/**` so Google sign-in returns to the new domain.
```

- [ ] **Step 3: Update `TRANSITION.md`**

- Under Current State, add an "Update 2026-10-05" bullet recording:
  - v1.11.0 live (#139, tagged);
  - atllanta.com bought and pointed at Vercel;
  - the four-piece sequence;
  - v1.12.0 built on `claude/company-signup`.
- Add a Decisions entry "2026-10-05 — Company sign-up (v1.12.0)" with:
  - the owner's four answers;
  - the guard clause;
  - the probe result.

- [ ] **Step 4: Full checks**

```bash
npm run test:unit
npx tsc --noEmit -p .
npm run lint
npm run build
```

Expected:
- all unit tests pass;
- typecheck has no output;
- lint has 0 errors;
- build lists `/start`.

- [ ] **Step 5: Commit**

```bash
git add VERSION package.json package-lock.json public/version.json public/sw.js CHANGELOG.md TRANSITION.md
git commit -m "v1.12.0: company sign-up release files"
```

- [ ] **Step 6: Ask the owner for "yes, push"**

Explain:
- Pushing opens a PR against `claude/gstack-skill-install-chnb41`.
- Merging and promoting lets anyone signed in without a company reach `/start`. Nothing links to sign-up publicly until piece 4.

On yes: `git push -u origin claude/company-signup`, then `gh pr create` with the release notes. After the merge, the owner promotes the **merge-commit** deployment and tags it `v1.12.0`.
