// lib/langfuse.js must send one trace per AI call when keys are set, stay
// silent without keys, and never throw — tracing must not break AI requests.
// Run: node --test tests/

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let tmp, realFetch, sent;
let copies = 0;

// Import a fresh copy so the module reads the environment set for that test.
async function load(env) {
  for (const k of ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'LANGFUSE_HOST']) delete process.env[k];
  Object.assign(process.env, env);
  const file = path.join(tmp, `langfuse-${++copies}.js`);
  fs.copyFileSync(path.join(ROOT, 'lib', 'langfuse.js'), file);
  return import(pathToFileURL(file).href);
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-langfuse-'));
  realFetch = globalThis.fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  for (const k of ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'LANGFUSE_HOST']) delete process.env[k];
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init }); return new Response('{}', { status: 207 }); };
});

describe('langfuse', () => {
  test('does nothing without keys', async () => {
    const lf = await load({});
    assert.equal(lf.langfuseEnabled(), false);
    await lf.logGroqGeneration({ name: 'match', model: 'openai/gpt-oss-120b', input: [], output: '' });
    assert.equal(sent.length, 0);
  });

  test('sends a trace and a generation with basic auth when keys are set', async () => {
    const lf = await load({ LANGFUSE_PUBLIC_KEY: 'pk-test', LANGFUSE_SECRET_KEY: 'sk-test' });
    assert.equal(lf.langfuseEnabled(), true);
    await lf.logGroqGeneration({
      name: 'screen', model: 'openai/gpt-oss-120b', input: [{ role: 'user', content: 'resume' }], output: '{"score":80}',
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, userId: 'u-1',
      metadata: { org_id: 'org-1', feature: 'screen' },
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://cloud.langfuse.com/api/public/ingestion');
    assert.equal(sent[0].init.headers.Authorization, 'Basic ' + Buffer.from('pk-test:sk-test').toString('base64'));
    const batch = JSON.parse(sent[0].init.body).batch;
    assert.deepEqual(batch.map(e => e.type), ['trace-create', 'generation-create']);
    assert.deepEqual(batch[1].body.usage, { input: 100, output: 20, total: 120, unit: 'TOKENS' });
    assert.deepEqual(batch[1].body.metadata, { org_id: 'org-1', feature: 'screen' });
    assert.equal(batch[0].body.userId, 'u-1');
  });

  test('never throws when Langfuse is down', async (t) => {
    const lf = await load({ LANGFUSE_PUBLIC_KEY: 'pk-test', LANGFUSE_SECRET_KEY: 'sk-test' });
    globalThis.fetch = async () => { throw new Error('down'); };
    t.mock.method(console, 'error', () => {});
    await assert.doesNotReject(lf.logGroqGeneration({ name: 'match', model: 'm', input: [], output: '' }));
  });
});
