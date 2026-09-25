// /health is public, and getDb() connects as a role that bypasses RLS, so any
// count it shows is platform-wide. It showed organisation and user counts to
// anyone until v1.3.1; it now reports only whether the database is reachable.
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const page = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../app/(health)/health/page.tsx'),
  'utf8'
);

test('/health reads no table and counts nothing', () => {
  assert.equal(/\bcount\s*\(/.test(page), false, 'no count() on the public health page');
  assert.equal(/from\s*\(\s*(organizations|users)\b/.test(page), false, 'no table reads');
  assert.equal(/db\/schema/.test(page), false, 'the page should not need the schema at all');
});

test('/health still checks the database', () => {
  assert.ok(page.includes('select 1'));
});
