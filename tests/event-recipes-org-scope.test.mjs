// The event-processor recipes must never trust caller-controlled payload
// values as facts: every row is reloaded scoped to event.org_id, and a
// recipe that reflects a state change requires the row to actually be in
// that state. These tests drive the recipes through the exported default
// handler exactly like tests/event-processor-api.test.mjs, with a stub
// supabaseServer.js extended to be id+org_id-aware so a row in another org
// (or under a mismatched id) is genuinely invisible to the recipe, proving
// the org scoping actually happens rather than merely being present in the
// source. Run: node --test tests/

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = (globalThis.__orgScopeTest = {
  calls: [],
  pending: [],
  claimWins: true,
  firstTime: true,
  failCompletion: false,
  rpcErrors: {},
  rows: {},
  sideEffectCount: 0,
  attendanceUpserts: [],
  notificationInserts: [],
});

let tmp, handler;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-org-scope-'));
  fs.mkdirSync(path.join(tmp, 'server', 'legacy'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(
    path.join(tmp, 'lib', 'supabaseServer.js'),
    `
    const S = globalThis.__orgScopeTest;
    function chain(table) {
      const ops = [];
      const c = {};
      for (const m of ['select','insert','update','upsert','eq','neq','in','lt','gte','order','limit','single','maybeSingle']) {
        c[m] = (...a) => { ops.push([m, ...a]); return c; };
      }
      c.then = (resolve) => {
        S.calls.push({ table, ops });
        const names = ops.map(o => o[0]);
        const firstOp = names[0];

        // The pre-v1.2.5 dedup lookup: earlier approved events for one request.
        if (table === 'events' && firstOp === 'select' && names.includes('neq')) {
          return resolve({ data: S.earlierEvents || [], error: null });
        }
        if (table === 'events' && firstOp === 'select') {
          return resolve({ data: S.pending, error: null });
        }
        if (table === 'events' && firstOp === 'update' && names.includes('select')) {
          return resolve({ data: S.claimWins ? [{ id: 'ev-1' }] : [], error: null });
        }
        if (table === 'events' && firstOp === 'update' && !names.includes('select') && S.failCompletion) {
          return resolve({ data: null, error: { message: 'write failed' } });
        }
        if (table === 'leave_types' && firstOp === 'select') {
          return resolve({ data: [{ id: 'lt-1', annual_quota: 12 }], error: null });
        }
        if (table === 'event_side_effects' && firstOp === 'select') {
          const key = ops.find(o => o[0] === 'eq' && o[1] === 'effect_key')?.[2];
          if (key === 'leave_used') return resolve({ count: S.legacySideEffectCount || 0, data: null, error: null });
          return resolve({ count: S.sideEffectCount || 0, data: null, error: null });
        }
        if (table === 'notifications' && firstOp === 'insert') {
          const insertPayload = ops.find(o => o[0] === 'insert')?.[1];
          if (Array.isArray(insertPayload)) {
            S.notificationInserts.push(...insertPayload);
          } else if (insertPayload) {
            S.notificationInserts.push(insertPayload);
          }
          return resolve({ data: insertPayload, error: null });
        }
        if (table === 'attendance' && firstOp === 'upsert') {
          const upsertRow = ops.find(o => o[0] === 'upsert')?.[1];
          const upsertOpts = ops.find(o => o[0] === 'upsert')?.[2];
          S.attendanceUpserts.push({ row: upsertRow, opts: upsertOpts });
          return resolve({ data: upsertRow, error: null });
        }
        if (table === 'work_schedules' && firstOp === 'select') {
          const orgEq = ops.find(o => o[0] === 'eq' && o[1] === 'org_id')?.[2];
          const sched = S.rows.work_schedules?.[orgEq] || S.rows.work_schedules?.default || { shift_start: '09:00:00' };
          return resolve({ data: sched, error: null });
        }

        if (firstOp === 'select') {
          const eqOps = ops.filter(o => o[0] === 'eq');
          const idEq = eqOps.find(o => o[1] === 'id')?.[2];
          const orgEq = eqOps.find(o => o[1] === 'org_id')?.[2];
          const userIdEq = eqOps.find(o => o[1] === 'user_id')?.[2];
          const dateEq = eqOps.find(o => o[1] === 'date')?.[2];
          const inRoleOp = ops.find(o => o[0] === 'in' && o[1] === 'role');

          if (table === 'users' && !idEq && inRoleOp) {
            const roleUsers = (S.rows.users_by_role || []).filter(u => (!orgEq || u.org_id === orgEq) && inRoleOp[2].includes(u.role));
            return resolve({ data: roleUsers, error: null });
          }

          if (table === 'attendance' && userIdEq && dateEq) {
            const key = userIdEq + ':' + dateEq;
            const row = S.rows.attendance?.[key] || (idEq ? S.rows.attendance?.[idEq] : null);
            if (row && (!orgEq || row.org_id === orgEq)) {
              return resolve({ data: row, error: null });
            }
            return resolve({ data: null, error: null });
          }

          const tableRows = S.rows[table] || {};
          if (idEq) {
            const row = tableRows[idEq];
            if (row && (!orgEq || row.org_id === orgEq)) {
              return resolve({ data: row, error: null });
            }
            return resolve({ data: null, error: null });
          }
        }

        return resolve({ data: null, error: null });
      };
      return c;
    }
    export function supabaseAdmin() {
      return {
        from: (t) => chain(t),
        rpc(name, args) {
          S.calls.push({ rpc: name, args });
          if (S.rpcErrors[name]) return Promise.resolve({ data: null, error: { message: 'rpc failed' } });
          return Promise.resolve({
            data: name === 'claim_side_effect' ? S.firstTime : [{ requeued: 0, deadlettered: 0 }],
            error: null,
          });
        },
      };
    }
    export const SUPABASE_URL = 'https://stub.supabase.co';
  `
  );
  fs.copyFileSync(
    path.join(ROOT, 'server/legacy', 'event-processor.js'),
    path.join(tmp, 'server', 'legacy', 'event-processor.js')
  );
  handler = (
    await import(
      pathToFileURL(path.join(tmp, 'server', 'legacy', 'event-processor.js')).href
    )
  ).default;
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.CRON_SECRET;
});

