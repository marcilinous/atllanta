// public/sw.js must fetch /version.json from the network (never Cache Storage), and
// its cache name must follow the release version so each release purges old
// caches.  Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');

// Load sw.js in a sandbox with a fake service-worker global, and return a
// function that dispatches one fetch event and reports what happened.
function loadWorker() {
  const handlers = {};
  const log = { cacheMatch: [], network: [] };
  const sandbox = {
    self: {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting() {},
      clients: { claim() {} },
    },
    caches: {
      match: async (req) => { log.cacheMatch.push(req.url); return new Response('cached', { status: 200 }); },
      open: async () => ({ put: async () => {}, addAll: async () => {} }),
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async (req) => { log.network.push(req.url); return new Response('network', { status: 200 }); },
    Response,
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  async function dispatch(url, headers) {
    let responded = null;
    handlers.fetch({ request: { url, method: 'GET', headers }, respondWith: (p) => { responded = p; } });
    return { response: responded ? await responded : null, log };
  }
  return { dispatch, sandbox };
}

test('/version.json always comes from the network', async () => {
  const { dispatch } = loadWorker();
  const { response, log } = await dispatch('https://atllanta.vercel.app/version.json');
  assert.equal(await response.text(), 'network');
  assert.deepEqual(log.cacheMatch, []);
  assert.deepEqual(log.network, ['https://atllanta.vercel.app/version.json']);
});

test('/version.json offline gives a 503, not a cached copy', async () => {
  const { dispatch, sandbox } = loadWorker();
  sandbox.fetch = async () => { throw new Error('offline'); };
  const { response, log } = await dispatch('https://atllanta.vercel.app/version.json');
  assert.equal(response.status, 503);
  assert.deepEqual(log.cacheMatch, []);
});

test('other static files still use the cache', async () => {
  const { dispatch } = loadWorker();
  const { log } = await dispatch('https://atllanta.vercel.app/css/base.css');
  assert.deepEqual(log.cacheMatch, ['https://atllanta.vercel.app/css/base.css']);
});

// v1.4.0: new-stack (App Router) pages are per-user and must never be served
// from Cache Storage — neither the page nor the RSC payload router.refresh()
// fetches. The worker must not call respondWith at all for them.
for (const url of [
  'https://atllanta.vercel.app/settings',
  'https://atllanta.vercel.app/settings/modules',
  'https://atllanta.vercel.app/settings/roles/7b0e6c1e-0000-4000-8000-000000000000',
  'https://atllanta.vercel.app/session',
  'https://atllanta.vercel.app/auth/confirm?token_hash=x&type=recovery',
  'https://atllanta.vercel.app/health',
]) {
  test(`new-stack page bypasses the worker: ${new URL(url).pathname}`, async () => {
    const { dispatch } = loadWorker();
    const { response, log } = await dispatch(url);
    assert.equal(response, null);
    assert.deepEqual(log.cacheMatch, []);
  });
}

test('an RSC request bypasses the worker wherever it points', async () => {
  const { dispatch } = loadWorker();
  const { response, log } = await dispatch('https://atllanta.vercel.app/?_rsc=abc', new Headers({ RSC: '1' }));
  assert.equal(response, null);
  assert.deepEqual(log.cacheMatch, []);
});

test('a path that merely starts with a new-stack word is still cached', async () => {
  const { dispatch } = loadWorker();
  const { log } = await dispatch('https://atllanta.vercel.app/settings.css');
  assert.deepEqual(log.cacheMatch, ['https://atllanta.vercel.app/settings.css']);
});

test('the cache name follows VERSION', () => {
  const version = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
  assert.match(SOURCE, new RegExp(`const CACHE_NAME = "atllanta-${version.replace(/\./g, '\\.')}";`));
});
