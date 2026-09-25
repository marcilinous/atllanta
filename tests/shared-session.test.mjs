// Phase 2 item 1: the legacy app and the Next.js stack share one session,
// stored in cookies by public/js/supabase.js. Any page that builds its own
// supabase-js client keeps a second session in localStorage that no other page
// can see — public/login.html did exactly that until 2026-09-24, which would
// have bounced every sign-in between /login and /.
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');
const sharedClient = path.join(publicDir, 'js', 'supabase.js');

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(html|js)$/.test(entry.name) ? [full] : [];
  });
}

test('only public/js/supabase.js creates a Supabase client', () => {
  const offenders = sources(publicDir)
    .filter((file) => file !== sharedClient)
    .filter((file) => /createClient\(|createBrowserClient\(|supabase-js@/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(publicDir, file));
  assert.deepEqual(offenders, []);
});
