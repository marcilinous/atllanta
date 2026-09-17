// lib/aiGateway.js is the only path to Groq. It must identify the caller,
// refuse blocked or over-quota calls without calling Groq, record every call
// (ok, error, blocked) with exact tokens, and trace successful calls.
// Run: node --test tests/

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = globalThis.__gw = {};
let tmp, gw, realFetch;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-gw-'));
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'lib', 'supabaseServer.js'), `
    const S = globalThis.__gw;
    function chain(table) {
      const ops = [];
      const c = {};
      for (const m of ['select', 'eq', 'maybeSingle', 'single']) c[m] = (...a) => { ops.push([m, ...a]); return c; };
      c.then = (resolve) => { S.log.push({ from: table, ops }); return resolve(S.profile); };
      return c;
    }
    export const SUPABASE_URL = 'https://stub.supabase.co';
    export function supabaseAdmin() {
      return {
        from: (t) => chain(t),
        rpc: (name, args) => { S.log.push({ rpc: name, args }); return Promise.resolve(S.rpc[name] ?? { data: null, error: null }); },
      };
    }
  `);
  fs.writeFileSync(path.join(tmp, 'lib', 'langfuse.js'), `
    export async function logGroqGeneration(o) { globalThis.__gw.log.push({ langfuse: o }); }
  `);
  fs.copyFileSync(path.join(ROOT, 'lib', 'aiGateway.js'), path.join(tmp, 'lib', 'aiGateway.js'));
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  process.env.GROQ_API_KEY = 'groq-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    S.log.push({ fetch: u, init });
    if (u.includes('/auth/v1/user')) return S.auth;
    if (u.includes('api.groq.com')) return S.groq();
    throw new Error('unexpected fetch ' + u);
  };
  gw = await import(pathToFileURL(path.join(tmp, 'lib', 'aiGateway.js')).href);
});

