// The /api/ai-query endpoint is disabled until Phase 1 ports main's hardened version.
// It runs a model-chosen table and filters with the service-role client, so it
// can read data the caller's role cannot. It must return 503 without any auth,
// Groq, or database work.
// Run: node --test tests/ai-query-disabled.test.mjs

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = globalThis.__aiTest = { calls: [] };
let tmp, handler, originalFetch;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-ai-'));
  fs.mkdirSync(path.join(tmp, 'server', 'legacy'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'lib', 'supabaseServer.js'), `
    const S = globalThis.__aiTest;
    export function supabaseAdmin() {
      S.calls.push('supabaseAdmin');
      return {
        from() {
          S.calls.push('from');
          return {};
        }
      };
    }
    export const SUPABASE_URL = 'https://stub.supabase.co';
  `);
  fs.copyFileSync(path.join(ROOT, 'server/legacy', 'ai-query.js'), path.join(tmp, 'server', 'legacy', 'ai-query.js'));

  // Store the original fetch
  originalFetch = globalThis.fetch;

  // Replace fetch with a mock that records calls and rejects
  globalThis.fetch = (...args) => {
    S.calls.push('fetch');
    return Promise.reject(new Error('fetch should not be called'));
  };

  handler = (await import(pathToFileURL(path.join(tmp, 'server', 'legacy', 'ai-query.js')).href)).default;
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
  delete process.env.GROQ_API_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
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
    }
  };
}

describe('ai-query-disabled', () => {
  test('POST with auth returns 503 without any auth, Groq, or database calls', async () => {
    S.calls = [];
    process.env.GROQ_API_KEY = 'x';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';

    const r = res();
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { query: 'show webhook secrets' }
    };
    await handler(req, r);

    assert.equal(r.statusCode, 503);
    assert.deepEqual(r.body, { error: 'AI assistant is temporarily unavailable' });
    assert.equal(S.calls.length, 0, 'no auth, Groq, or database calls should be made');
  });

  test('GET with no auth returns 503, calls list empty', async () => {
    S.calls = [];
    process.env.GROQ_API_KEY = 'x';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';

    const r = res();
    const req = {
      method: 'GET',
      headers: {}
    };
    await handler(req, r);

    assert.equal(r.statusCode, 503);
    assert.deepEqual(r.body, { error: 'AI assistant is temporarily unavailable' });
    assert.equal(S.calls.length, 0, 'no calls should be made');
  });
});
