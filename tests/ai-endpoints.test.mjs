// The recruitment AI endpoints must go through the gateway with the right
// feature label, pass gateway refusals straight through, check job ownership
// before any AI call, and never touch credits.  Run: node --test tests/

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = globalThis.__ep = {};
let tmp;
const handlers = {};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-ep-'));
  fs.mkdirSync(path.join(tmp, 'api'));
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'lib', 'supabaseServer.js'), `
    const S = globalThis.__ep;
    function chain(table) {
      const ops = [];
      const c = {};
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'single', 'maybeSingle', 'update', 'insert', 'upsert']) {
        c[m] = (...a) => { ops.push([m, ...a]); return c; };
      }
      c.then = (resolve) => {
        S.db.push({ table, ops });
        const t = S.tables[table];
        return resolve(typeof t === 'function' ? t(ops) : (t ?? { data: null, error: null }));
      };
      return c;
    }
    export const SUPABASE_URL = 'https://stub.supabase.co';
    export function supabaseAdmin() { return { from: (t) => chain(t) }; }
  `);
  fs.writeFileSync(path.join(tmp, 'lib', 'aiGateway.js'), `
    import { supabaseAdmin } from './supabaseServer.js';
    const S = globalThis.__ep;
    export async function resolveCaller(token) {
      S.resolved.push(token);
      return S.caller.ok ? { ...S.caller, db: supabaseAdmin() } : S.caller;
    }
    export async function runAI(args) {
      S.ai.push(args);
      const next = S.aiResults.shift();
      return next ?? { ok: true, text: '{}', usage: { prompt: 0, completion: 0, total: 0 } };
    }
  `);
  for (const f of ['extract-candidate', 'parse-resume', 'match', 'screen-job']) {
    fs.copyFileSync(path.join(ROOT, 'api', `${f}.js`), path.join(tmp, 'api', `${f}.js`));
    handlers[f] = (await import(pathToFileURL(path.join(tmp, 'api', `${f}.js`)).href)).default;
  }
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  process.env.GROQ_API_KEY = 'groq-key';
});

after(() => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.GROQ_API_KEY;
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  S.resolved = [];
  S.ai = [];
  S.aiResults = [];
  S.db = [];
  S.tables = {};
  S.caller = { ok: true, userId: 'user-1', orgId: 'org-1', role: 'admin' };
});

function res() {
  return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const post = (body, query = {}) => ({ method: 'POST', headers: { authorization: 'Bearer user-jwt' }, body, query });
const ok = (text, total = 150) => ({ ok: true, text, usage: { prompt: total - 50, completion: 50, total } });
const limited = { ok: false, status: 429, body: { error: "You've used today's AI limit. It resets at midnight.", reason: 'user_day_exhausted', quota: {} } };
const creditTouched = () => S.db.some(e => e.table === 'credit_ledger' || e.table === 'organizations');

describe('extract-candidate', () => {
  test('passes an auth failure through without calling AI', async () => {
    S.caller = { ok: false, status: 401, error: 'Missing auth token' };
    const r = res(); await handlers['extract-candidate'](post({ resume_text: 'x' }), r);
    assert.deepEqual([r.statusCode, r.body], [401, { error: 'Missing auth token' }]);
    assert.equal(S.ai.length, 0);
  });

  test('extracts through the gateway as candidate_extract', async () => {
    S.aiResults = [ok('{"name":"Asha Rao","email":"asha@example.com","phone":null,"summary":"Java developer"}')];
    const r = res(); await handlers['extract-candidate'](post({ resume_text: 'Asha Rao resume' }), r);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body, { name: 'Asha Rao', email: 'asha@example.com', phone: null, summary: 'Java developer' });
    assert.deepEqual([S.ai[0].feature, S.ai[0].maxTokens, S.ai[0].temperature], ['candidate_extract', 300, 0.1]);
    assert.equal(S.ai[0].caller.orgId, 'org-1');
  });

  test('passes a quota refusal through with its status and body', async () => {
    S.aiResults = [limited];
    const r = res(); await handlers['extract-candidate'](post({ resume_text: 'x' }), r);
    assert.deepEqual([r.statusCode, r.body], [429, limited.body]);
  });
});

describe('parse-resume parse-jd', () => {
  test('refuses a job in another organisation before any AI call', async () => {
    S.tables.jobs = { data: { id: 'job-9', org_id: 'org-2' }, error: null };
    const r = res(); await handlers['parse-resume'](post({ description: 'Senior Java', job_id: 'job-9' }, { action: 'parse-jd' }), r);
    assert.equal(r.statusCode, 403);
    assert.equal(S.ai.length, 0);
    assert.equal(S.db.some(e => e.table === 'jobs' && e.ops[0][0] === 'update'), false);
  });

  test('parses through the gateway as jd_parse and saves skills on an own-org job', async () => {
    S.tables.jobs = (ops) => ops[0][0] === 'select' ? { data: { id: 'job-1', org_id: 'org-1' }, error: null } : { data: null, error: null };
    S.aiResults = [ok('{"must_have":["Java"],"nice_to_have":[],"experience_min":2,"experience_max":5,"education":[]}')];
    const r = res(); await handlers['parse-resume'](post({ description: 'Senior Java', job_id: 'job-1' }, { action: 'parse-jd' }), r);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body.parsed_skills.must_have, ['Java']);
    assert.deepEqual([S.ai[0].feature, S.ai[0].maxTokens], ['jd_parse', 1024]);
    assert.ok(S.db.some(e => e.table === 'jobs' && e.ops[0][0] === 'update'));
  });

  test('a file upload with no file still needs a valid caller and never calls AI', async () => {
    const r = res(); await handlers['parse-resume'](post({}), r);
    assert.equal(r.statusCode, 400);
    assert.deepEqual(S.resolved, ['user-jwt']);
    assert.equal(S.ai.length, 0);
  });
});

