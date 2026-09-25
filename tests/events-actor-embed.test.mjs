// public.events.actor_id is a plain UUID with no foreign key, so PostgREST
// cannot resolve `actor:actor_id(...)` embeds on it — any such query returns
// HTTP 400. Actor names must be resolved with a separate lookup against
// public.users instead.  Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

test('no public asset embeds actor:actor_id(...) — events.actor_id has no FK, so PostgREST 400s on it', () => {
  const files = walk(path.join(ROOT, 'public'));
  assert.ok(files.length > 0, 'expected to find files under public/');
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      content,
      /actor:actor_id\s*\(/,
      `${path.relative(ROOT, file)} embeds actor:actor_id(...), which PostgREST rejects with HTTP 400`
    );
  }
});

test('dashboard.js selects plain columns from events, not an actor embed', () => {
  const src = read('public/views/dashboard.js');
  assert.match(src, /sb\.from\('events'\)\.select\('\*'\)/);
  assert.doesNotMatch(src, /actor:actor_id\s*\(/);
});

test('letters.js no longer embeds actor:actor_id on the generated-letters query', () => {
  const src = read('public/views/people/letters.js');
  assert.doesNotMatch(src, /actor:actor_id\s*\(/);
});
