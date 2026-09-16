// Verifies the tenant gating in a real browser, against the real files as served.
//
// Uses the Playwright library directly — the `playwright test` runner does not
// start in this sandbox (even `--list` hangs), but chromium.launch() is fine.
//
// js/supabase.js pulls supabase-js from a CDN and needs a live session, so that
// one module is replaced with a stub carrying a fixture org. Everything else —
// the app shell's bootstrap, features.js, router.js, the whole ESM graph — is the
// genuine artifact, parsed and executed by a real browser.

import { chromium } from '@playwright/test';

// Override with BASE_URL when port 3000 is taken (e.g. by another checkout's
// server, which would silently test the wrong tree).
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (label, actual, expected) => {
  const good = JSON.stringify(actual) === JSON.stringify(expected);
  good ? pass++ : fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label}${good ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
};

// A stub supabase client whose organizations row carries the gate flags we want
// to exercise. Every query resolves to a fixture; nothing touches the network.
const stub = ({ crmEnabled, partnerPack }) => `
  // auth.js on this line reads memberships(user_id, organization_id, role),
  // then organizations. users is kept for lines that folded memberships into it.
  // Without the org link the partner routes block for lack of an org, not by
  // the gate, which would look exactly like a pass.
  const FIXTURES = {
    memberships: { id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'agency_admin', created_at: '2026-01-01' },
    users: { id: 'u1', org_id: 'o1', role: 'admin', full_name: 'Fixture User', email: 'fixture@example.com' },
    organizations: { id: 'o1', name: 'Fixture Org', crm_enabled: ${crmEnabled}, partner_crm_enabled: ${partnerPack} },
  };
  function chainFor(table) {
    const row = FIXTURES[table] ?? null;
    let single = false;   // PostgREST returns a row for .single(), a list otherwise
    const c = new Proxy(function () {}, {
      get(_, p) {
        if (p === 'then') {
          const data = single ? row : (row ? [row] : []);
          return (resolve) => resolve({ data, error: null, count: 0 });
        }
        if (p === 'single' || p === 'maybeSingle') return () => { single = true; return c; };
        return () => c;
      },
      apply() { return c; },
    });
    return c;
  }
  export default {
    from: (t) => chainFor(t),
    rpc: () => chainFor(null),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
    auth: {
      getSession: async () => ({ data: { session: { user: {
        id: 'u1', email: 'fixture@example.com', user_metadata: { full_name: 'Fixture User' },
      } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
  };
`;

async function boot(browser, opts) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/js/supabase.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: stub(opts) })
  );
  await page.goto(`${BASE}/${APP_PAGE}`, { waitUntil: 'domcontentloaded' });
  // The shell unhides #app only after the auth bootstrap completes.
  await page.waitForFunction(() => {
    const el = document.getElementById('app');
    return el && !el.classList.contains('hidden');
  }, { timeout: 15000 });
  return { page, errors };
}

// Navigate to a hash route and report what the content area rendered.
async function visit(page, route) {
  await page.evaluate(r => { window.location.hash = '#/' + r; }, route);
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const t = document.querySelector('#main-content .empty-state-title');
    return t ? t.textContent.trim() : '<view rendered>';
  });
}

try {
  await fetch(`${BASE}/login.html`);
} catch {
  console.error(`\nNo server on ${BASE}. Start one first:\n  npx serve . -p 3000\n`);
  process.exit(1);
}

// The app shell is app.html where index.html is the marketing landing page
// (vercel.json rewrites /app to it); on lines without a landing page it is index.html.
const APP_PAGE = (await fetch(`${BASE}/app.html`)).ok ? 'app.html' : 'index.html';
console.log(`app shell: ${APP_PAGE}`);

const browser = await chromium.launch({ headless: true });

console.log('\n--- login page (real browser) ---');
{
  const page = await browser.newPage();
  const res = await page.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded' });
  ok('HTTP status', res.status(), 200);
  ok('title', await page.title(), 'Atllanta — Sign in');
  ok('#login-email present', await page.locator('#login-email').count(), 1);
  await page.close();
}

console.log('\n--- generic tenant (partner_crm_enabled = false) ---');
{
  const { page, errors } = await boot(browser, { crmEnabled: true, partnerPack: false });
  ok('app shell became visible', await page.locator('#app:not(.hidden)').count(), 1);
  ok('Analytics nav restored', await page.locator('.nav-btn[data-view="analytics"]').count(), 1);

  ok('crm/partners   -> blocked', await visit(page, 'crm/partners'), 'Not available');
  ok('crm/field-sales-> blocked', await visit(page, 'crm/field-sales'), 'Not available');
  ok('crm/sales      -> blocked', await visit(page, 'crm/sales'), 'Not available');
  ok('crm/pjp        -> blocked', await visit(page, 'crm/pjp'), 'Not available');
  ok('crm/exports    -> blocked', await visit(page, 'crm/exports'), 'Not available');

  const leads = await visit(page, 'crm/leads');
  ok('crm/leads      -> NOT blocked', leads !== 'Not available', true);

  ok('no uncaught page errors', errors, []);
  await page.close();
}

console.log('\n--- partner tenant (partner_crm_enabled = true) ---');
{
  const { page, errors } = await boot(browser, { crmEnabled: true, partnerPack: true });
  for (const r of ['crm/partners', 'crm/field-sales', 'crm/sales', 'crm/pjp', 'crm/exports']) {
    const got = await visit(page, r);
    ok(`${r.padEnd(15)}-> reachable`, got !== 'Not available', true);
  }
  ok('no uncaught page errors', errors, []);
  await page.close();
}

console.log('\n--- CRM switched off entirely ---');
{
  const { page } = await boot(browser, { crmEnabled: false, partnerPack: false });
  ok('crm hub        -> blocked', await visit(page, 'crm'), 'Not available');
  ok('crm/leads      -> blocked', await visit(page, 'crm/leads'), 'Not available');
  const people = await visit(page, 'people');
  ok('people         -> unaffected', people !== 'Not available', true);
  await page.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
