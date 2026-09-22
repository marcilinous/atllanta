// org_id is assigned by Atllanta: no signed-in user may change it (admins
// included), and the UI never shows it.  Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('a migration makes the users trigger reject any org_id change by a signed-in user', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const sql = fs.readdirSync(dir)
    .filter((f) => f.endsWith('_users_org_id_assigned_by_atllanta.sql'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
  assert.equal(sql.length, 1, 'exactly one org_id migration');
  const body = sql[0];
  const guard = body.indexOf('new.org_id is distinct from old.org_id');
  const adminShortcut = body.indexOf('if is_org_admin() then');
  assert.ok(guard > 0, 'rejects a changed org_id');
  assert.ok(adminShortcut > guard, 'the check runs before the admin early return');
  assert.match(body, /if auth\.uid\(\) is null then\s+return new;/, 'server code can still assign org_id');
});

test('the audit log strips org_id before showing record details', () => {
  const src = read('public/views/audit/log.js');
  assert.match(src, /JSON\.stringify\(withoutOrgId\(l\.new_values\)\)/);
  assert.doesNotMatch(src, /JSON\.stringify\(l\.new_values\)/);
});
