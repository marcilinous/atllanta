// The cron endpoint must (1) accept GET, which is how Vercel Cron calls it,
// (2) refuse to run without CRON_SECRET, and (3) claim each event with a
// conditional update so it never runs a recipe the browser processor already
// claimed.  Run: node --test tests/

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = globalThis.__apiTest = { calls: [], pending: [], claimWins: true, firstTime: true, failCompletion: false, rpcErrors: {} };
let tmp, handler;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-api-'));
  fs.mkdirSync(path.join(tmp, 'server', 'legacy'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'lib', 'supabaseServer.js'), `
    const S = globalThis.__apiTest;
    function chain(table) {
      const ops = [];
      const c = {};
      for (const m of ['select','insert','update','upsert','eq','neq','in','lt','gte','order','limit','single','maybeSingle']) {
        c[m] = (...a) => { ops.push([m, ...a]); return c; };
      }
      c.then = (resolve) => {
        S.calls.push({ table, ops });
        const names = ops.map(o => o[0]);
        // The pre-v1.2.5 dedup lookup (earlier approved events for one request): none here.
        if (table === 'events' && names[0] === 'select' && names.includes('neq')) return resolve({ data: [], error: null });
        if (table === 'events' && names[0] === 'select') return resolve({ data: S.pending, error: null });
        if (table === 'events' && names[0] === 'update' && names.includes('select')) {
          return resolve({ data: S.claimWins ? [{ id: 'ev-1' }] : [], error: null });
        }
        if (table === 'events' && names[0] === 'update' && !names.includes('select') && S.failCompletion) {
          return resolve({ data: null, error: { message: 'write failed' } });
        }
        if (table === 'leave_types' && names[0] === 'select') {
          return resolve({ data: [{ id: 'lt-1', annual_quota: 12 }], error: null });
        }
        if (table === 'leave_requests' && names[0] === 'select') {
          return resolve({ data: S.leaveRequest || null, error: null });
        }
        if (table === 'users' && names[0] === 'select') {
          const idOp = ops.find(o => o[0] === 'eq' && o[1] === 'id');
          if (idOp) return resolve({ data: (S.usersById || {})[idOp[2]] || null, error: null });
          return resolve({ data: S.orgUsers || [], error: null });
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
          return Promise.resolve({ data: name === 'claim_side_effect' ? S.firstTime : [{ requeued: 0, deadlettered: 0 }], error: null });
        },
      };
    }
    export const SUPABASE_URL = 'https://stub.supabase.co';
  `);
  fs.copyFileSync(path.join(ROOT, 'server/legacy', 'event-processor.js'), path.join(tmp, 'server', 'legacy', 'event-processor.js'));
  handler = (await import(pathToFileURL(path.join(tmp, 'server', 'legacy', 'event-processor.js')).href)).default;
});

after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.CRON_SECRET; });

beforeEach(() => {
  S.calls = []; S.pending = []; S.claimWins = true; S.firstTime = true; S.failCompletion = false; S.rpcErrors = {};
  // Recipes now reload rows scoped to org_id instead of trusting the
  // payload, so the stub needs fixture rows for the events these tests
  // exercise. `leave.request.approved` reads the leave_requests row for
  // 'lr-1' (must be status "approved" for the recipe to proceed); the
  // `people.employee.created` and tenant-scoping tests read the users row
  // for employee 'u-1'.
  S.leaveRequest = { id: 'lr-1', user_id: 'u-2', leave_type_id: 'lt-1', days: 2, start_date: '2026-01-01', end_date: '2026-01-01', status: 'approved' };
  S.usersById = { 'u-1': { id: 'u-1', full_name: 'New Employee', reporting_manager_id: null } };
  S.orgUsers = [];
  process.env.CRON_SECRET = 'test-secret';
  delete process.env.RESEND_API_KEY;   // recipes must never reach Resend from a test
});