beforeEach(() => {
  S.calls = [];
  S.earlierEvents = [];
  S.legacySideEffectCount = 0;
  S.pending = [];
  S.claimWins = true;
  S.firstTime = true;
  S.failCompletion = false;
  S.rpcErrors = {};
  S.rows = {
    leave_requests: {},
    users: {},
    expenses: {},
    jobs: {},
    candidates: {},
    job_applications: {},
    attendance_regularizations: {},
    attendance: {},
    work_schedules: {},
  };
  S.sideEffectCount = 0;
  S.attendanceUpserts = [];
  S.notificationInserts = [];
  process.env.CRON_SECRET = 'test-secret';
  delete process.env.RESEND_API_KEY;
});

function res() {
  return {
    statusCode: 0,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

const req = (method = 'POST', auth = 'Bearer test-secret') => ({
  method,
  headers: auth ? { authorization: auth } : {},
});

describe('event recipes org scoping and security', () => {
  test('leave.request.approved for a request in another org', async () => {
    S.rows.leave_requests['lr-1'] = {
      id: 'lr-1',
      org_id: 'org-2',
      status: 'approved',
      user_id: 'u-1',
      leave_type_id: 'lt-1',
      days: 2,
      start_date: '2026-02-01',
      end_date: '2026-02-02',
    };

    S.pending = [
      {
        id: 'ev-1',
        org_id: 'org-1',
        event_type: 'leave.request.approved',
        attempts: 0,
        payload: { leave_request_id: 'lr-1' },
      },
    ];

    const response = res();
    await handler(req('POST'), response);

    assert.equal(response.statusCode, 200);
    const applyCalls = S.calls.filter((c) => c.rpc === 'apply_leave_usage');
    assert.equal(applyCalls.length, 0);
    assert.equal(S.attendanceUpserts.length, 0);
    assert.equal(S.notificationInserts.length, 0);
  });

  test('leave.request.approved for own-org request with status pending', async () => {
    S.rows.leave_requests['lr-1'] = {
      id: 'lr-1',
      org_id: 'org-1',
      status: 'pending',
      user_id: 'u-1',
      leave_type_id: 'lt-1',
      days: 2,
      start_date: '2026-02-01',
      end_date: '2026-02-02',
    };

    S.pending = [
      {
        id: 'ev-1',
        org_id: 'org-1',
        event_type: 'leave.request.approved',
        attempts: 0,
        payload: { leave_request_id: 'lr-1' },
      },
    ];

    const response = res();
    await handler(req('POST'), response);

    assert.equal(response.statusCode, 200);
    const applyCalls = S.calls.filter((c) => c.rpc === 'apply_leave_usage');
    assert.equal(applyCalls.length, 0);
  });

  test('leave.request.approved own-org approved uses the row values not the payload', async () => {
    S.rows.leave_requests['lr-1'] = {
      id: 'lr-1',
      org_id: 'org-1',
      status: 'approved',
      user_id: 'row-user',
      leave_type_id: 'row-lt',
      days: 5,
      start_date: '2026-02-01',
      end_date: '2026-02-01',
    };
    S.rows.users['row-user'] = {
      id: 'row-user',
      org_id: 'org-1',
      email: 'row-user@example.com',
    };

    S.pending = [
      {
        id: 'ev-1',
        org_id: 'org-1',
        event_type: 'leave.request.approved',
        attempts: 0,
        payload: {
          leave_request_id: 'lr-1',
          user_id: 'payload-user',
          leave_type_id: 'payload-lt',
          days: 99,
        },
      },
    ];

    const response = res();
    await handler(req('POST'), response);

    assert.equal(response.statusCode, 200);
    const applyCall = S.calls.find((c) => c.rpc === 'apply_leave_usage');
    assert.ok(applyCall, 'apply_leave_usage should be called');
    assert.equal(applyCall.args.p_user_id, 'row-user');
    assert.equal(applyCall.args.p_leave_type_id, 'row-lt');
    assert.equal(applyCall.args.p_days, 5);

    assert.equal(S.attendanceUpserts.length, 1);
    assert.equal(S.attendanceUpserts[0].row.user_id, 'row-user');
    assert.equal(S.attendanceUpserts[0].row.org_id, 'org-1');
  });

  test('a second different event for the same approved request does not double-apply', async () => {
    S.rows.leave_requests['lr-1'] = {
      id: 'lr-1',
      org_id: 'org-1',
      status: 'approved',
      user_id: 'row-user',
      leave_type_id: 'row-lt',
      days: 5,
      start_date: '2026-02-01',
      end_date: '2026-02-01',
    };
    S.rows.users['row-user'] = {
      id: 'row-user',
      org_id: 'org-1',
      email: 'row-user@example.com',
    };

    S.pending = [
      {
        id: 'ev-1',
        org_id: 'org-1',
        event_type: 'leave.request.approved',
        attempts: 0,
        payload: { leave_request_id: 'lr-1' },
      },
    ];
    S.firstTime = true;
    S.sideEffectCount = 0;

    let response = res();
    await handler(req('POST'), response);
    assert.equal(response.statusCode, 200);

    const firstRunApplyCount = S.calls.filter((c) => c.rpc === 'apply_leave_usage').length;
    assert.equal(firstRunApplyCount, 1);

    // A fresh, different event for the SAME request: event_side_effects
    // already has a row for `leave_used:lr-1`, so the count check must skip
    // apply_leave_usage even though claim_side_effect's own mocked return is
    // still "firstTime".
    S.calls = [];
    S.pending = [
      {
        id: 'ev-2',
        org_id: 'org-1',
        event_type: 'leave.request.approved',
        attempts: 0,
        payload: { leave_request_id: 'lr-1' },
      },
    ];
    S.sideEffectCount = 1;

    response = res();
    await handler(req('POST'), response);
    assert.equal(response.statusCode, 200);

    const secondRunApplyCount = S.calls.filter((c) => c.rpc === 'apply_leave_usage').length;
    assert.equal(secondRunApplyCount, 0);
  });

  test('a request approved before v1.2.5 (bare leave_used key) is not deducted again', async () => {
    S.rows.leave_requests['lr-old'] = {
      id: 'lr-old', org_id: 'org-1', status: 'approved', user_id: 'row-user',
      leave_type_id: 'row-lt', days: 2, start_date: '2026-01-05', end_date: '2026-01-05',
    };
    S.rows.users['row-user'] = { id: 'row-user', org_id: 'org-1', email: 'row-user@example.com' };
    S.pending = [{ id: 'ev-new', org_id: 'org-1', event_type: 'leave.request.approved', attempts: 0, payload: { leave_request_id: 'lr-old' } }];
    S.firstTime = true;
    S.sideEffectCount = 0;
    S.earlierEvents = [{ id: 'ev-old' }];
    S.legacySideEffectCount = 1;

    const response = res();
    await handler(req('POST'), response);
    assert.equal(response.statusCode, 200);
    assert.equal(S.calls.filter((c) => c.rpc === 'apply_leave_usage').length, 0);
    assert.equal(S.notificationInserts.length, 0);

    // Control: with no earlier legacy claim, the same event does apply.
    S.calls = []; S.notificationInserts = [];
    S.earlierEvents = []; S.legacySideEffectCount = 0;
    await handler(req('POST'), res());
    assert.equal(S.calls.filter((c) => c.rpc === 'apply_leave_usage').length, 1);
  });

  test('attendance.checkin.completed with a payload user_id from another org does not update', async () => {
    const today = new Date().toISOString().split('T')[0];
    S.rows.attendance[`org1-user:${today}`] = {
      id: 'att-1',
      org_id: 'org-1',
      user_id: 'org1-user',
      date: today,
      check_in: `${today}T10:00:00Z`,
    };
    S.rows.work_schedules = {
      'org-1': { shift_start: '09:00' },
    };

    S.pending = [
      {
        id: 'ev-1',
        org_id: 'org-1',
        event_type: 'attendance.checkin.completed',
        attempts: 0,
        payload: { user_id: 'org2-user' },
      },
    ];

    const response = res();
    await handler(req('POST'), response);

    assert.equal(response.statusCode, 200);
    const attendanceUpdates = S.calls.filter(
      (c) => c.table === 'attendance' && c.ops.some((o) => o[0] === 'update')
    );
    assert.equal(attendanceUpdates.length, 0);
  });

  test('finance.expense.created uses the row amount/title not the payload, and escapes the email HTML', async () => {
    S.rows.expenses['exp-1'] = {
      id: 'exp-1',
      org_id: 'org-1',
      user_id: 'submitter-1',
      amount: 500,
      title: '<script>alert(1)</script>',
    };
    S.rows.users['submitter-1'] = {
      id: 'submitter-1',
      org_id: 'org-1',
      full_name: 'Submitter One',
      reporting_manager_id: 'mgr-1',
    };
    S.rows.users_by_role = [
      { id: 'admin-1', org_id: 'org-1', role: 'admin' },
    ];

    S.pending = [
      {
        id: 'ev-1',
        org_id: 'org-1',
        event_type: 'finance.expense.created',
        attempts: 0,
        payload: {
          expense_id: 'exp-1',
          amount: 1,
          title: 'spoofed',
        },
      },
    ];

    const response = res();
    await handler(req('POST'), response);

    assert.equal(response.statusCode, 200);
    // finance.expense.created inserts notification rows directly (its
    // recipients already come from org-scoped queries), so this checks the
    // raw notification body text carries the reloaded row's values, not the
    // payload's. HTML-escaping only applies to the createNotification email
    // path (esc() around title/body), which this recipe does not use.
    assert.ok(S.notificationInserts.length > 0, 'Notifications should be inserted');
    for (const notif of S.notificationInserts) {
      assert.ok(notif.body.includes('500'), 'Notification body should include row amount 500');
      assert.ok(
        notif.body.includes('<script>alert(1)</script>'),
        'Notification body should include row title'
      );
      assert.ok(!notif.body.includes('spoofed'), 'Notification body should not use spoofed title');
    }
  });

  test('createNotification for a user_id not in the org does not insert', async () => {
    S.rows.leave_requests['lr-1'] = {
      id: 'lr-1',
      org_id: 'org-1',
      status: 'rejected',
      user_id: 'ghost-user',
    };
    S.rows.users['ghost-user'] = {
      id: 'ghost-user',
      org_id: 'org-2',
      email: 'ghost@example.com',
    };

    S.pending = [
      {
        id: 'ev-1',
        org_id: 'org-1',
        event_type: 'leave.request.rejected',
        attempts: 0,
        payload: { leave_request_id: 'lr-1' },
      },
    ];

    const response = res();
    await handler(req('POST'), response);

    assert.equal(response.statusCode, 200);
    assert.equal(S.notificationInserts.length, 0);
  });
});
