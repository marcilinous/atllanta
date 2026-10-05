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