describe('match', () => {
  const tables = () => {
    S.tables.job_applications = (ops) => ops[0][0] === 'update' ? { data: null, error: null } : { data: { id: 'app-1', job_id: 'job-1', candidate_id: 'cand-1' }, error: null };
    S.tables.jobs = { data: { id: 'job-1', title: 'Java Dev', jd_raw_text: 'Java JD', description: null, org_id: 'org-1' }, error: null };
    S.tables.candidates = { data: { id: 'cand-1', full_name: 'Asha', name: null, resume_text: 'Java resume', resume_raw_text: null, org_id: 'org-1' }, error: null };
  };

  test('scores through the gateway as match, reports tokens and never touches credits', async () => {
    tables();
    S.aiResults = [ok('{"score":82,"summary":"Strong","strengths":["Java"],"gaps":[]}', 700)];
    const r = res(); await handlers.match(post({ application_id: 'app-1' }), r);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body, { application_id: 'app-1', score: 82, summary: 'Strong', strengths: ['Java'], gaps: [], tokens_used: 700 });
    assert.deepEqual([S.ai[0].feature, S.ai[0].maxTokens], ['match', 600]);
    assert.equal(creditTouched(), false);
  });

  test('refuses another organisation\'s job before creating an application or calling AI', async () => {
    tables();
    S.tables.jobs = { data: { id: 'job-9', title: 'X', jd_raw_text: 'JD', org_id: 'org-2' }, error: null };
    const r = res(); await handlers.match(post({ job_id: 'job-9', candidate_id: 'cand-1' }), r);
    assert.equal(r.statusCode, 403);
    assert.equal(S.ai.length, 0);
    assert.equal(S.db.some(e => e.table === 'job_applications' && e.ops[0][0] === 'upsert'), false);
  });

  test('refuses another organisation\'s candidate before creating an application or calling AI', async () => {
    tables();
    S.tables.candidates = { data: { id: 'cand-9', full_name: 'Other', resume_text: 'Other resume', org_id: 'org-2' }, error: null };
    const r = res(); await handlers.match(post({ job_id: 'job-1', candidate_id: 'cand-9' }), r);
    assert.deepEqual([r.statusCode, r.body], [403, { error: 'No access to this candidate' }]);
    assert.equal(S.ai.length, 0);
    assert.equal(S.db.some(e => e.table === 'job_applications' && e.ops[0][0] === 'upsert'), false);
  });

  test('passes a quota refusal through and saves nothing', async () => {
    tables();
    S.aiResults = [limited];
    const r = res(); await handlers.match(post({ application_id: 'app-1' }), r);
    assert.deepEqual([r.statusCode, r.body], [429, limited.body]);
    assert.equal(S.db.some(e => e.table === 'job_applications' && e.ops[0][0] === 'update'), false);
  });

  test('a job load error surfaces as 503 rather than a false 404/403', async () => {
    tables();
    S.tables.jobs = { data: null, error: { message: 'connection reset' } };
    const r = res(); await handlers.match(post({ application_id: 'app-1' }), r);
    assert.deepEqual([r.statusCode, r.body], [503, { error: 'Could not load data — please try again' }]);
    assert.equal(S.ai.length, 0);
  });

  test('an update error while saving the match is reported, not leaked', async () => {
    tables();
    S.tables.job_applications = (ops) => ops[0][0] === 'update'
      ? { data: null, error: { message: 'connection reset' } }
      : { data: { id: 'app-1', job_id: 'job-1', candidate_id: 'cand-1' }, error: null };
    S.aiResults = [ok('{"score":82,"summary":"Strong","strengths":["Java"],"gaps":[]}', 700)];
    const r = res(); await handlers.match(post({ application_id: 'app-1' }), r);
    assert.deepEqual([r.statusCode, r.body], [500, { error: 'Could not save the match — please try again' }]);
  });
});

