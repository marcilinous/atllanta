// v1.2.4: /api/reports and /api/send-notification were removed, not patched.
// Both ran as the service role without an org filter (reports read every
// organisation's attendance, leave and hiring data; send-notification wrote a
// notification to any user id and emailed any address with caller-supplied
// HTML). Nothing in the app called either. They must stay gone: a handler
// that comes back here needs its own org scoping review first.
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = (await import(pathToFileURL(path.join(ROOT, 'pages/api/[...legacy].js')).href)).default;

function res() {
  return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

for (const name of ['reports', 'send-notification']) {
  test(`/api/${name} is not served`, async () => {
    const r = res();
    await router({ method: 'GET', query: { legacy: [name] }, headers: {} }, r);
    assert.deepEqual([r.statusCode, r.body], [404, { error: 'Not found' }]);
  });

  test(`server/legacy/${name}.js does not exist`, () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'server/legacy', `${name}.js`)), false);
  });
}

for (const name of ['constructor', '__proto__', 'toString']) {
  test(`/api/${name} is a 404, not a crash`, async () => {
    const r = res();
    await router({ method: 'GET', query: { legacy: [name] }, headers: {} }, r);
    assert.equal(r.statusCode, 404);
  });
}
