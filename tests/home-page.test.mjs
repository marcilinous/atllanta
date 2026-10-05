// v1.14.0: the public home page at atllanta.com. Signed-out visitors to "/"
// get public/home.html (the #64 landing, restored and corrected); anyone
// signed in — or coming back from Google with ?code= — gets the app.
// Run: node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

describe('routing at /', () => {
  test('proxy serves the home page to signed-out visitors only, and never swallows an OAuth code', () => {
    const p = read('proxy.ts');
    assert.match(p, /const \{\s*data: \{ user \},?\s*\} = await supabase\.auth\.getUser\(\);/);
    assert.match(p, /if \(request\.nextUrl\.pathname === "\/" && !user && !request\.nextUrl\.searchParams\.has\("code"\)\) \{/);
    assert.match(p, /url\.pathname = "\/home\.html";/);
    assert.match(p, /NextResponse\.rewrite\(url/);
  });

  test('the service worker never serves a cached / (it depends on who is signed in)', () => {
    const sw = read('public', 'sw.js');
    const assets = sw.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/)[1];
    assert.doesNotMatch(assets, /"\/",/);
    assert.match(sw, /if \(pathname === "\/"\) \{\s*event\.respondWith\(fetch\(request\)\.catch\(\(\) => caches\.match\("\/index\.html"\)\)\);/);
  });
});

describe('the home page', () => {
  const html = () => read('public', 'home.html');

  test('exists and is the Atllanta landing', () => {
    const h = html();
    assert.match(h, /<title>Atllanta — One system to run your whole company<\/title>/);
    assert.match(h, /<link rel="canonical" href="https:\/\/www\.atllanta\.com\/">/);
  });

  test('no enquiry form, no service key, no old domain, no dead analytics tags', () => {
    const h = html();
    assert.doesNotMatch(h, /<form/i);
    assert.doesNotMatch(h, /\/api\/lead|lead-form|service_?role/i);
    assert.doesNotMatch(h, /atllanta\.vercel\.app/);
    assert.doesNotMatch(h, /_vercel\/(insights|speed-insights)/);
    assert.doesNotMatch(h, /location\.replace\('\/app'\)/);
  });

  test('calls to action: start a trial, sign in, talk to us', () => {
    const h = html();
    assert.match(h, /href="\/login\?signup"/);
    assert.match(h, /Start free trial/);
    assert.match(h, /href="\/login"/);
    assert.match(h, /mailto:anchansachinv99@gmail\.com/);
    assert.match(h, /https:\/\/wa\.me\/918073163762/);
  });

  test('pricing tells the truth about the trial', () => {
    const h = html();
    assert.match(h, /14-day free trial/);
    assert.doesNotMatch(h, /Free to pilot/);
    assert.doesNotMatch(h, />\s*Pilot\s*</);
  });

  test('old app links and reset links still reach sign-in', () => {
    const h = html();
    assert.match(h, /if \(location\.hash\.startsWith\('#\/'\) \|\| location\.hash\.includes\('access_token'\) \|\| location\.hash\.includes\('type=recovery'\)\)/);
    assert.match(h, /location\.replace\('\/login' \+ \(location\.hash\.startsWith\('#\/'\) \? '' : location\.hash\)\)/);
  });
});

describe('sign-up is open', () => {
  test('the Sign up link shows, and /login?signup opens it', () => {
    const login = read('public', 'login.html');
    assert.match(login, /const SIGNUP_OPEN = true;/);
    assert.match(login, /setView\(SIGNUP_OPEN && new URLSearchParams\(location\.search\)\.has\('signup'\) \? 'signup' : 'login'\);/);
  });
});
