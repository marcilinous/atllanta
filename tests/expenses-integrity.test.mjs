// v1.15.1: expenses integrity. Before this, every member could read every
// colleague's claims, a claimant could change an approved claim's amount or
// delete it after payment, owners/admins could approve their own, and
// managers' approvals silently did nothing. These checks pin the migration;
// 26 scenarios were run against production with it applied inside an
// always-rolled-back transaction. Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'supabase', 'migrations');
const file = fs.readdirSync(dir).find((f) => f.endsWith('_expenses_integrity.sql'));
const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
const policy = (name, table = 'public.expenses') => {
  const start = sql.indexOf(`create policy ${name} on ${table}`);
  assert.ok(start >= 0, `policy ${name} exists`);
  return sql.slice(start, sql.indexOf(';', start));
};
const guard = sql.slice(
  sql.indexOf('create or replace function public.expenses_guard()'),
  sql.indexOf('$function$;', sql.indexOf('create or replace function public.expenses_guard()')),
);

test('the old org-wide policies and the old guard are replaced', () => {
  for (const p of ['select', 'insert', 'update', 'delete']) {
    assert.match(sql, new RegExp(`drop policy if exists org_isolation_${p} on public\\.expenses;`), p);
  }
  assert.match(sql, /drop trigger if exists trg_expenses_guard_review on public\.expenses;/);
  assert.match(sql, /create trigger trg_expenses_guard\s+before insert or update on public\.expenses/);
  assert.match(sql, /revoke all on function public\.expenses_guard\(\) from public, anon, authenticated;/);
});

test('a claim is seen by the claimant, admins, the reporting line and HR — not every colleague', () => {
  const p = policy('exp_select');
  assert.match(p, /org_id = auth_org_id\(\)/);
  for (const who of ['is_org_admin\\(\\)', 'user_id = auth\\.uid\\(\\)', 'user_report_ids\\(\\)', 'hr_visible_user_ids\\(\\)']) {
    assert.match(p, new RegExp(who), who);
  }
});

test('you submit only your own claim, pending and unreviewed, for a positive amount', () => {
  const p = policy('exp_insert');
  assert.match(p, /user_id = auth\.uid\(\)/);
  assert.match(p, /coalesce\(status, 'pending'\) = 'pending'/);
  assert.match(p, /reviewed_by is null and reviewed_at is null\s+and review_comment is null and reimbursed_at is null/);
  assert.match(sql, /add constraint expenses_amount_positive check \(amount > 0\);/);
  assert.match(guard, /c\.id = new\.category_id and c\.org_id = new\.org_id/, 'category from your own company');
});

test('only approvers may update; you withdraw only your own pending claim', () => {
  const u = policy('exp_update');
  assert.doesNotMatch(u, /user_id = auth\.uid\(\)/, 'the claimant is not an updater');
  assert.match(u, /hr_can_approve\(\) and user_id in \(select hr_visible_user_ids\(\)\)/);
  const d = policy('exp_delete');
  assert.match(d, /user_id = auth\.uid\(\)\s+and status = 'pending'/);
});

test('what was claimed never changes after submitting', () => {
  for (const col of ['amount', 'title', 'expense_date', 'receipt_url', 'category_id', 'user_id', 'currency', 'description']) {
    assert.match(guard, new RegExp(`new\\.${col} is distinct from old\\.${col}`), col);
  }
});

test('nobody reviews their own claim; an owner\'s or admin\'s needs an admin; the reviewer is stamped', () => {
  assert.match(guard, /if old\.user_id = auth\.uid\(\) then\s+raise exception 'You cannot review your own expense claim'/);
  assert.match(guard, /if v_claimant_role in \('owner', 'admin'\) then\s+if not is_org_admin\(\) then/);
  assert.match(guard, /new\.reviewed_by := auth\.uid\(\);\s+new\.reviewed_at := now\(\);/);
});

test('only pending → approved/rejected and approved → reimbursed; reimbursing is owner/admin only', () => {
  assert.match(guard, /if old\.status = 'pending' and new\.status in \('approved', 'rejected'\) then/);
  assert.match(guard, /if old\.status = 'approved' and new\.status = 'reimbursed' then\s+if not is_org_admin\(\) then/);
  assert.match(guard, /new\.reimbursed_at := now\(\);/);
  assert.match(guard, /raise exception 'That status change is not allowed'/);
  assert.match(guard, /if auth\.uid\(\) is null then\s+return new;/, 'server code is exempt');
});

test('receipts follow the claim: read by who sees it, kept once it is reviewed', () => {
  const r = policy('documents_expenses_read', 'storage.objects');
  assert.match(r, /to authenticated/);
  assert.match(r, /owner = auth\.uid\(\)\s+or exists \(select 1 from public\.expenses e where e\.receipt_url = objects\.name\)/);
  assert.doesNotMatch(r, /hr_can_approve/);
  const d = policy('documents_expenses_delete', 'storage.objects');
  assert.match(d, /e\.receipt_url = objects\.name and e\.status <> 'pending'/);
});

test('the legacy finance screen still fits the rules', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'views', 'finance', 'index.js'), 'utf8');
  assert.match(js, /user_id: user\.id,[\s\S]*?status: 'pending'/, 'submits own, pending');
  assert.match(js, /from\('expenses'\)\.delete\(\)\.eq\('id', btn\.dataset\.id\)/, 'withdraw is a delete');
  assert.match(js, /e\.status === 'approved' && isAdmin/, 'only owners/admins see Mark Reimbursed');
});
