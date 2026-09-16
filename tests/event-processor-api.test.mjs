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
const S = globalThis.__apiTest = { calls: [], pending: [], claimWins: true };
let tmp, handler;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-api-'));
  fs.mkdirSync(path.join(tmp, 'api'));
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'lib', 'supabaseServer.js'), `
    const S = globalThis.__apiTest;
    function chain(table) {
      const ops = [];
      const c = {};
      for (const m of ['select','insert','update','upsert','eq','in','lt','gte','order','limit','single','maybeSingle']) {
        c[m] = (...a) => { ops.push([m, ...a]); return c; };
      }
      c.then = (resolve) => {
        S.calls.push({ table, ops });
        const names = ops.map(o => o[0]);
        if (table === 'events' && names[0] === 'select') return resolve({ data: S.pending, error: null });
        if (table === 'events' && names[0] === 'update' && names.includes('select')) {
          return resolve({ data: S.claimWins ? [{ id: 'ev-1' }] : [], error: null });
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
          return Promise.resolve({ data: [{ requeued: 0, deadlettered: 0 }], error: null });
        },
      };
    }
    export const SUPABASE_URL = 'https://stub.supabase.co';
  `);
  fs.copyFileSync(path.join(ROOT, 'api', 'event-processor.js'), path.join(tmp, 'api', 'event-processor.js'));
  handler = (await import(pathToFileURL(path.join(tmp, 'api', 'event-processor.js')).href)).default;
});

after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.CRON_SECRET; });

beforeEach(() => {
  S.calls = []; S.pending = []; S.claimWins = true;
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
    assert.deepEqual(claim.ops.filter(o => o[0] === 'eq'), [['eq', 'id', 'ev-1'], ['eq', 'status', 'pending']]);
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