after(() => {
  globalThis.fetch = realFetch;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.GROQ_API_KEY;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const allowedQuota = {
  allowed: true, reason: null, paused_until: null, org_used: 10, org_quota: 2000000, overage_mode: 'hard_stop',
  user_used: 10, user_limit: 200000, resets_day: '2026-09-17T18:30:00Z', resets_month: '2026-09-30T18:30:00Z',
};
const groqOk = () => new Response(JSON.stringify({
  choices: [{ message: { content: '{"score":80}' } }],
  usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
}), { status: 200 });

beforeEach(() => {
  S.log = [];
  S.auth = new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
  S.profile = { data: { id: 'user-1', org_id: 'org-1', role: 'member', status: 'active' }, error: null };
  S.rpc = {
    ai_bot_check: { data: [{ flagged: false, reason: null, paused_until: null }], error: null },
    ai_quota_check: { data: [allowedQuota], error: null },
    ai_record_usage: { data: null, error: null },
  };
  S.groq = groqOk;
});

const caller = () => gw.resolveCaller('user-jwt');
const messages = [{ role: 'user', content: 'score this resume' }];
const rpcs = (name) => S.log.filter(e => e.rpc === name);
const groqCalls = () => S.log.filter(e => e.fetch && e.fetch.includes('api.groq.com'));

describe('resolveCaller', () => {
  test('rejects a missing token without any request', async () => {
    const c = await gw.resolveCaller('');
    assert.deepEqual([c.ok, c.status], [false, 401]);
    assert.equal(S.log.length, 0);
  });

  test('rejects an invalid token and never reads users', async () => {
    S.auth = new Response('{}', { status: 401 });
    const c = await caller();
    assert.deepEqual([c.ok, c.status], [false, 401]);
    assert.equal(S.log.some(e => e.from === 'users'), false);
  });

  test('validates the token with the service key as apikey', async () => {
    await caller();
    const auth = S.log.find(e => e.fetch && e.fetch.includes('/auth/v1/user'));
    assert.equal(auth.init.headers.Authorization, 'Bearer user-jwt');
    assert.equal(auth.init.headers.apikey, 'service-key');
  });

  test('refuses a user without an organisation', async () => {
    S.profile = { data: { id: 'user-1', org_id: null, role: 'member', status: 'active' }, error: null };
    const c = await caller();
    assert.deepEqual([c.ok, c.status], [false, 403]);
  });

  test('refuses an exited user', async () => {
    S.profile = { data: { id: 'user-1', org_id: 'org-1', role: 'member', status: 'exited' }, error: null };
    const c = await caller();
    assert.deepEqual([c.ok, c.status], [false, 403]);
  });

  test('returns 503 when the account cannot be loaded', async () => {
    S.profile = { data: null, error: { message: 'db down' } };
    const c = await caller();
    assert.deepEqual([c.ok, c.status], [false, 503]);
  });

  test('returns the caller with org, role and a database client', async () => {
    const c = await caller();
    assert.equal(c.ok, true);
    assert.deepEqual([c.userId, c.orgId, c.role], ['user-1', 'org-1', 'member']);
    assert.equal(typeof c.db.rpc, 'function');
  });
});

describe('runAI', () => {
  test('a successful call checks, calls Groq, records exact usage and traces, in that order', async () => {
    const c = await caller();
    S.log = [];
    const r = await gw.runAI({ caller: c, feature: 'match', messages, maxTokens: 600, temperature: 0.2, metadata: { application_id: 'app-1' } });
    assert.deepEqual(r, { ok: true, text: '{"score":80}', usage: { prompt: 120, completion: 30, total: 150 } });

    const order = S.log.map(e => e.rpc || (e.fetch ? 'groq' : e.langfuse ? 'langfuse' : e.from));
    assert.deepEqual(order, ['ai_bot_check', 'ai_quota_check', 'groq', 'ai_record_usage', 'langfuse']);

    const hash = crypto.createHash('sha256').update('match' + JSON.stringify(messages)).digest('hex');
    assert.deepEqual(rpcs('ai_bot_check')[0].args, { p_org_id: 'org-1', p_user_id: 'user-1', p_feature: 'match', p_request_hash: hash });
    assert.deepEqual(rpcs('ai_quota_check')[0].args, { p_org_id: 'org-1', p_user_id: 'user-1' });
    assert.deepEqual(rpcs('ai_record_usage')[0].args, {
      p_org_id: 'org-1', p_user_id: 'user-1', p_feature: 'match', p_model: 'openai/gpt-oss-120b',
      p_prompt: 120, p_completion: 30, p_outcome: 'ok', p_block_reason: null, p_request_hash: hash,
    });

    const body = JSON.parse(groqCalls()[0].init.body);
    assert.deepEqual(body, { model: 'openai/gpt-oss-120b', messages, temperature: 0.2, max_tokens: 600, reasoning_effort: 'low' });
    assert.equal(groqCalls()[0].init.headers.Authorization, 'Bearer groq-key');

    const trace = S.log.find(e => e.langfuse).langfuse;
    assert.equal(trace.name, 'match');
    assert.equal(trace.model, 'openai/gpt-oss-120b');
    assert.deepEqual(trace.input, messages);
    assert.equal(trace.output, '{"score":80}');
    assert.equal(trace.userId, 'user-1');
    assert.deepEqual(trace.metadata, { org_id: 'org-1', feature: 'match', application_id: 'app-1' });
  });

  test('a flagged bot check blocks with 429, records a blocked row and never checks quota or calls Groq', async () => {
    S.rpc.ai_bot_check = { data: [{ flagged: true, reason: 'call_rate', paused_until: '2026-09-17T16:10:00Z' }], error: null };
    const c = await caller();
    const r = await gw.runAI({ caller: c, feature: 'screen', messages, maxTokens: 600 });
    assert.equal(r.status, 429);
    assert.deepEqual(r.body, {
      error: 'AI is paused for 10 minutes because of unusual activity. Your admin has been notified.',
      reason: 'paused_bot_check', quota: { paused_until: '2026-09-17T16:10:00Z' },
    });
    assert.equal(rpcs('ai_quota_check').length, 0);
    assert.equal(groqCalls().length, 0);
    const rec = rpcs('ai_record_usage')[0].args;
    assert.deepEqual([rec.p_outcome, rec.p_block_reason, rec.p_prompt, rec.p_completion], ['blocked', 'paused_bot_check', 0, 0]);
    assert.equal(typeof rec.p_request_hash, 'string');
  });

  for (const [reason, message] of [
    ['user_day_exhausted', "You've used today's AI limit. It resets at midnight."],
    ['org_month_exhausted', "Your organisation's monthly AI quota is used up. It resets on the 1st."],
    ['paused_bot_check', 'AI is paused for 10 minutes because of unusual activity. Your admin has been notified.'],
  ]) {
    test(`quota reason ${reason} blocks with 429 and the exact message`, async () => {
      S.rpc.ai_quota_check = { data: [{ ...allowedQuota, allowed: false, reason, user_used: 200000 }], error: null };
      const c = await caller();
      const r = await gw.runAI({ caller: c, feature: 'candidate_extract', messages, maxTokens: 300 });
      assert.equal(r.status, 429);
      assert.equal(r.body.error, message);
      assert.equal(r.body.reason, reason);
      assert.deepEqual(r.body.quota, {
        user_used: 200000, user_limit: 200000, org_used: 10, org_quota: 2000000,
        resets_day: allowedQuota.resets_day, resets_month: allowedQuota.resets_month, paused_until: null,
      });
      assert.equal(groqCalls().length, 0);
      assert.deepEqual([rpcs('ai_record_usage')[0].args.p_outcome, rpcs('ai_record_usage')[0].args.p_block_reason], ['blocked', reason]);
    });
  }

  test('fails closed with 503 when the bot check errors', async () => {
    S.rpc.ai_bot_check = { data: null, error: { message: 'db down' } };
    const c = await caller();
    const r = await gw.runAI({ caller: c, feature: 'match', messages, maxTokens: 600 });
    assert.equal(r.status, 503);
    assert.equal(groqCalls().length, 0);
  });

  test('fails closed with 503 when the quota check errors or returns no row', async () => {
    const c = await caller();
    S.rpc.ai_quota_check = { data: null, error: { message: 'db down' } };
    assert.equal((await gw.runAI({ caller: c, feature: 'match', messages, maxTokens: 600 })).status, 503);
    S.rpc.ai_quota_check = { data: [], error: null };
    assert.equal((await gw.runAI({ caller: c, feature: 'match', messages, maxTokens: 600 })).status, 503);
    assert.equal(groqCalls().length, 0);
  });

  test('a Groq failure returns 502 and records an error row with no tokens and no request hash', async () => {
    S.groq = () => new Response('upstream boom', { status: 500 });
    const c = await caller();
    const r = await gw.runAI({ caller: c, feature: 'jd_parse', messages, maxTokens: 1024 });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'AI request failed — please try again');
    const rec = rpcs('ai_record_usage')[0].args;
    assert.deepEqual([rec.p_outcome, rec.p_prompt, rec.p_completion, rec.p_block_reason, rec.p_request_hash], ['error', 0, 0, null, null]);
  });

  test('a network error reaching Groq is handled like a Groq failure', async () => {
    S.groq = () => { throw new Error('ECONNRESET'); };
    const c = await caller();
    const r = await gw.runAI({ caller: c, feature: 'match', messages, maxTokens: 600 });
    assert.equal(r.status, 502);
    assert.equal(rpcs('ai_record_usage')[0].args.p_outcome, 'error');
  });

  test('a failed usage record is logged but the result is still returned', async (t) => {
    S.rpc.ai_record_usage = { data: null, error: { message: 'insert failed' } };
    const errors = t.mock.method(console, 'error', () => {});
    const c = await caller();
    const r = await gw.runAI({ caller: c, feature: 'match', messages, maxTokens: 600 });
    assert.equal(r.ok, true);
    assert.equal(errors.mock.calls[0].arguments[0], 'ai_record_usage failed:');
  });

  test('the request hash differs by feature and by messages', async () => {
    const c = await caller();
    await gw.runAI({ caller: c, feature: 'match', messages, maxTokens: 600 });
    await gw.runAI({ caller: c, feature: 'screen', messages, maxTokens: 600 });
    await gw.runAI({ caller: c, feature: 'match', messages: [{ role: 'user', content: 'other' }], maxTokens: 600 });
    const hashes = rpcs('ai_bot_check').map(e => e.args.p_request_hash);
    assert.equal(new Set(hashes).size, 3);
  });
});
