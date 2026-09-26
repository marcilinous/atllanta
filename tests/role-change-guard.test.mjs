// nobody can change their own role; only an owner can grant or remove the
// owner role; an organisation must keep at least one owner.  Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the pending migration adds the role-change guard with correct ordering', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const sql = fs.readFileSync(path.join(dir, '20260926055357_users_role_change_guard.sql'), 'utf8');

  assert.ok(sql.includes('You cannot change your own role'), 'contains the self-role-change message');
  assert.ok(sql.includes('Only an owner can grant or remove the owner role'), 'contains the owner-grant message');
  assert.ok(sql.includes('An organisation must keep at least one owner'), 'contains the at-least-one-owner message');

  const roleCheckIdx = sql.indexOf('new.role is distinct from old.role');
  const insertOwnerIdx = sql.indexOf("tg_op = 'INSERT' and new.role = 'owner'");
  const adminShortcutIdx = sql.indexOf('if is_org_admin() then');

  assert.ok(roleCheckIdx > 0, 'finds the UPDATE role-change check');
  assert.ok(insertOwnerIdx > 0, 'finds the INSERT owner rule');
  assert.ok(adminShortcutIdx > roleCheckIdx, 'the UPDATE role check runs before the admin early return');
  assert.ok(adminShortcutIdx > insertOwnerIdx, 'the INSERT owner rule runs before the admin early return');

  assert.match(sql, /if auth\.uid\(\) is null then\s+return new;/, 'the service-role bypass is still first');
  assert.doesNotMatch(sql, /drop trigger/i, 'the migration does not drop/recreate the trigger');
});
