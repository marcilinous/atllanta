// The browser event processor must claim events through claim_events and
// finish them through resolve_event. events has no UPDATE policy, so direct
// status updates are silently dropped and the same event would be processed
// (notifications sent, leave deducted) on every poll.  Run: node --test tests/

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let tmp, loads = 0;

// Shared, per-test state read by the stub client.
const S = globalThis.__eventTest = { calls: [], queue: [], firstTime: true, failTable: null };

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-proc-'));
  fs.writeFileSync(path.join(tmp, 'supabase.js'), `
    const S = globalThis.__eventTest;
    function chain(table) {
      const ops = [];
      const c = {};
      for (const m of ['select','insert','update','upsert','delete','eq','in','gte','lt','order','limit','single','maybeSingle']) {
        c[m] = (...a) => { ops.push([m, ...a]); return c; };
      }
      c.then = (resolve, reject) => {
        S.calls.push({ kind: 'from', table, ops });
        if (S.failTable === table) return reject(new Error('boom'));
        const data = table === 'users' ? { reporting_manager_id: null, full_name: 'Test User' } : null;
        return resolve({ data, error: null, count: 0 });
      };
      return c;
    }
    export default {
      from: (t) => chain(t),
      rpc(name, args) {
        S.calls.push({ kind: 'rpc', name, args });
        if (name === 'claim_events') return Promise.resolve({ data: S.queue.splice(0), error: null });
        if (name === 'claim_side_effect') return Promise.resolve({ data: S.firstTime, error: null });
        if (name === 'apply_leave_usage') return Promise.resolve({ data: 3, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
  `);
  fs.writeFileSync(path.join(tmp, 'auth.js'), `
    export function getUser() { return { id: 'user-1' }; }
    export function getOrg() { return { id: 'org-1' }; }
  `);
});

after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

beforeEach(() => { S.calls = []; S.queue = []; S.firstTime = true; S.failTable = null; });

// Load a fresh copy of the processor (module state such as `processing` and
// the interval must not leak between tests), run one poll, then stop it.
async function runOnce(event) {
  const file = path.join(tmp, `event-processor-${++loads}.js`);
  fs.copyFileSync(path.join(ROOT, 'js', 'event-processor.js'), file);
  const P = await import(pathToFileURL(file).href);
  S.queue = [event];
  P.startEventProcessor();
  const deadline = Date.now() + 2000;
  while (!S.calls.some(c => c.name === 'resolve_event') && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10));
  }
  P.stopEventProcessor();
}

const rpcs = (name) => S.calls.filter(c => c.kind === 'rpc' && c.name === name);

describe('claiming and resolving', () => {
  test('claims through claim_events and never updates events directly', async () => {
    await runOnce({ id: 'ev-1', event_type: 'leave.request.rejected', attempts: 1, payload: { user_id: 'u-2', leave_request_id: 'lr-1' } });
    assert.equal(rpcs('claim_events').length, 1);
    assert.equal(S.calls.some(c => c.kind === 'from' && c.table === 'events'), false);
    assert.deepEqual(rpcs('resolve_event')[0].args, { event_id: 'ev-1', new_status: 'completed' });
  });

  test('a failing handler re-queues the event with the error', async () => {
    S.failTable = 'notifications';
    await runOnce({ id: 'ev-2', event_type: 'leave.request.rejected', attempts: 1, payload: { user_id: 'u-2', leave_request_id: 'lr-1' } });
    const args = rpcs('resolve_event')[0].args;
    assert.equal(args.event_id, 'ev-2');
    assert.equal(args.new_status, 'pending');
    assert.match(args.p_error, /boom/);
  });

  test('a third failed attempt marks the event failed', async () => {
    S.failTable = 'notifications';
    await runOnce({ id: 'ev-3', event_type: 'leave.request.rejected', attempts: 3, payload: { user_id: 'u-2', leave_request_id: 'lr-1' } });
    assert.equal(rpcs('resolve_event')[0].args.new_status, 'failed');
  });
});

describe('leave approval is applied at most once', () => {
  const approved = { id: 'ev-4', event_type: 'leave.request.approved', attempts: 1,
    payload: { user_id: 'u-2', approved_by: 'u-3', leave_request_id: 'lr-1', leave_type_id: 'lt-1', days: '2' } };

  test('first run claims the side effect, then applies the usage', async () => {
    await runOnce(approved);
    const order = S.calls.filter(c => c.kind === 'rpc').map(c => c.name);
    assert.ok(order.indexOf('claim_side_effect') < order.indexOf('apply_leave_usage'));
    assert.deepEqual(rpcs('claim_side_effect')[0].args, { p_event_id: 'ev-4', p_effect_key: 'leave_used' });
    assert.deepEqual(rpcs('apply_leave_usage')[0].args, { p_user_id: 'u-2', p_leave_type_id: 'lt-1', p_year: new Date().getFullYear(), p_days: 2 });
  });

  test('a retry whose side effect was already claimed does not deduct again', async () => {
    S.firstTime = false;
    await runOnce(approved);
    assert.equal(rpcs('apply_leave_usage').length, 0);
    assert.equal(S.calls.some(c => c.kind === 'from' && c.table === 'leave_balances'), false);
  });
});
