// Groq may only be called from lib/aiGateway.js, with the current model and a
// low reasoning budget. Retired models must never come back.
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RETIRED = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

function sources(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e => {
    const rel = path.join(dir, e.name).replace(/\\/g, '/');
    if (e.isDirectory()) return sources(rel);
    return /\.(js|mjs|ts)$/.test(e.name) ? [rel] : [];
  });
}
const all = () => [...sources('api'), ...sources('js'), ...sources('lib'), ...sources('views')];

test('no source file uses a retired Groq model', () => {
  const hits = [];
  for (const file of all()) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const model of RETIRED) if (text.includes(model)) hits.push(`${file}: ${model}`);
  }
  assert.deepEqual(hits, []);
});

test('only lib/aiGateway.js calls Groq', () => {
  const callers = all().filter(f => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('api.groq.com'));
  assert.deepEqual(callers, ['lib/aiGateway.js']);
});

test('the gateway uses gpt-oss-120b with a low reasoning budget', () => {
  const text = fs.readFileSync(path.join(ROOT, 'lib/aiGateway.js'), 'utf8');
  assert.ok(text.includes('export const GROQ_MODEL = "openai/gpt-oss-120b";'));
  assert.ok(text.includes('reasoning_effort: "low"'));
});
