import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = globalThis.__ga = {};
let tmp;
let handler;
let signState;
let verifyState;
let realFetch;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-ga-'));
  fs.mkdirSync(path.join(tmp, 'server', 'legacy'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'lib'), { recursive: true });

  // stub lib/supabaseServer.js
  fs.writeFileSync(path.join(tmp, 'lib', 'supabaseServer.js'), `
    export const SUPABASE_URL = 'https://stub.supabase.co';
    export function supabaseAdmin() {
      return {
        from: (t) => {
          if (t === 'users') {
            const S = globalThis.__ga;
            const chain = {
              select: () => chain,
              eq: () => chain,
              maybeSingle: () => Promise.resolve({ data: { status: S.status ?? 'active' }, error: null }),
            };
            return chain;
          }
          return {
            upsert: (row) => {
              globalThis.__ga.upserts.push(row);
              return Promise.resolve({ data: null, error: null });
            }
          };
        }
      };
    }
  `);

  // copy real handler
  fs.copyFileSync(
    path.join(ROOT, 'server', 'legacy', 'google-auth.js'),
    path.join(tmp, 'server', 'legacy', 'google-auth.js')
  );

  const mod = await import(
    pathToFileURL(path.join(tmp, 'server', 'legacy', 'google-auth.js')).href
  );
  handler = mod.default;
  signState = mod.signState;
  verifyState = mod.verifyState;

  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.includes('/auth/v1/user')) {
      return {
        ok: S.tokenValid,
        json: async () => (S.tokenValid ? { id: 'user-1' } : null)
      };
    }
    if (u.includes('oauth2.googleapis.com/token')) {
      S.tokenCalls.push(opts?.body ? opts.body : null);
      return {
        ok: true,
        json: async () => ({
          access_token: 'a',
          refresh_token: 'r',
          expires_in: 3600
        })
      };
    }
    throw new Error('unexpected fetch ' + u);
  };

  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csecret';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
});

after(() => {
  globalThis.fetch = realFetch;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  S.upserts = [];
  S.tokenCalls = [];
  S.tokenValid = true;
  S.status = 'active';
});

function res() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    redirectedTo: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
    redirect(code, url) {
      this.statusCode = code;
      this.redirectedTo = url;
      return this;
    }
  };
}

function urlReq(token) {
  return {
    method: 'GET',
    headers: token ? { authorization: 'Bearer ' + token } : {},
    query: { action: 'url' }
  };
}

function callbackReq(state, cookieHeader) {
  return {
    method: 'GET',
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    query: { action: 'callback', code: 'auth-code', state }
  };
}

function cookieFromSetHeader(resObj) {
  const set = resObj.headers['Set-Cookie'];
  if (!set) return null;
  const str = Array.isArray(set) ? set[0] : set;
  const match = str.match(/atllanta_goauth=([^;]+)/);
  return match ? match[1] : null;
}