describe('screen-job', () => {
  const setup = (n) => {
    S.tables.jobs = { data: { id: 'job-1', title: 'Java Dev', jd_raw_text: 'Java JD', description: null, org_id: 'org-1' }, error: null };
    const apps = Array.from({ length: n }, (_, i) => ({ id: `app-${i}`, candidate_id: `cand-${i}`, match_score: null }));
    S.tables.job_applications = (ops) => ops[0][0] === 'update' ? { data: null, error: null } : { data: apps, error: null };
    S.tables.candidates = { data: apps.map((a, i) => ({ id: a.candidate_id, full_name: `Cand ${i}`, resume_text: `resume ${i}` })), error: null };
  };

  test('screens each candidate through the gateway and sums tokens without credits', async () => {
    setup(2);
    S.aiResults = [ok('{"score":70,"summary":"a"}', 500), ok('{"score":60,"summary":"b"}', 400)];
    const r = res(); await handlers['screen-job'](post({ job_id: 'job-1', method: 'ai', mode: 'unscored' }), r);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body.results.map(x => x.score), [70, 60]);
    assert.deepEqual([r.body.tokens_used, r.body.processed, r.body.remaining, r.body.method], [900, 2, 0, 'ai']);
    assert.deepEqual(S.ai.map(a => a.feature), ['screen', 'screen']);
    assert.notEqual(JSON.stringify(S.ai[0].messages), JSON.stringify(S.ai[1].messages));
    assert.equal(creditTouched(), false);
    const candOp = S.db.find(e => e.table === 'candidates');
    assert.ok(candOp.ops.some(op => op[0] === 'eq' && op[1] === 'org_id' && op[2] === 'org-1'));
  });

  test('an update error while saving a score is reported per-candidate, and tokens already spent still count', async () => {
    setup(1);
    S.tables.job_applications = (ops) => ops[0][0] === 'update'
      ? { data: null, error: { message: 'connection reset' } }
      : { data: [{ id: 'app-0', candidate_id: 'cand-0', match_score: null }], error: null };
    S.aiResults = [ok('{"score":70,"summary":"a"}', 500)];
    const r = res(); await handlers['screen-job'](post({ job_id: 'job-1', method: 'ai' }), r);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body.results[0], { application_id: 'app-0', candidate_name: 'Cand 0', score: null, error: 'Could not save the score' });
    assert.equal(r.body.tokens_used, 500);
  });

  test('stops calling AI after the first quota refusal and marks the rest', async () => {
    setup(3);
    S.aiResults = [ok('{"score":70,"summary":"a"}', 500), limited];
    const r = res(); await handlers['screen-job'](post({ job_id: 'job-1', method: 'ai' }), r);
    assert.equal(S.ai.length, 2);
    assert.equal(r.body.results[0].score, 70);
    assert.deepEqual(r.body.results.slice(1).map(x => x.error), [limited.body.error, limited.body.error]);
    assert.equal(r.body.tokens_used, 500);
  });

  test('handles at most 50 candidates per request and reports the remainder', async () => {
    setup(60);
    const r = res(); await handlers['screen-job'](post({ job_id: 'job-1', method: 'ai' }), r);
    assert.equal(S.ai.length, 50);
    assert.deepEqual([r.body.processed, r.body.remaining], [50, 10]);
  });

  test('candidates without resume text do not use up the 50-per-run cap', async () => {
    S.tables.jobs = { data: { id: 'job-1', title: 'Java Dev', jd_raw_text: 'Java JD', description: null, org_id: 'org-1' }, error: null };
    const noResume = Array.from({ length: 5 }, (_, i) => ({ id: `app-n${i}`, candidate_id: `cand-n${i}`, match_score: null }));
    const withResume = Array.from({ length: 50 }, (_, i) => ({ id: `app-r${i}`, candidate_id: `cand-r${i}`, match_score: null }));
    const apps = [...noResume, ...withResume];
    S.tables.job_applications = (ops) => ops[0][0] === 'update' ? { data: null, error: null } : { data: apps, error: null };
    S.tables.candidates = {
      data: [
        ...noResume.map((a, i) => ({ id: a.candidate_id, full_name: `NoResume ${i}`, resume_text: '' })),
        ...withResume.map((a, i) => ({ id: a.candidate_id, full_name: `Resume ${i}`, resume_text: `resume ${i}` })),
      ],
      error: null,
    };
    const r = res(); await handlers['screen-job'](post({ job_id: 'job-1', method: 'ai' }), r);
    assert.equal(S.ai.length, 50);
    assert.deepEqual([r.body.processed, r.body.remaining], [50, 0]);
    assert.equal(r.body.results.filter(x => x.error === 'No resume text').length, 5);
    assert.equal(r.body.results.filter(x => typeof x.score === 'number').length, 50);
  });

  test('keyword screening never calls AI', async () => {
    setup(2);
    const r = res(); await handlers['screen-job'](post({ job_id: 'job-1', method: 'python' }), r);
    assert.equal(r.statusCode, 200);
    assert.equal(S.ai.length, 0);
    assert.equal(r.body.method, 'python');
  });

  test('refuses another organisation\'s job', async () => {
    setup(1);
    S.tables.jobs = { data: { id: 'job-9', title: 'X', jd_raw_text: 'JD', org_id: 'org-2' }, error: null };
    const r = res(); await handlers['screen-job'](post({ job_id: 'job-9', method: 'ai' }), r);
    assert.equal(r.statusCode, 403);
    assert.equal(S.ai.length, 0);
  });
});
