// Phase 4 item 3 (attendance): the new-stack attendance logic. Behaviour
// tests for the pure pieces (org "today", hours, correction inputs) and
// static checks that every action passes both gates, never takes the org,
// the person or "now" from input, applies an approved correction in the same
// transaction, and publishes the event shapes the legacy processors read.
// Run: node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dayIn,
  hoursBetween,
  onOrNearDay,
  locationSchema,
  requestCorrectionSchema,
  decideCorrectionSchema,
} from '../src/lib/hrms/attendance/schemas.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const UUID = '7b0e6c1e-1234-4abc-8def-0123456789ab';

describe('pure helpers', () => {
  test('"today" is the org time zone, not the server\'s', () => {
    const at = new Date('2026-09-30T20:00:00Z'); // 01:30 on Oct 1 in India
    assert.equal(dayIn('Asia/Kolkata', at), '2026-10-01');
    assert.equal(dayIn('UTC', at), '2026-09-30');
    assert.equal(dayIn('America/Los_Angeles', at), '2026-09-30');
    assert.equal(dayIn('Not/AZone', at), '2026-09-30', 'a bad zone falls back to UTC');
  });

  test('hours are rounded to 2 decimals and never negative', () => {
    assert.equal(hoursBetween(new Date('2026-09-30T03:30:00Z'), new Date('2026-09-30T12:15:00Z')), 8.75);
    assert.equal(hoursBetween(new Date('2026-09-30T12:00:00Z'), new Date('2026-09-30T03:00:00Z')), 0);
  });

  test('a corrected time must sit on (or next to) the attendance day', () => {
    assert.ok(onOrNearDay('2026-09-30T04:00:00.000Z', '2026-09-30'));
    assert.ok(onOrNearDay('2026-09-29T20:00:00.000Z', '2026-09-30'), 'the evening before in UTC is morning in India');
    assert.ok(onOrNearDay('2026-10-01T02:00:00.000Z', '2026-09-30'), 'a night shift ending next morning');
    assert.ok(!onOrNearDay('2026-10-05T04:00:00.000Z', '2026-09-30'));
    assert.ok(!onOrNearDay('nonsense', '2026-09-30'));
  });
});

describe('input schemas', () => {
  test('location is optional and bounded; no org, person or time is accepted', () => {
    assert.ok(locationSchema.safeParse({}).success);
    assert.ok(locationSchema.safeParse({ lat: null, lng: null }).success);
    assert.ok(!locationSchema.safeParse({ lat: 91, lng: 0 }).success);
    const parsed = locationSchema.parse({ lat: 12.9, lng: 77.6, orgId: UUID, userId: UUID, checkIn: 'x', date: 'x' });
    for (const k of ['orgId', 'userId', 'checkIn', 'date']) assert.equal(k in parsed, false, k);
  });

  test('a correction needs a reason, at least one time, and check-out after check-in', () => {
    const base = { attendanceId: UUID, reason: 'Forgot to check out' };
    assert.ok(requestCorrectionSchema.safeParse({ ...base, requestedCheckOut: '2026-09-30T12:00:00.000Z' }).success);
    assert.ok(!requestCorrectionSchema.safeParse(base).success, 'no times');
    assert.ok(!requestCorrectionSchema.safeParse({ ...base, reason: '  ', requestedCheckIn: '2026-09-30T04:00:00.000Z' }).success);
    assert.ok(!requestCorrectionSchema.safeParse({ ...base, requestedCheckIn: '2026-09-30' }).success, 'a date is not an instant');
    assert.ok(
      !requestCorrectionSchema.safeParse({
        ...base,
        requestedCheckIn: '2026-09-30T12:00:00.000Z',
        requestedCheckOut: '2026-09-30T04:00:00.000Z',
      }).success
    );
    const parsed = requestCorrectionSchema.parse({ ...base, requestedCheckIn: '2026-09-30T04:00:00.000Z', userId: UUID, status: 'approved' });
    for (const k of ['userId', 'status']) assert.equal(k in parsed, false, k);
  });

  test('a decision is approve or reject', () => {
    assert.ok(decideCorrectionSchema.safeParse({ regularizationId: UUID, decision: 'approve' }).success);
    assert.ok(!decideCorrectionSchema.safeParse({ regularizationId: UUID, decision: 'cancel' }).success);
  });
});