function res() {
  return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const req = (method, auth) => ({ method, headers: auth ? { authorization: auth } : {} });

describe('access', () => {
  test('refuses to run when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET;
    const r = res();
    await handler(req('GET', 'Bearer anything'), r);
    assert.equal(r.statusCode, 500);
    assert.equal(S.calls.length, 0);
  });

  test('rejects a missing or wrong bearer token', async () => {
    const a = res(); await handler(req('GET'), a);
    const b = res(); await handler(req('GET', 'Bearer nope'), b);
    assert.equal(a.statusCode, 401);
    assert.equal(b.statusCode, 401);
    assert.equal(S.calls.length, 0);
  });

  test('accepts GET with the right token, which is how Vercel Cron calls it', async () => {
    const r = res();
    await handler(req('GET', 'Bearer test-secret'), r);
    assert.equal(r.statusCode, 200);
  });

  test('rejects other methods', async () => {
    const r = res();
    await handler(req('PUT', 'Bearer test-secret'), r);
    assert.equal(r.statusCode, 405);
  });
});

describe('claiming', () => {
  const event = { id: 'ev-1', event_type: 'people.employee.created', attempts: 0,
    payload: { employee_id: 'u-1', org_id: 'org-1' } };

  test('claims with a conditional update on status = pending', async () => {
    S.pending = [event];
    await handler(req('GET', 'Bearer test-secret'), res());
    const claim = S.calls.find(c => c.table === 'events' && c.ops[0][0] === 'update');
    assert.ok(claim, 'expected a claim update');
    assert.deepEqual(claim.ops.filter(o => o[0] === 'eq'), [['eq', 'id', 'ev-1'], ['eq', 'status', 'pending'], ['eq', 'attempts', 0]]);
    assert.ok(claim.ops.some(o => o[0] === 'select'));
  });

  test('skips an event another processor already claimed', async () => {
    S.pending = [event];
    S.claimWins = false;
    const r = res();
    await handler(req('GET', 'Bearer test-secret'), r);
    assert.equal(S.calls.some(c => c.table === 'leave_types'), false, 'recipe must not run');
    assert.deepEqual(r.body, { processed: 0, failed: 0, skipped: 1, total: 1 });
  });

  test('requeues stale events before reading the queue', async () => {
    S.pending = [event];
    await handler(req('GET', 'Bearer test-secret'), res());
    const requeueAt = S.calls.findIndex(c => c.rpc === 'requeue_stale_events');
    const selectAt = S.calls.findIndex(c => c.table === 'events' && c.ops[0][0] === 'select');
    assert.ok(requeueAt !== -1, 'expected requeue_stale_events to be called');
    assert.deepEqual(S.calls[requeueAt].args, { p_lease_seconds: 600, p_max_attempts: 3 });
    assert.ok(requeueAt < selectAt, 'requeue must run before the pending select');
  });
});

