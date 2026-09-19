// The bulk resume upload loop (public/views/recruitment/jobs.js) parses each file for
// free via /api/parse-resume, then spends an AI call on /api/extract-candidate.
// A 502 (Groq outage) or 503 (usage check unavailable) used to fall through the
// old `quotaHit` flag, which only latched on 429 — so a large upload during an
// outage fired one failing AI call per remaining file. Those failures are
// counted by the database bot check's calls-per-minute rule, which can pause
// the org's AI for 10 minutes and page owners/admins as a false alarm.
//
// The fix stops AI extraction for the rest of the batch on ANY non-OK gateway
// reply, not just 429. This is browser code with no DOM/fetch test harness, so
// these are source-level guards, matching the style of tests/groq-model.test.mjs.
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public/views/recruitment/jobs.js'), 'utf8');

// Isolate the bulk upload loop so assertions can't accidentally match
// unrelated code elsewhere in the file.
function uploadLoopBody() {
  const start = SOURCE.indexOf("startBtn.addEventListener('click'");
  assert.ok(start !== -1, 'could not find the bulk upload click handler');
  const end = SOURCE.indexOf('\n    });', start);
  assert.ok(end !== -1, 'could not find the end of the bulk upload click handler');
  return SOURCE.slice(start, end);
}

test('the upload loop does not gate the stop flag on 429 alone', () => {
  const loop = uploadLoopBody();
  // A regression back to `if (extractResp.status === 429) ... = true` would
  // silently reintroduce one failing AI call per file during a 502/503 outage.
  assert.ok(!/status\s*===\s*429/.test(loop), 'loop must not special-case 429 when deciding to stop AI extraction');
});

test('the flag is set on any non-OK extract-candidate reply', () => {
  const loop = uploadLoopBody();
  assert.ok(
    loop.includes('aiStopped = true;'),
    'expected the exact guard line `aiStopped = true;` inside the non-OK branch'
  );
});

test('AI extraction is skipped once the flag is set', () => {
  const loop = uploadLoopBody();
  assert.ok(
    loop.includes('if (!aiStopped) {'),
    'expected the /api/extract-candidate fetch to be wrapped in `if (!aiStopped) { ... }`'
  );
});

test('the per-file fallback name from the file name is still present', () => {
  const loop = uploadLoopBody();
  assert.ok(
    loop.includes("file.name.replace(/\\.[^.]+$/, '')"),
    'expected the fallback that derives a candidate name from the uploaded file name'
  );
});
