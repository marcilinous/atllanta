// An invite must never move an account out of another organisation: org_id is
// assigned once, by Atllanta. The refusal must not reveal which organisation
// the email belongs to.  Run: node --test tests/

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = globalThis.__inv = {};
let tmp;
let handler;
let realFetch;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-inv-'));
  fs.mkdirSync(path.join(tmp, 'server', 'legacy'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'lib', 'supabaseServer.js'), `
    const S = globalThis.__inv;
    function chain(table) {
      const ops = [];
      const c = {};
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'single', 'maybeSingle', 'update', 'insert', 'upsert']) {
        c[m] = (...a) => { ops.push([m, ...a]); if (m === 'upsert') S.upserts.push(a[0]); return c; };
      }
      c.then = (resolve) => {
        S.db.push({ table, ops });
        const t = S.tables[table];
        return resolve(typeof t === 'function' ? t(ops) : (t ?? { data: null, error: null }));
      };
      return c;
    }
    export const SUPABASE_URL = 'https://stub.supabase.co';
    export function supabaseAdmin() {
      return {
        from: (t) => chain(t),
        auth: { admin: {
          listUsers: async () => ({ data: { users: S.authUsers } }),
          createUser: async ({ email }) => { S.created.push(email); return { data: { user: { id: 'new-user-id' } }, error: null }; },
        } },
      };
    }
  `);
  fs.copyFileSync(path.join(ROOT, 'server/legacy/create-org.js'), path.join(tmp, 'server', 'legacy', 'create-org.js'));
  handler = (await import(pathToFileURL(path.join(tmp, 'server', 'legacy', 'create-org.js')).href)).default;
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
  S.authUsers = [];
  S.created = [];
  S.upserts = [];
  S.callerRole = 'admin';
  S.callerStatus = 'active';
  S.emailMember = null;
  S.existingRow = null;
  const has = (ops, ...want) => ops.some(o => want.every((w, i) => o[i] === w));
  S.tables = {
    users: (ops) => {
      if (has(ops, 'eq', 'id', 'caller-id')) return { data: { org_id: 'org-1', role: S.callerRole, status: S.callerStatus }, error: null };
      if (has(ops, 'eq', 'email')) return { data: S.emailMember, error: null };
      if (has(ops, 'upsert')) return { data: null, error: null };
      return { data: S.existingRow, error: null };
    },
  };
});

function res() {
  return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const invite = (email, role = 'member') => ({
  method: 'POST',
  headers: { authorization: 'Bearer user-jwt' },
  body: { action: 'invite', email, role },
  query: {},
});

describe('invite across organisations', () => {
  test('refuses an email that belongs to another organisation and changes nothing', async () => {
    S.authUsers = [{ id: 'u-2', email: 'boss@other.com' }];
    S.existingRow = { org_id: 'org-2' };
    const r = res(); await handler(invite('boss@other.com'), r);
    assert.deepEqual([r.statusCode, r.body], [409, { error: "This email can't be invited to your organisation" }]);
    assert.equal(S.upserts.length, 0);
    assert.equal(S.created.length, 0);
  });

  test('the refusal does not reveal the other organisation', async () => {
    S.authUsers = [{ id: 'u-2', email: 'boss@other.com' }];
    S.existingRow = { org_id: 'org-2' };
    const r = res(); await handler(invite('boss@other.com'), r);
    assert.equal(JSON.stringify(r.body).includes('org-2'), false);
  });

  test('reports an existing member of the same organisation found by account id', async () => {
    S.authUsers = [{ id: 'u-3', email: 'x@a.com' }];
    S.existingRow = { org_id: 'org-1' };
    const r = res(); await handler(invite('x@a.com'), r);
    assert.deepEqual([r.statusCode, r.body], [409, { error: 'This email is already a member' }]);
    assert.equal(S.upserts.length, 0);
  });

  test('invites a brand-new email into the caller organisation', async () => {
    const r = res(); await handler(invite('new@a.com'), r);
    assert.equal(r.body.invited, true);
    assert.deepEqual(S.created, ['new@a.com']);
    assert.deepEqual([S.upserts[0].id, S.upserts[0].org_id], ['new-user-id', 'org-1']);
  });

  test('invites an existing account that has no organisation yet', async () => {
    S.authUsers = [{ id: 'u-4', email: 'free@a.com' }];
    const r = res(); await handler(invite('free@a.com'), r);
    assert.equal(r.body.invited, true);
    assert.deepEqual([S.upserts[0].id, S.upserts[0].org_id], ['u-4', 'org-1']);
    assert.equal(S.created.length, 0);
  });

  test('a member (non-admin) cannot invite', async () => {
    S.callerRole = 'member';
    const r = res(); await handler(invite('new@a.com'), r);
    assert.equal(r.statusCode, 403);
    assert.equal(S.upserts.length, 0);
  });

  test('an exited caller cannot invite, even an owner/admin', async () => {
    S.callerStatus = 'exited';
    const r = res(); await handler(invite('new@a.com'), r);
    assert.deepEqual([r.statusCode, r.body], [403, { error: 'Your account is no longer active' }]);
    assert.equal(S.upserts.length, 0);
    assert.equal(S.created.length, 0);
  });

  test('an admin cannot invite an owner', async () => {
    const r = res(); await handler(invite('new@a.com', 'owner'), r);
    assert.deepEqual([r.statusCode, r.body], [403, { error: 'Only an owner can invite another owner' }]);
    assert.equal(S.upserts.length, 0);
    assert.equal(S.created.length, 0);
  });

  test('an owner can invite an owner', async () => {
    S.callerRole = 'owner';
    const r = res(); await handler(invite('new@a.com', 'owner'), r);
    assert.equal(r.body.invited, true);
    assert.equal(r.body.role, 'owner');
    assert.deepEqual(S.created, ['new@a.com']);
    assert.equal(S.upserts[0].role, 'owner');
  });
});