describe('replay safety', () => {
  // Real event rows carry org_id as a column (stamped by publish_event and
  // forwarded as event.org_id); the fixtures below now set it at the top
  // level rather than only inside payload, matching the org-scoped
  // contract the recipes reload rows under.
  const approvedEvent = { id: 'ev-1', org_id: 'org-1', event_type: 'leave.request.approved', attempts: 0,
    payload: { leave_request_id: 'lr-1', user_id: 'u-2', org_id: 'org-1', days: '2', leave_type_id: 'lt-1' } };
  const createdEvent = { id: 'ev-1', org_id: 'org-1', event_type: 'people.employee.created', attempts: 0,
    payload: { employee_id: 'u-1', org_id: 'org-1' } };

  test('leave.request.approved claims the side effect and applies usage atomically, once', async () => {
    S.pending = [approvedEvent];
    await handler(req('GET', 'Bearer test-secret'), res());

    const claimAt = S.calls.findIndex(c => c.rpc === 'claim_side_effect');
    const applyAt = S.calls.findIndex(c => c.rpc === 'apply_leave_usage');
    assert.ok(claimAt !== -1, 'expected claim_side_effect to be called');
    // Changed: dedup is now PER REQUEST, not per event — the effect key is
    // derived from the leave_requests row id (lr-1) instead of the fixed
    // literal "leave_used", so a fresh fake event for the same request
    // can't deduct usage twice (see event-recipes-org-scope.test.mjs).
    assert.deepEqual(S.calls[claimAt].args, { p_event_id: 'ev-1', p_effect_key: 'leave_used:lr-1' });
    assert.ok(applyAt !== -1, 'expected apply_leave_usage to be called');
    assert.ok(claimAt < applyAt, 'claim must happen before applying usage');
    assert.deepEqual(S.calls[applyAt].args, {
      p_user_id: 'u-2',
      p_leave_type_id: 'lt-1',
      p_year: new Date().getFullYear(),
      p_days: 2,
    });
    assert.equal(
      S.calls.some(c => c.table === 'leave_balances' && c.ops[0][0] === 'update'),
      false,
      'must not read-then-update leave_balances directly'
    );
  });

  test('leave.request.approved skips apply_leave_usage when the side effect was already claimed', async () => {
    S.pending = [approvedEvent];
    S.firstTime = false;
    await handler(req('GET', 'Bearer test-secret'), res());
    assert.equal(S.calls.some(c => c.rpc === 'apply_leave_usage'), false, 'apply_leave_usage must not run on replay');
  });

  test('people.employee.created upserts leave_balances with ignoreDuplicates so replay cannot reset used to 0', async () => {
    S.pending = [createdEvent];
    await handler(req('GET', 'Bearer test-secret'), res());
    const upsert = S.calls.find(c => c.table === 'leave_balances' && c.ops[0][0] === 'upsert');
    assert.ok(upsert, 'expected a leave_balances upsert');
    assert.deepEqual(upsert.ops[0][2], { onConflict: 'user_id,leave_type_id,year', ignoreDuplicates: true });
  });

  test('a failed completion write is logged, not swallowed', async (t) => {
    const errorMock = t.mock.method(console, 'error', () => {});
    S.pending = [createdEvent];
    S.failCompletion = true;
    await handler(req('GET', 'Bearer test-secret'), res());
    const call = errorMock.mock.calls.find(c => c.arguments[0] === 'event completion write failed:');
    assert.ok(call, 'expected a "event completion write failed:" console.error call');
  });

  test('a claim_side_effect error is thrown, so the event is retried and apply_leave_usage never runs', async () => {
    S.pending = [approvedEvent];
    S.rpcErrors.claim_side_effect = true;
    const r = res();
    await handler(req('GET', 'Bearer test-secret'), r);
    assert.equal(S.calls.some(c => c.rpc === 'apply_leave_usage'), false, 'apply_leave_usage must not run when claim_side_effect errors');
    assert.deepEqual(r.body, { processed: 0, failed: 1, skipped: 0, total: 1 });
  });

  test('an apply_leave_usage error after a successful claim is logged loudly, not retried', async (t) => {
    const errorMock = t.mock.method(console, 'error', () => {});
    S.pending = [approvedEvent];
    S.rpcErrors.apply_leave_usage = true;
    const r = res();
    await handler(req('GET', 'Bearer test-secret'), r);
    const call = errorMock.mock.calls.find(c => c.arguments[0] === 'leave usage apply failed after claim:');
    assert.ok(call, 'expected a "leave usage apply failed after claim:" console.error call');
    assert.deepEqual(r.body, { processed: 1, failed: 0, skipped: 0, total: 1 });
  });
});

describe('tenant', () => {
  test('recipes use the org_id from the event row, never the caller-supplied payload', async () => {
    const event = { id: 'ev-1', org_id: 'org-1', event_type: 'people.employee.created', attempts: 0,
      payload: { employee_id: 'u-1', org_id: 'org-evil' } };
    S.pending = [event];
    await handler(req('GET', 'Bearer test-secret'), res());

    const leaveTypesCall = S.calls.find(c => c.table === 'leave_types');
    assert.ok(leaveTypesCall, 'expected a leave_types call');
    assert.ok(
      leaveTypesCall.ops.some(o => o[0] === 'eq' && o[1] === 'org_id' && o[2] === 'org-1'),
      'expected leave_types to be scoped to the event row org_id'
    );
    assert.ok(
      !leaveTypesCall.ops.some(o => o.includes('org-evil')),
      'the payload-supplied org_id must never reach a query'
    );
  });
});