describe('static: the actions', () => {
  const src = read('src', 'lib', 'hrms', 'attendance', 'actions.ts');
  const body = (name) => {
    const start = src.indexOf(`export const ${name} =`);
    assert.ok(start >= 0, name);
    const next = src.indexOf('export const ', start + 1);
    return src.slice(start, next < 0 ? undefined : next);
  };

  test('every action passes both gates', () => {
    assert.match(body('checkIn'), /requireFeature\("me", "me", "create"\)/);
    assert.match(body('checkOut'), /requireFeature\("me", "me", "edit"\)/);
    assert.match(body('requestCorrection'), /requireFeature\("me", "me", "create"\)/);
    assert.match(body('decideCorrection'), /requireFeature\("me", "me", "approve"\)/);
  });

  test('org, person, day and time come from the server', () => {
    for (const name of ['checkIn', 'checkOut', 'requestCorrection', 'decideCorrection']) {
      assert.doesNotMatch(body(name), /input\.(orgId|userId|date|checkIn|checkOut|status)\b/, name);
    }
    assert.match(body('checkIn'), /date: today/);
    assert.match(body('checkIn'), /dayIn\(await orgTimeZone\(ctx\)\)/);
  });

  test('no service role and no self-approval', () => {
    assert.doesNotMatch(src, /service_?role|SERVICE_ROLE/i);
    assert.match(body('decideCorrection'), /r\.userId === ctx\.userId/);
  });

  test('approving applies the correction in the same transaction', () => {
    const b = body('decideCorrection');
    const tx = b.slice(b.indexOf('withTransaction'), b.indexOf('await publish('));
    assert.match(tx, /\.update\(attendanceRegularizations\)/);
    assert.match(tx, /\.update\(attendance\)/);
    assert.match(tx, /eq\(attendanceRegularizations\.status, "pending"\)/, 'decides only a pending request');
  });

  test('events use the names and payloads the legacy processors handle', () => {
    assert.match(body('checkIn'), /"attendance\.checkin\.completed", \{\s*user_id: ctx\.userId,\s*org_id: ctx\.orgId,\s*check_in_time:/);
    assert.match(body('requestCorrection'), /"attendance\.regularization\.created", \{\s*regularization_id: created\.id,\s*user_id: ctx\.userId,\s*org_id: ctx\.orgId/);
    assert.match(body('decideCorrection'), /"attendance\.regularization\.approved", \{\s*regularization_id: reg\.id,\s*user_id: reg\.userId,\s*org_id: ctx\.orgId/);
    assert.doesNotMatch(src, /attendance\.regularization\.requested/);
  });

  test('every change is audited', () => {
    for (const name of ['checkIn', 'checkOut', 'requestCorrection', 'decideCorrection']) {
      assert.match(body(name), /await audit\(\{/, name);
    }
  });
});

describe('legacy Me page check-in (v1.10.0 fix)', () => {
  const me = read('public', 'views', 'me', 'index.js');

  test('the new row replaces todayAtt, so the redraw offers Check Out', () => {
    assert.match(me, /let todayAtt = attResult\.data;/);
    assert.doesNotMatch(me, /const todayAtt\b/);
    assert.doesNotMatch(me, /Object\.assign\(todayAtt \|\| \{\}/, 'copying into a throwaway object left todayAtt null');
    assert.match(me, /todayAtt = data;/);
  });
});

describe('static: the pages', () => {
  test('both pages check both gates before loading', () => {
    const mine = read('app', '(dashboard)', 'hrms', 'attendance', 'page.tsx');
    assert.match(mine, /featureContext\("me", "me", "view"\)/);
    const approvals = read('app', '(dashboard)', 'hrms', 'attendance', 'approvals', 'page.tsx');
    assert.match(approvals, /featureContext\("me", "me", "approve"\)/);
  });

});

describe('cutover (v1.11.0)', () => {
  const html = read('public', 'index.html');
  const nav = read('app', '(dashboard)', 'hrms', 'attendance', 'attendance-nav.tsx');

  test('#/attendance, its check-in and regularise routes forward to the new screen', () => {
    for (const route of ['attendance', 'attendance\\/checkin', 'attendance\\/regularize']) {
      assert.match(html, new RegExp(`registerRoute\\('${route}', toNewStack\\('/hrms/attendance', 'attendance'\\)\\);`), route);
    }
    assert.doesNotMatch(html, /views\/attendance\/checkin\.js|views\/attendance\/regularize\.js/);
    assert.match(html, /registerRoute\('leave', toNewStack\('\/hrms\/leave'\)\);/, 'leave still forwards');
  });

  test('the heatmap and report stay legacy, and the tabs never link back into the redirect', () => {
    assert.match(html, /registerRoute\('attendance\/overview', attendanceDashboard\);/);
    assert.match(html, /registerRoute\('attendance\/report', attendanceReport\);/);
    assert.match(nav, /href="\/#\/attendance\/overview"/);
    assert.match(nav, /href="\/#\/attendance\/report"/);
    assert.doesNotMatch(nav, /href="\/#\/attendance"/);
  });
});
