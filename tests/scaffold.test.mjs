// The scaffold must not leak server secrets into the browser bundle, and the
// legacy app must still be served from public/. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

test('the legacy shell and its assets live under public/', () => {
  for (const p of ['public/index.html', 'public/login.html', 'public/sw.js',
                   'public/version.json', 'public/js/router.js', 'public/css/tokens.css',
                   'public/views/dashboard.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `missing ${p}`);
  }
});

test('every legacy endpoint is reachable through the catch-all', () => {
  const route = fs.readFileSync(path.join(ROOT, 'pages/api/[...legacy].js'), 'utf8');
  for (const name of fs.readdirSync(path.join(ROOT, 'server/legacy')).filter(f => f.endsWith('.js'))) {
    assert.ok(route.includes(`server/legacy/${name}`), `${name} not wired into the catch-all`);
  }
});

test('no server-only secret is referenced from app/ or components/', () => {
  const offenders = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        if (src.includes('SUPABASE_SERVICE_ROLE_KEY') || src.includes('GROQ_API_KEY')) offenders.push(p);
      }
    }
  };
  walk(path.join(ROOT, 'app'));
  walk(path.join(ROOT, 'components'));
  assert.deepEqual(offenders, []);
});

test('vercel.json keeps the framework pin and the event-processor cron', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(cfg.framework, 'nextjs', 'vercel.json must force framework: "nextjs" (Vercel does not auto-detect this tree)');
  const cron = (cfg.crons || []).find((c) => c.path === '/api/event-processor');
  assert.ok(cron, 'vercel.json must keep a cron whose path is /api/event-processor');
});
