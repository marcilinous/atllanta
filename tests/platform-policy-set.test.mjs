// Phase 1 item 2: each platform table carries the policy set it should have.
// organizations is updatable by its own admins, invitation writes are
// admin-only, and users_update ties the row to the caller's org.
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'supabase', 'migrations');
const sql = fs.readdirSync(dir)
  .filter((f) => f.endsWith('_platform_policy_set_per_table.sql'))
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));

test('exactly one policy-set migration exists', () => {
  assert.equal(sql.length, 1);
});

test('organizations becomes updatable by its own admins', () => {
  assert.match(sql[0], /create policy organizations_admin_update on public\.organizations\s+for update\s+using \(id = auth_org_id\(\) and is_org_admin\(\)\)\s+with check \(id = auth_org_id\(\) and is_org_admin\(\)\)/);
});

test('invitation writes are admin-only and the member-wide policy is gone', () => {
  assert.match(sql[0], /drop policy invitations_org on public\.invitations/);
  assert.match(sql[0], /create policy invitations_admin_all on public\.invitations[\s\S]*is_org_admin\(\)\)\s*;/);
  assert.equal(/create policy invitations_[a-z_]+ on public\.invitations[\s\S]*?using \(org_id = auth_org_id\(\)\)(?!\s+and)/.test(sql[0]), false);
});

test("users_update's WITH CHECK ties the row to the caller's org", () => {
  assert.match(sql[0], /alter policy users_update on public\.users[\s\S]*with check \(\(\(id = auth\.uid\(\)\) or is_org_admin\(\)\) and org_id = auth_org_id\(\)\)/);
});
