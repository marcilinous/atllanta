// Phase 4 item 3 (expenses, v1.16.0 preview): the new-stack expenses logic.
// Behaviour tests for the input schemas, and static checks that every action
// passes both gates for Finance, never takes the org, the person, the currency
// or the reviewer from input, leaves the decision to the v1.15.1 database
// rules, and publishes the event shapes the legacy processors read.
// Run: node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  submitExpenseSchema,
  withdrawExpenseSchema,
  decideExpenseSchema,
  reimburseExpenseSchema,
  receiptLinkSchema,
  RECEIPT_MAX_BYTES,
  RECEIPT_TYPES,
} from '../src/lib/hrms/expenses/schemas.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const UUID = '7b0e6c1e-1234-4abc-8def-0123456789ab';
const claim = { title: 'Client lunch', amount: '450.50', expenseDate: '2026-10-06', categoryId: '', description: '' };

describe('input schemas', () => {
  test('a claim needs a title, a positive amount with at most two decimals, and a real date', () => {
    const ok = submitExpenseSchema.parse(claim);
    assert.equal(ok.amount, '450.50');
    assert.equal(ok.categoryId, null, 'no category is allowed');
    assert.equal(ok.description, null, 'a blank note is stored as nothing');
    assert.ok(!submitExpenseSchema.safeParse({ ...claim, title: '   ' }).success, 'blank title');
    for (const amount of ['0', '0.00', '-5', '12.345', 'abc', '1e3', '']) {
      assert.ok(!submitExpenseSchema.safeParse({ ...claim, amount }).success, amount);
    }
    assert.ok(!submitExpenseSchema.safeParse({ ...claim, amount: '10000000.01' }).success, 'too large');
    for (const expenseDate of ['2026-02-30', '06/10/2026', '2026-13-01', '']) {
      assert.ok(!submitExpenseSchema.safeParse({ ...claim, expenseDate }).success, expenseDate);
    }
    assert.ok(!submitExpenseSchema.safeParse({ ...claim, categoryId: 'not-a-uuid' }).success);
    assert.equal(submitExpenseSchema.parse({ ...claim, categoryId: UUID }).categoryId, UUID);
  });

  test('no org, person, currency, status or reviewer is accepted from input', () => {
    const parsed = submitExpenseSchema.parse({
      ...claim, orgId: UUID, userId: UUID, currency: 'USD', status: 'approved', reviewedBy: UUID, receiptUrl: 'x',
    });
    for (const k of ['orgId', 'userId', 'currency', 'status', 'reviewedBy', 'receiptUrl']) assert.equal(k in parsed, false, k);
    const decided = decideExpenseSchema.parse({ expenseId: UUID, decision: 'approve', reviewedBy: UUID });
    assert.equal('reviewedBy' in decided, false);
  });

  test('a decision is approve or reject, with an optional bounded comment', () => {
    assert.ok(decideExpenseSchema.safeParse({ expenseId: UUID, decision: 'approve' }).success);
    assert.ok(decideExpenseSchema.safeParse({ expenseId: UUID, decision: 'reject', comment: 'No receipt' }).success);
    assert.ok(!decideExpenseSchema.safeParse({ expenseId: UUID, decision: 'reimburse' }).success);
    assert.ok(!decideExpenseSchema.safeParse({ expenseId: UUID, decision: 'approve', comment: 'x'.repeat(501) }).success);
    for (const s of [withdrawExpenseSchema, reimburseExpenseSchema, receiptLinkSchema]) {
      assert.ok(s.safeParse({ expenseId: UUID }).success);
      assert.ok(!s.safeParse({ expenseId: 'x' }).success);
    }
  });

  test('receipts: 4 MB, PDF or image', () => {
    assert.equal(RECEIPT_MAX_BYTES, 4 * 1024 * 1024);
    assert.deepEqual([...RECEIPT_TYPES], ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']);
  });
});

describe('static: the actions', () => {
  const src = read('src', 'lib', 'hrms', 'expenses', 'actions.ts');
  const body = (name) => {
    const start = src.indexOf(`const ${name} =`);
    assert.ok(start >= 0, name);
    const next = src.indexOf('\nconst ', start + 1);
    const nextExport = src.indexOf('\nexport ', start + 1);
    const ends = [next, nextExport].filter((i) => i > 0);
    return src.slice(start, ends.length ? Math.min(...ends) : undefined);
  };

  test('every action passes both gates for Finance', () => {
    assert.match(body('submitAction'), /requireFeature\("finance", "finance", "create"\)/);
    assert.match(body('withdrawExpense'), /requireFeature\("finance", "finance", "edit"\)/);
    assert.match(body('decideExpense'), /requireFeature\("finance", "finance", "approve"\)/);
    assert.match(body('reimburseExpense'), /requireFeature\("finance", "finance", "approve"\)/);
    assert.match(body('getReceiptLink'), /requireFeature\("finance", "finance", "view"\)/);
  });

  test('org, person, currency and reviewer come from the server', () => {
    for (const name of ['submitAction', 'withdrawExpense', 'decideExpense', 'reimburseExpense', 'getReceiptLink']) {
      assert.doesNotMatch(body(name), /input\.(orgId|userId|currency|status|reviewedBy|receiptUrl)\b/, name);
    }
    const submit = body('submitAction');
    assert.match(submit, /userId: ctx\.userId/);
    assert.match(submit, /orgId: ctx\.orgId/);
    assert.match(submit, /currency: org\.currency/);
    assert.doesNotMatch(src, /reviewedBy:/, 'the database stamps the reviewer');
  });

  test('a category must be one of the company\'s active ones', () => {
    const submit = body('submitAction');
    assert.match(submit, /eq\(expenseCategories\.orgId, ctx\.orgId\)/);
    assert.match(submit, /eq\(expenseCategories\.isActive, true\)/);
  });

  test('the receipt is uploaded as the caller under expenses/{org}/{self}/ and removed if the claim fails', () => {
    const submit = body('submitAction');
    assert.match(submit, /`expenses\/\$\{ctx\.orgId\}\/\$\{ctx\.userId\}\//);
    assert.match(submit, /if \(receiptPath\) await supabase\.storage\.from\("documents"\)\.remove\(\[receiptPath\]\)/);
    assert.match(submit, /RECEIPT_MAX_BYTES/);
    assert.match(submit, /RECEIPT_TYPES/);
  });

  test('no service role; self-review refused before the database is asked', () => {
    assert.doesNotMatch(src, /service_?role|SERVICE_ROLE/i);
    assert.match(body('decideExpense'), /claim\.userId === ctx\.userId/);
    assert.match(body('reimburseExpense'), /ctx\.role !== "owner" && ctx\.role !== "admin"/);
  });

  test('only the right status changes are attempted, and refusals are explained', () => {
    assert.match(body('withdrawExpense'), /\.delete\(expenses\)[\s\S]*eq\(expenses\.userId, ctx\.userId\)[\s\S]*eq\(expenses\.status, "pending"\)/);
    assert.match(body('decideExpense'), /eq\(expenses\.status, "pending"\)/);
    assert.match(body('reimburseExpense'), /eq\(expenses\.status, "approved"\)/);
    assert.match(body('decideExpense'), /hasPgCode\(err, "42501"\)/);
    assert.match(body('reimburseExpense'), /hasPgCode\(err, "42501"\)/);
  });

  test('receipt links are short-lived and only for claims the caller can see', () => {
    const link = body('getReceiptLink');
    assert.match(link, /withTransaction\(\{ id: ctx\.userId \}/, 'read under RLS as the caller');
    assert.match(link, /createSignedUrl\(path, 60\)/);
  });

  test('events use the names and payloads the legacy processors handle', () => {
    assert.match(body('submitAction'), /"finance\.expense\.created", \{\s*expense_id: created\.id,\s*org_id: ctx\.orgId,\s*amount:/);
    assert.match(body('decideExpense'), /"finance\.expense\.approved", \{\s*expense_id: claim\.id,\s*org_id: ctx\.orgId,\s*user_id: claim\.userId,/);
  });

  test('every change is audited', () => {
    for (const name of ['submitAction', 'withdrawExpense', 'decideExpense', 'reimburseExpense']) {
      assert.match(body(name), /await audit\(\{/, name);
    }
  });
});

describe('static: the screens', () => {
  test('both pages check both gates before loading', () => {
    const mine = read('app', '(dashboard)', 'hrms', 'expenses', 'page.tsx');
    assert.match(mine, /featureContext\("finance", "finance", "view"\)/);
    const approvals = read('app', '(dashboard)', 'hrms', 'expenses', 'approvals', 'page.tsx');
    assert.match(approvals, /featureContext\("finance", "finance", "approve"\)/);
  });

  test('approvals never offer what the database will refuse', () => {
    const q = read('src', 'lib', 'hrms', 'expenses', 'queries.ts');
    assert.match(q, /ne\(expenses\.userId, ctx\.userId\)/);
    assert.match(q, /callerIsAdmin \? undefined : inArray\(users\.role, \["manager", "member", "developer"\]\)/);
  });

  test('the legacy report and categories stay legacy, linked from the tabs', () => {
    const nav = read('app', '(dashboard)', 'hrms', 'expenses', 'expenses-nav.tsx');
    assert.match(nav, /href="\/#\/reports\/expenses"/);
    assert.match(nav, /href="\/#\/finance\/categories"/);
  });

});

describe('cutover (v1.16.1)', () => {
  const html = read('public', 'index.html');
  const nav = read('app', '(dashboard)', 'hrms', 'expenses', 'expenses-nav.tsx');

  test('#/finance forwards to the new screens; the legacy finance view is no longer loaded', () => {
    assert.match(html, /registerRoute\('finance', toNewStack\('\/hrms\/expenses', 'expenses'\)\);/);
    assert.doesNotMatch(html, /import financeView from '\/views\/finance\/index\.js';/);
    assert.match(html, /registerRoute\('attendance', toNewStack\('\/hrms\/attendance', 'attendance'\)\);/, 'attendance still forwards');
  });

  test('the report and categories stay legacy, and the tabs never link back into the redirect', () => {
    assert.match(html, /registerRoute\('reports\/expenses', expenseReport\);/);
    assert.match(html, /registerRoute\('finance\/categories', expenseCategoriesView\);/);
    assert.doesNotMatch(nav, /href="\/#\/finance"/);
  });
});
