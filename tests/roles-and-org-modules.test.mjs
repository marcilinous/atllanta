// Phase 3 Step 1: roles, role_permissions, org_modules, users.custom_role_id.
// Static checks on the PENDING migration text — nothing here touches a
// database. Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULE_KEYS } from '../src/lib/auth/modules.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260926063815_roles_and_org_modules.sql'),
  'utf8',
);

function moduleKeyListsIn(text) {
  return [...text.matchAll(/module_key in\s*\(([\s\S]*?)\)\)/g)].map((m) =>
    m[1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean),
  );
}

test('users_role_check includes developer', () => {
  assert.match(sql, /check \(role in \('owner','admin','developer','manager','member'\)\)/);
});

test('roles, role_permissions and org_modules exist with RLS enabled', () => {
  for (const t of ['roles', 'role_permissions', 'org_modules']) {
    assert.ok(sql.includes(`create table public.${t} (`), `creates public.${t}`);
    assert.ok(
      sql.includes(`alter table public.${t} enable row level security;`),
      `enables RLS on public.${t}`,
    );
  }
});

test('org_modules has no insert or delete policy', () => {
  assert.doesNotMatch(sql, /create policy org_modules_insert/);
  assert.doesNotMatch(sql, /create policy org_modules_delete/);
  assert.doesNotMatch(sql, /for insert[\s\S]{0,80}on public\.org_modules/);
  assert.doesNotMatch(sql, /for delete[\s\S]{0,80}on public\.org_modules/);
  assert.ok(sql.includes('create policy org_modules_select'));
  assert.ok(sql.includes('create policy org_modules_update'));
});

test('role_permissions writes require a non-system role in the same org', () => {
  for (const policy of ['role_permissions_insert', 'role_permissions_update', 'role_permissions_delete']) {
    const idx = sql.indexOf(`create policy ${policy}`);
    assert.ok(idx > 0, `finds policy ${policy}`);
    const clause = sql.slice(idx, idx + 400);
    assert.match(clause, /is_org_admin\(\)/);
    assert.match(clause, /r\.org_id = role_permissions\.org_id/);
    assert.match(clause, /not r\.is_system/);
  }
});

test('the custom_role_id org check runs before the auth.uid() is null bypass', () => {
  const customRoleCheckIdx = sql.indexOf('new.custom_role_id is not null and not exists');
  const bypassIdx = sql.indexOf('if auth.uid() is null then');
  assert.ok(customRoleCheckIdx > 0, 'finds the custom_role_id org/system check');
  assert.ok(bypassIdx > 0, 'finds the service-role bypass');
  assert.ok(customRoleCheckIdx < bypassIdx, 'the custom_role_id check runs first');
});

test('the non-admin member fallback resets custom_role_id', () => {
  const insertBranchIdx = sql.indexOf("tg_op = 'INSERT' then");
  const insertBranch = sql.slice(insertBranchIdx, insertBranchIdx + 200);
  assert.match(insertBranch, /new\.role := 'member';/);
  assert.match(insertBranch, /new\.custom_role_id := null;/);

  assert.match(sql, /new\.custom_role_id := old\.custom_role_id;/, 'the UPDATE fallback list resets custom_role_id');
});

test('a self custom_role_id change is treated as a self role change', () => {
  assert.match(
    sql,
    /new\.custom_role_id is distinct from old\.custom_role_id and old\.id = auth\.uid\(\)/,
  );
});

test('seed_org_platform_rows is revoked from authenticated, and the backfill runs it', () => {
  assert.ok(
    sql.includes('revoke all on function public.seed_org_platform_rows(uuid) from public, anon, authenticated;'),
  );
  assert.ok(sql.includes('select public.seed_org_platform_rows(id) from public.organizations;'));
});

test('module_enabled grants to authenticated and guards cross-org access', () => {
  assert.ok(sql.includes('grant execute on function public.module_enabled(uuid, text) to authenticated;'));
  assert.match(
    sql,
    /auth\.uid\(\) is not null and p_org is distinct from auth_org_id\(\) then false/,
  );
});

test('the 13 module keys match MODULE_KEYS and are identical in both check constraints', () => {
  const lists = moduleKeyListsIn(sql);
  assert.equal(lists.length, 2, 'finds exactly two module_key check constraints');
  assert.equal(MODULE_KEYS.length, 13);
  for (const list of lists) {
    assert.deepEqual(list, [...MODULE_KEYS]);
  }
  assert.deepEqual(lists[0], lists[1], 'role_permissions and org_modules use the identical list');
});

test('users_guard_admin_fields still carries the three v1.3.2 rule messages', () => {
  assert.ok(sql.includes('You cannot change your own role'));
  assert.ok(sql.includes('Only an owner can grant or remove the owner role'));
  assert.ok(sql.includes('An organisation must keep at least one owner'));
});

test('no drop table, no drop trigger', () => {
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /drop trigger/i);
});
