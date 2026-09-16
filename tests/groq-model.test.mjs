// Groq shut down llama-3.3-70b-versatile on 2026-08-16; every call to it
// fails. Guard against it coming back through a merge.  Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RETIRED = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const REPLACEMENT = 'openai/gpt-oss-120b';

function sources(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return sources(rel);
    return /\.(js|mjs|ts)$/.test(e.name) ? [rel] : [];
  });
}

test('no source file uses a retired Groq model', () => {
  const hits = [];
  for (const file of [...sources('api'), ...sources('js'), ...sources('lib')]) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const model of RETIRED) if (text.includes(model)) hits.push(`${file}: ${model}`);
  }
  assert.deepEqual(hits, []);
});

test('every Groq caller names the replacement model', () => {
  const callers = ['api/ai-query.js', 'api/extract-candidate.js', 'api/match.js', 'api/parse-resume.js', 'api/screen-job.js', 'js/ai.js'];
  for (const file of callers) {
    assert.ok(fs.readFileSync(path.join(ROOT, file), 'utf8').includes(REPLACEMENT), `${file} should use ${REPLACEMENT}`);
  }
});
