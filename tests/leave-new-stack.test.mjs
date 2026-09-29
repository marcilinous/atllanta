// Phase 4 item 3 (leave): the new-stack leave logic. Behaviour tests for the
// pure pieces (day counting, input schemas) and static checks that every
// action passes both gates, never takes the org or days from input, and
// publishes the event shapes the legacy processors read.
// Run: node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countWorkingDays, countCalendarDays, leaveDays, parseDay } from '../src/lib/hrms/leave/days.ts';
import { applyLeaveSchema, decideLeaveSchema, cancelLeaveSchema, LEAVE_DOCUMENT_MAX_BYTES } from '../src/lib/hrms/leave/schemas.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const UUID = '7b0e6c1e-1234-4abc-8def-0123456789ab';

describe('day counting (the legacy rule)', () => {
  test('weekdays count, weekends do not', () => {
    // 2026-11-09 is a Monday.
    assert.equal(countWorkingDays('2026-11-09', '2026-11-13'), 5); // Mon–Fri
    assert.equal(countWorkingDays('2026-11-09', '2026-11-15'), 5); // Mon–Sun
    assert.equal(countWorkingDays('2026-11-14', '2026-11-15'), 0); // Sat–Sun
    assert.equal(countWorkingDays('2026-11-13', '2026-11-16'), 2); // Fri–Mon
  });

  test('half days', () => {
    assert.equal(leaveDays('2026-11-10', '2026-11-10', true), 0.5);
    assert.equal(leaveDays('2026-11-09', '2026-11-11', true), 2.5);
    assert.equal(leaveDays('2026-11-14', '2026-11-14', true), 0, 'a half day on a Saturday costs nothing');
    assert.equal(leaveDays('2026-11-09', '2026-11-11', false), 3);
  });

  test('bad and backwards dates count nothing', () => {
    assert.equal(countWorkingDays('2026-11-13', '2026-11-09'), 0);
    assert.equal(countWorkingDays('2026-02-30', '2026-03-02'), 0);
    assert.equal(parseDay('2026-02-30'), null);
    assert.equal(parseDay('30/11/2026'), null);
    assert.equal(countCalendarDays('2026-11-09', '2026-11-15'), 7);
  });

  test('independent of the server time zone (UTC calendar dates)', () => {
    const tz = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Kolkata';
      assert.equal(countWorkingDays('2026-11-09', '2026-11-13'), 5);
      process.env.TZ = 'America/Los_Angeles';
      assert.equal(countWorkingDays('2026-11-09', '2026-11-13'), 5);
    } finally {
      process.env.TZ = tz;
    }
  });
});

describe('input schemas', () => {
  test('a request needs a type and real dates in order; no org, person or days are accepted', () => {
    const ok = applyLeaveSchema.safeParse({ leaveTypeId: UUID, startDate: '2026-11-09', endDate: '2026-11-10' });
    assert.ok(ok.success);
    assert.equal(ok.data.halfDay, false);
    const parsed = applyLeaveSchema.parse({ leaveTypeId: UUID, startDate: '2026-11-09', endDate: '2026-11-10', orgId: UUID, userId: UUID, days: 99 });
    for (const k of ['orgId', 'userId', 'days']) assert.equal(k in parsed, false, k);
    assert.ok(!applyLeaveSchema.safeParse({ leaveTypeId: UUID, startDate: '2026-11-10', endDate: '2026-11-09' }).success);
    assert.ok(!applyLeaveSchema.safeParse({ leaveTypeId: UUID, startDate: '2026-02-30', endDate: '2026-03-01' }).success);
    assert.ok(!applyLeaveSchema.safeParse({ leaveTypeId: 'CL', startDate: '2026-11-09', endDate: '2026-11-09' }).success);
  });

  test('a decision is approve or reject, with an optional comment', () => {
    assert.ok(decideLeaveSchema.safeParse({ requestId: UUID, decision: 'approve' }).success);
    assert.ok(!decideLeaveSchema.safeParse({ requestId: UUID, decision: 'cancel' }).success);
    assert.equal(decideLeaveSchema.parse({ requestId: UUID, decision: 'reject', comment: '  ' }).comment, null);
    assert.ok(!cancelLeaveSchema.safeParse({ requestId: 'x' }).success);
  });

  test('documents stay under the Vercel request limit', () => {
    assert.ok(LEAVE_DOCUMENT_MAX_BYTES <= 4.5 * 1024 * 1024 - 256 * 1024);
    assert.match(read('next.config.mjs'), /serverActions: \{ bodySizeLimit: "4\.5mb" \}/);
  });
});

describe('static: the actions', () => {
  const actions = read('src', 'lib', 'hrms', 'leave', 'actions.ts');

  test('every action passes both gates first', () => {
    assert.match(actions, /^"use server";/);
    assert.match(actions, /const applyAction = action\(applyWithDocumentSchema, async \(input\) => \{\n\s+const ctx = await requireFeature\("me", "me", "create"\);/);
    assert.match(actions, /export const cancelLeaveRequest = action\(cancelLeaveSchema, async \(input\) => \{\n\s+const ctx = await requireFeature\("me", "me", "edit"\);/);
    assert.match(actions, /export const decideLeaveRequest = action\(decideLeaveSchema, async \(input\) => \{\n\s+const ctx = await requireFeature\("me", "me", "approve"\);/);
    const perms = read('src', 'lib', 'auth', 'permissions.ts');
    assert.match(perms, /export async function requireFeature\([\s\S]*?const ctx = await requirePermission\(module, permission\);\n\s+if \(!canSeeFeature\(ctx, featureKey\)\)/);
  });

  test('org, person and days come from the server', () => {
    assert.doesNotMatch(actions, /input\.orgId|input\.userId|input\.days/);
    assert.match(actions, /const days = leaveDays\(input\.startDate, input\.endDate, input\.halfDay\);/);
    assert.match(actions, /orgId: ctx\.orgId,\n\s+userId: ctx\.userId,/);
  });

  test('reviewer is never sent: the database guard stamps it', () => {
    assert.doesNotMatch(actions, /reviewedBy|reviewedAt/);
  });

  test('events keep the payload shape the legacy processors read', () => {
    assert.match(actions, /"leave\.request\.created", \{\n\s+leave_request_id: created\.id,\n\s+user_id: ctx\.userId,\n\s+org_id: ctx\.orgId,/);
    assert.match(actions, /"leave\.request\.approved", \{\n\s+leave_request_id: request\.id,\n\s+user_id: request\.userId,\n\s+org_id: ctx\.orgId,\n\s+days: request\.days,\n\s+leave_type_id: request\.leaveTypeId,\n\s+approved_by: ctx\.userId,/);
    assert.match(actions, /"leave\.request\.rejected", \{\n\s+leave_request_id: request\.id,\n\s+user_id: request\.userId,\n\s+org_id: ctx\.orgId,/);
  });

  test('documents go to leave-docs/{org}/{self}/ and are removed if the request fails', () => {
    assert.match(actions, /const path = `leave-docs\/\$\{ctx\.orgId\}\/\$\{ctx\.userId\}\/\$\{Date\.now\(\)\}_\$\{safeFileName\(file\.name\)\}`;/);
    assert.match(actions, /if \(documentPath\) await supabase\.storage\.from\("documents"\)\.remove\(\[documentPath\]\);/);
  });
});
