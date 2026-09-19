// public/js/version.js turns /version.json into the label shown in the account menu.
// A missing or odd file must hide the label, never break the page.
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVersionLabel } from '../public/js/version.js';

const json = (body, status = 200) => async (url, init) => {
  json.last = { url, init };
  return new Response(JSON.stringify(body), { status });
};

test('formats the deployed version', async () => {
  assert.equal(await loadVersionLabel(json({ version: '1.2.3' })), 'Atllanta v1.2.3');
});

test('asks for /version.json without using the cache', async () => {
  await loadVersionLabel(json({ version: '1.2.3' }));
  assert.equal(json.last.url, '/version.json');
  assert.equal(json.last.init.cache, 'no-store');
});

test('returns an empty label when the file is missing', async () => {
  assert.equal(await loadVersionLabel(json({}, 404)), '');
});

test('returns an empty label when the version is malformed', async () => {
  assert.equal(await loadVersionLabel(json({ version: '<b>1</b>' })), '');
});

test('returns an empty label when the request fails', async () => {
  assert.equal(await loadVersionLabel(async () => { throw new Error('offline'); }), '');
});
