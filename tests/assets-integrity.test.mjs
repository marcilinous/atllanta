// v1.16.2: assets integrity. Before this, every member could read the whole
// asset register (costs, serials, notes, who holds what) and its history, and
// nothing kept an asset's status, its holder and its assignment history in
// step. These checks pin the migration; the scenarios were run against
// production with it applied inside an always-rolled-back transaction.
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'supabase', 'migrations');
const file = fs.readdirSync(dir).find((f) => f.endsWith('_assets_integrity.sql'));
assert.ok(file, 'the assets integrity migration exists');
const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
const policy = (name, table) => {
  const start = sql.indexOf(`create policy ${name} on ${table}`);
  assert.ok(start >= 0, `policy ${name} exists`);
  return sql.slice(start, sql.indexOf(';', start));
};
const fn = (name) => {
  const start = sql.indexOf(`create or replace function public.${name}()`);
  assert.ok(start >= 0, `${name} exists`);
  return sql.slice(start, sql.indexOf('$function$;', start));
};

test('the old org-wide policies are replaced on both tables', () => {
  for (const table of ['assets', 'asset_assignments']) {
    for (const p of ['select', 'insert', 'update', 'delete']) {
      assert.match(sql, new RegExp(`drop policy if exists org_isolation_${p} on public\\.${table};`), `${table} ${p}`);
    }
  }
});

test('owners and admins see the register; everyone else sees only what they hold', () => {
  const a = policy('assets_select', 'public.assets');
  assert.match(a, /org_id = auth_org_id\(\)\s+and \(is_org_admin\(\) or assigned_to = auth\.uid\(\)\)/);
  const h = policy('asset_assignments_select', 'public.asset_assignments');
  assert.match(h, /org_id = auth_org_id\(\)\s+and \(is_org_admin\(\) or user_id = auth\.uid\(\)\)/);
});

test('only owners and admins of the company write, on both tables', () => {
  for (const table of ['assets', 'asset_assignments']) {
    assert.match(policy(`${table}_insert`, `public.${table}`), /with check \(org_id = auth_org_id\(\) and is_org_admin\(\)\)/, table);
    assert.match(policy(`${table}_update`, `public.${table}`),
      /using \(org_id = auth_org_id\(\) and is_org_admin\(\)\)\s+with check \(org_id = auth_org_id\(\) and is_org_admin\(\)\)/, table);
    assert.match(policy(`${table}_delete`, `public.${table}`), /using \(org_id = auth_org_id\(\) and is_org_admin\(\)\)/, table);
  }
});

test('status, holder and assignment time always agree; costs are not negative; one open assignment per asset', () => {
  assert.match(sql, /add constraint assets_holder_consistent check \(\s*\(status = 'assigned'\) = \(assigned_to is not null\)\s+and \(assigned_to is null\) = \(assigned_at is null\)\s*\);/);
  assert.match(sql, /add constraint assets_purchase_cost_nonnegative check \(purchase_cost is null or purchase_cost >= 0\);/);
  assert.match(sql, /create unique index asset_assignments_one_open\s+on public\.asset_assignments \(asset_id\) where returned_at is null;/);
});

test('the asset guard: no moving companies, assign only to an active colleague, return before reassigning or deleting', () => {
  const g = fn('assets_guard');
  assert.match(g, /if auth\.uid\(\) is null then\s+return coalesce\(new, old\);/);
  assert.match(g, /old\.status = 'assigned'[\s\S]*'Return this asset before deleting it'/);
  assert.match(g, /new\.status = 'assigned'[\s\S]*'Add the asset first, then assign it'/);
  assert.match(g, /new\.created_by := auth\.uid\(\);/);
  assert.match(g, /new\.org_id is distinct from old\.org_id\s+or new\.created_by is distinct from old\.created_by\s+or new\.created_at is distinct from old\.created_at/);
  assert.match(g, /old\.assigned_to is not null[\s\S]*'Return this asset before assigning it again'/);
  assert.match(g, /u\.id = new\.assigned_to and u\.org_id = new\.org_id and u\.status <> 'exited'/, 'active or on notice, never exited');
  assert.match(sql, /create trigger trg_assets_guard\s+before insert or update or delete on public\.assets/);
});

test('the history guard: a record matches the holder, is stamped by the database, and only its return is ever written', () => {
  const g = fn('asset_assignments_guard');
  assert.match(g, /if auth\.uid\(\) is null then\s+return coalesce\(new, old\);/);
  assert.match(g, /a\.id = new\.asset_id and a\.org_id = new\.org_id and a\.assigned_to = new\.user_id/);
  assert.match(g, /new\.assigned_by := auth\.uid\(\);\s+new\.assigned_at := now\(\);\s+new\.returned_at := null;/);
  assert.match(g, /new\.id is distinct from old\.id\s+or new\.org_id is distinct from old\.org_id\s+or new\.asset_id is distinct from old\.asset_id\s+or new\.user_id is distinct from old\.user_id\s+or new\.assigned_at is distinct from old\.assigned_at\s+or new\.assigned_by is distinct from old\.assigned_by\s+or new\.notes is distinct from old\.notes/);
  assert.match(g, /old\.returned_at is not null or new\.returned_at is null/);
  assert.match(g, /a\.id = old\.asset_id and a\.assigned_to = old\.user_id[\s\S]*'Mark the asset returned first'/);
  assert.match(g, /exists \(select 1 from public\.assets a where a\.id = old\.asset_id\)[\s\S]*'Assignment history cannot be deleted'/);
  assert.match(sql, /create trigger trg_asset_assignments_guard\s+before insert or update or delete on public\.asset_assignments/);
});

test('the guards are not callable directly', () => {
  for (const f of ['assets_guard', 'asset_assignments_guard']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\(\\) from public, anon, authenticated;`), f);
  }
});
