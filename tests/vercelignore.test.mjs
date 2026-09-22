// .vercelignore keeps internal documents and test files out of every Vercel
// deployment (they were publicly downloadable from the site). It must never
// exclude anything the site or its functions need.  Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function entries() {
  return fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

// Normalise "/docs", "docs/", "/docs/", "./docs" to "docs".
const norm = (p) => p.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');

test('blocks internal documents, database files and tests', () => {
  const blocked = new Set(entries().map(norm));
  for (const p of ['docs', 'supabase', 'tests', 'playwright.config.js', 'CLAUDE.md', 'DESIGN.md', 'README.md', '.env.example', '.superpowers', 'TRANSITION.md']) {
    assert.ok(blocked.has(p), `.vercelignore should block ${p}`);
  }
});

test('never blocks what the site or its functions need', () => {
  const required = ['app', 'pages', 'public', 'server', 'lib', 'src',
    'public/js', 'public/css', 'public/views', 'public/index.html', 'public/login.html',
    'public/reset-password.html', 'public/privacy.html', 'public/terms.html', 'public/schedule.html',
    'public/sw.js', 'public/manifest.json', 'public/version.json', 'public/icon-192.svg', 'public/icon-512.svg',
    'server/legacy', 'VERSION', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'vercel.json',
    'next.config.mjs', 'tsconfig.json', 'postcss.config.mjs', 'next-env.d.ts'];
  for (const line of entries()) {
    const e = norm(line);
    assert.ok(!e.includes('*'), `wildcards are not allowed in .vercelignore (found "${line}"); list paths explicitly`);
    assert.ok(!line.startsWith('!'), `negations are not allowed in .vercelignore (found "${line}")`);
    for (const r of required) {
      assert.ok(e !== r && !r.startsWith(e + '/'), `.vercelignore must not block ${r} (entry "${line}")`);
    }
  }
});

test('every blocked path exists at the repo root or is a local-only folder', () => {
  for (const line of entries()) {
    const e = norm(line);
    if (e === '.superpowers') continue;
    assert.ok(fs.existsSync(path.join(ROOT, e)), `.vercelignore lists "${line}", which does not exist`);
  }
});
