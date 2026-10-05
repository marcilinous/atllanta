// bulk-import.js must refuse an exited caller before doing any import work,
// the same way lib/aiGateway.js's resolveCaller does for the AI endpoints.
// Run: node --test tests/

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = globalThis.__bulkImportTest = {};
let tmp;
let handler;
let realFetch;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-bulk-'));
  fs.mkdirSync(path.join(tmp, 'server', 'legacy'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'lib', 'supabaseServer.js'), `
    const S = globalThis.__bulkImportTest;
    function chain(table) {
      const ops = [];
      const c = {};
      for (const m of ['select', 'eq', 'limit', 'single', 'maybeSingle', 'insert']) {
        c[m] = (...a) => { ops.push([m, ...a]); return c; };
      }
      c.then = (resolve) => {
        S.db.push({ table, ops });
        if (table === 'users') {
          return resolve({ data: { org_id: S.orgId, role: S.callerRole, status: S.callerStatus }, error: null });
        }
        if (table === 'invitations' || table === 'candidates') {
          S.inserts.push({ table, row: ops.find(o => o[0] === 'insert')?.[1] });
          return resolve({ data: null, error: null });
        }
        return resolve({ data: null, error: null });
      };
      return c;
    }
    export const SUPABASE_URL = 'https://stub.supabase.co';
    export function supabaseAdmin() {
      return { from: (t) => chain(t), rpc: async (name, args) => { S.db.push({ rpc: name, args }); return { data: S.orgState, error: null }; } };
    }
  `);
  fs.copyFileSync(path.join(ROOT, 'lib', 'orgAccess.js'), path.join(tmp, 'lib', 'orgAccess.js'));
  fs.copyFileSync(path.join(ROOT, 'server/legacy/bulk-import.js'), path.join(tmp, 'server', 'legacy', 'bulk-import.js'));
  handler = (await import(pathToFileURL(path.join(tmp, 'server', 'legacy', 'bulk-import.js')).href)).default;
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: 'caller-id' }) });
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
});

after(() => {
  globalThis.fetch = realFetch;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  S.db = [];
  S.inserts = [];
  S.orgId = 'org-1';
  S.callerRole = 'admin';
  S.callerStatus = 'active';
  S.orgState = 'ok';
});

function res() {
  return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const importReq = (rows) => ({
  method: 'POST',
  headers: { authorization: 'Bearer user-jwt' },
  body: { type: 'employees', rows: rows || [{ full_name: 'A', email: 'a@example.com' }] },
});

describe('bulk-import access', () => {
  test('an exited admin is refused with 403 before any row is imported', async () => {
    S.callerStatus = 'exited';
    const r = res();
    await handler(importReq(), r);
    assert.deepEqual([r.statusCode, r.body], [403, { error: 'Your account is no longer active' }]);
    assert.equal(S.inserts.length, 0);
  });

  test('a company whose trial ended or which is paused cannot import (v1.13.0)', async () => {
    S.orgState = 'trial_ended';
    const r = res();
    await handler(importReq(), r);
    assert.equal(r.statusCode, 403);
    assert.equal(S.inserts.length, 0);
    assert.deepEqual(S.db.find((e) => e.rpc)?.args, { p_org_id: 'org-1', p_user_id: 'caller-id' });
  });

  test('an active admin can still import', async () => {
    const r = res();
    await handler(importReq(), r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.imported, 1);
    assert.equal(S.inserts.length, 1);
  });

  test('an admin importing a row with role owner fails that row with an explicit error', async () => {
    const r = res();
    await handler(importReq([{ full_name: 'A', email: 'a@example.com', role: 'owner' }]), r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.imported, 0);
    assert.deepEqual(r.body.errors, [{ row: 1, error: 'Only an owner can import owners' }]);
    assert.equal(S.inserts.length, 0);
  });

  test('an owner importing a row with role owner is accepted', async () => {
    S.callerRole = 'owner';
    const r = res();
    await handler(importReq([{ full_name: 'A', email: 'a@example.com', role: 'owner' }]), r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.imported, 1);
    assert.equal(S.inserts[0].row.role, 'owner');
  });
});
