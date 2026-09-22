// Every release carries one version number in four places; they must agree,
// and version.json must never be cached, or users would see a stale version.
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SEMVER = /^\d+\.\d+\.\d+$/;

test('VERSION is MAJOR.MINOR.PATCH', () => {
  assert.match(read('VERSION').trim(), SEMVER);
});

test('package.json and version.json carry the same version as VERSION', () => {
  const v = read('VERSION').trim();
  assert.equal(JSON.parse(read('package.json')).version, v);
  assert.deepEqual(JSON.parse(read('public/version.json')), { version: v });
});

test('CHANGELOG.md starts with the entry for VERSION', () => {
  const v = read('VERSION').trim();
  const first = read('CHANGELOG.md').match(/^## v(\d+\.\d+\.\d+) — \d{4}-\d{2}-\d{2}$/m);
  assert.ok(first, 'CHANGELOG.md needs a "## vX.Y.Z — YYYY-MM-DD" heading');
  assert.equal(first[1], v);
});

test('version.json is served with no-store', () => {
  const cfg = JSON.parse(read('vercel.json'));
  const rule = cfg.headers.find((h) => h.source === '/version.json');
  assert.ok(rule, 'vercel.json needs a headers rule for /version.json');
  assert.deepEqual(rule.headers, [{ key: 'Cache-Control', value: 'no-store' }]);
});
