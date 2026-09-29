// v1.7.1: leave integrity. Before this, any member could approve their own
// leave, set any leave balance, add holidays and submit pre-approved
// requests (confirmed on production in a rolled-back probe). These checks pin
// the migration's rules; the same 22 scenarios were run against production
// with the migration applied inside an always-rolled-back transaction.
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'supabase', 'migrations');
const file = fs.readdirSync(dir).find((f) => f.endsWith('_leave_integrity.sql'));
const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');

test('a new request must be your own, in your org, and pending with no review', () => {
  assert.match(sql, /create policy lr_insert on public\.leave_requests\s+for insert with check \(\s*org_id = auth_org_id\(\)\s+and user_id = auth\.uid\(\)\s+and coalesce\(status, 'pending'\) = 'pending'\s+and reviewed_by is null and reviewed_at is null and review_comment is null\s*\);/);
});

test('the guard: nothing about a submitted request changes, except its status by the right person', () => {
  const g = sql.slice(sql.indexOf('create or replace function public.leave_requests_guard()'), sql.indexOf('create trigger trg_leave_requests_guard'));
  assert.match(g, /if auth\.uid\(\) is null then\s+return new;/, 'server code is exempt');
  for (const col of ['org_id', 'user_id', 'leave_type_id', 'start_date', 'end_date', 'days', 'reason', 'document_url', 'created_at']) {
    assert.match(g, new RegExp(`new\\.${col} is distinct from old\\.${col}`), col);
  }
  assert.match(g, /if old\.status is distinct from 'pending' then/, 'only a pending request moves');
  assert.match(g, /if old\.user_id <> auth\.uid\(\) then\s+raise exception 'Only the person who asked can cancel/);
  assert.match(g, /if old\.user_id = auth\.uid\(\) then\s+raise exception 'You cannot approve or reject your own leave request'/);
  // Owner decision (a): an owner's or admin's leave needs an admin/owner.
  assert.match(g, /if v_requester_role in \('owner', 'admin'\) then\s+if not is_org_admin\(\) then/);
  assert.match(g, /new\.reviewed_by := auth\.uid\(\);\s+new\.reviewed_at := now\(\);/, 'the approver is stamped by the database');
  assert.match(g, /raise exception 'That status change is not allowed'/);
  assert.match(g, /security definer\s+set search_path to 'public'/);
  assert.match(sql, /create trigger trg_leave_requests_guard\s+before update on public\.leave_requests/);
});

test('balances and holidays are written by owners and admins only', () => {
  for (const [table, policies] of [['leave_balances', ['lb_insert', 'lb_update']], ['holidays', ['hol_insert', 'hol_update', 'hol_delete']]]) {
    for (const p of policies) {
      const body = sql.slice(sql.indexOf(`create policy ${p} on public.${table}`)).split(';')[0];
      assert.match(body, /hr_can_configure\(\)/, `${table}.${p}`);
    }
  }
});

test('the helper functions check the organisation and are not open to anonymous callers', () => {
  assert.match(sql, /revoke all on function public\.apply_approved_leave_usage\(uuid, uuid\) from public, anon;/);
  assert.match(sql, /revoke all on function public\.init_leave_balances\(uuid\) from public, anon;/);
  assert.match(sql, /init_leave_balances: person not in caller org/);
  assert.match(sql, /on conflict \(user_id, leave_type_id, year\) do nothing;/, 'never overwrites an existing balance');
  assert.match(sql, /revoke all on function public\.leave_requests_guard\(\) from public, anon, authenticated;/);
});

test('no processor writes leave balances directly any more', () => {
  const browser = fs.readFileSync(path.join(ROOT, 'public', 'js', 'event-processor.js'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'server', 'legacy', 'event-processor.js'), 'utf8');
  assert.doesNotMatch(browser, /from\('leave_balances'\)/);
  assert.doesNotMatch(browser, /apply_leave_usage'/);
  assert.doesNotMatch(server, /rpc\("apply_leave_usage"/);
  assert.match(browser, /rpc\('apply_approved_leave_usage'/);
  assert.match(server, /rpc\("apply_approved_leave_usage"/);
});
