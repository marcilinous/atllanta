// v1.4.1: only owners, admins and developers may read the audit log (owner
// decision 2026-09-27). The migration, the local schema the isolation test
// builds from, and the legacy audit screen must all agree.  Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = read('supabase', 'migrations', '20260927152500_audit_logs_read_owners_admins_developers.sql');

test('the migration limits audit_select to readers the helper allows, in the caller\'s org', () => {
  assert.match(MIGRATION, /drop policy if exists audit_select on public\.audit_logs;/);
  assert.match(
    MIGRATION,
    /create policy audit_select on public\.audit_logs\s+for select using \(org_id in \(select auth_user_org_ids\(\)\) and can_read_audit_log\(\)\);/
  );
});

test('the helper admits exactly owner, admin and developer, and never an exited user', () => {
  assert.match(MIGRATION, /u\.role in \('owner', 'admin', 'developer'\)/);
  assert.match(MIGRATION, /coalesce\(u\.status, 'active'\) <> 'exited'/);
  assert.match(MIGRATION, /u\.id = auth\.uid\(\)/);
  assert.match(MIGRATION, /security definer\s+set search_path to 'public'/);
  assert.match(MIGRATION, /revoke all on function public\.can_read_audit_log\(\) from public, anon;/);
});

test('the migration adds no write policy (the audit trail stays append-only)', () => {
  assert.doesNotMatch(MIGRATION, /for (insert|update|delete|all)/i);
});

test('the local schema used by the isolation test matches', () => {
  const local = read('supabase', 'local', 'platform-schema.sql');
  assert.match(local, /and can_read_audit_log\(\)\);/);
  assert.match(local, /u\.role in \('owner','admin','developer'\)/);
  assert.doesNotMatch(local, /audit_select on public\.audit_logs\s+for select using \(org_id in \(select auth_user_org_ids\(\)\)\);/);
  const iso = read('supabase', 'tests', 'platform_tenant_isolation.test.sql');
  assert.match(iso, /member A read % audit row\(s\)/);
});

test('the legacy audit screen admits the same three roles', () => {
  const view = read('public', 'views', 'audit', 'log.js');
  assert.match(view, /\['owner', 'admin', 'developer'\]\.includes\(membership\.role\)/);
  assert.doesNotMatch(view, /super_admin/);
});