describe('google oauth state binding', () => {
  test('url with invalid token returns 401 and sets no cookie', async () => {
    S.tokenValid = false;
    const r = res();
    await handler(urlReq('bad-token'), r);
    assert.strictEqual(r.statusCode, 401);
    assert.strictEqual(r.headers['Set-Cookie'], undefined);
  });

  test('url with valid token returns a signed state that does not contain the bearer token, and a bound cookie', async () => {
    S.tokenValid = true;
    const r = res();
    await handler(urlReq('real-bearer-jwt'), r);
    const parsed = new URL(r.body.url);
    const state = parsed.searchParams.get('state');
    assert.ok(state && !state.includes('real-bearer-jwt'));
    const setCookie = r.headers['Set-Cookie'];
    assert.ok(typeof setCookie === 'string' && setCookie.includes('atllanta_goauth='));
    assert.ok(setCookie.includes('HttpOnly'));
    assert.ok(setCookie.includes('SameSite=Lax'));
    assert.ok(setCookie.includes('Path=/api/google-auth'));
  });

  test('full happy path binds state to cookie and stores tokens under the verified user', async () => {
    // Step 1: get state & cookie
    const r1 = res();
    await handler(urlReq('real-bearer-jwt'), r1);
    const parsed = new URL(r1.body.url);
    const state = parsed.searchParams.get('state');
    const cookieVal = cookieFromSetHeader(r1);
    // Step 2: callback
    const r2 = res();
    await handler(callbackReq(state, 'atllanta_goauth=' + cookieVal), r2);
    assert.ok(r2.redirectedTo && r2.redirectedTo.includes('google=connected'));
    assert.strictEqual(S.upserts.length, 1);
    assert.strictEqual(S.upserts[0].user_id, 'user-1');
    assert.strictEqual(S.tokenCalls.length, 1);
    const setCookie2 = r2.headers['Set-Cookie'];
    assert.ok(typeof setCookie2 === 'string' && setCookie2.includes('Max-Age=0'));
  });

  test('callback with valid state but no cookie is rejected', async () => {
    const rUrl = res();
    await handler(urlReq('real-bearer-jwt'), rUrl);
    const state = new URL(rUrl.body.url).searchParams.get('state');
    const r = res();
    await handler(callbackReq(state, null), r);
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(S.upserts.length, 0);
    assert.strictEqual(S.tokenCalls.length, 0);
  });

  test('callback with a cookie nonce from a different url call is rejected', async () => {
    // first call
    const rA = res();
    await handler(urlReq('real-bearer-jwt'), rA);
    const stateA = new URL(rA.body.url).searchParams.get('state');
    // second call
    const rB = res();
    await handler(urlReq('real-bearer-jwt'), rB);
    const cookieB = cookieFromSetHeader(rB);
    // use A's state with B's cookie
    const r = res();
    await handler(callbackReq(stateA, 'atllanta_goauth=' + cookieB), r);
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(S.upserts.length, 0);
  });

  test('tampered state is rejected', async () => {
    const rUrl = res();
    await handler(urlReq('real-bearer-jwt'), rUrl);
    const state = new URL(rUrl.body.url).searchParams.get('state');
    const cookieVal = cookieFromSetHeader(rUrl);
    const parts = state.split('.');
    assert.strictEqual(parts.length, 2);
    const idx = Math.floor(parts[0].length / 2);
    const original = parts[0][idx];
    const flipped = original === 'a' ? 'b' : 'a';
    const tamperedPart1 = parts[0].slice(0, idx) + flipped + parts[0].slice(idx + 1);
    const tamperedState = `${tamperedPart1}.${parts[1]}`;
    const r = res();
    await handler(callbackReq(tamperedState, 'atllanta_goauth=' + cookieVal), r);
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(S.upserts.length, 0);
  });

  test('expired state is rejected', async () => {
    const key = crypto.createHmac('sha256', 'csecret').update('atllanta-google-oauth-state-v1').digest();
    const state = signState({ uid: 'user-1', nonce: 'matching-nonce', exp: Date.now() - 1000 }, key);
    const r = res();
    await handler(callbackReq(state, 'atllanta_goauth=matching-nonce'), r);
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(S.upserts.length, 0);
  });

  test('verifyState rejects malformed input', () => {
    const key = crypto.createHmac('sha256', 'csecret').update('atllanta-google-oauth-state-v1').digest();
    assert.strictEqual(verifyState('', key), null);
    assert.strictEqual(verifyState('abc', key), null);
    assert.strictEqual(verifyState('a.b.c', key), null);
  });
});

describe('exited users are refused access', () => {
  test('url refuses an exited user with 403 and sets no cookie', async () => {
    S.status = 'exited';
    const r = res();
    await handler(urlReq('real-bearer-jwt'), r);
    assert.strictEqual(r.statusCode, 403);
    assert.deepEqual(r.body, { error: 'Your account is no longer active' });
    assert.strictEqual(r.headers['Set-Cookie'], undefined);
  });

  test('callback refuses an exited user with 403 and never calls Google or upserts tokens', async () => {
    // Get a valid state & cookie while still active.
    const r1 = res();
    await handler(urlReq('real-bearer-jwt'), r1);
    const parsed = new URL(r1.body.url);
    const state = parsed.searchParams.get('state');
    const cookieVal = cookieFromSetHeader(r1);

    // The account exits before the callback lands.
    S.status = 'exited';
    const r2 = res();
    await handler(callbackReq(state, 'atllanta_goauth=' + cookieVal), r2);

    assert.strictEqual(r2.statusCode, 403);
    assert.deepEqual(r2.body, { error: 'Your account is no longer active' });
    assert.strictEqual(S.upserts.length, 0);
    assert.strictEqual(S.tokenCalls.length, 0);
  });
});
