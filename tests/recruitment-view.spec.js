// Regression guard for view-init crashes.
//
// The Recruitment page shipped to production stuck on its loading skeletons:
// `loadOrgMembers()` was awaited during init while `let orgMembers` was
// declared ~150 lines further down, so reading it threw
// "Cannot access 'orgMembers' before initialization". router.js awaits the
// view handler with no try/catch, so the rejection stopped rendering right
// after the skeletons were painted — a permanently half-loaded page.
//
// The existing suite never caught it because it only checks the app shell and
// never actually runs a view. These tests boot real views against a stubbed
// Supabase module (no network, no auth) and assert two things: the view throws
// nothing, and it replaces its skeletons with real content.

import { test, expect } from '@playwright/test';

const SUPABASE_STUB = `
const ROWS = {
  memberships: [{ id:'m1', user_id:'u1', organization_id:'org1', client_id:'c1', role:'client_admin', full_name:'Test HR', email:'hr@test.com' }],
  organizations: [{ id:'org1', name:'Test Org', timezone:'Asia/Kolkata' }],
  jobs: [{ id:'j1', title:'Backend Engineer', status:'open', org_id:'org1', client_id:'c1', description:'JD text', created_at:'2026-01-01' }],
  candidates: [], job_applications: [], feature_access: [], interview_slots: [],
  notifications: [], clients: [{ id:'c1', organization_id:'org1' }],
};
function builder(table) {
  const rows = ROWS[table] || [];
  const b = {};
  ['select','eq','in','is','gte','lte','or','order','limit','match','neq','filter','not','contains']
    .forEach(m => { b[m] = () => b; });
  b.single = () => Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'no rows' } });
  b.maybeSingle = () => Promise.resolve({ data: rows[0] || null, error: null });
  b.then = (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej);
  b.insert = () => b; b.update = () => b; b.delete = () => b; b.upsert = () => b;
  return b;
}
export default {
  from: builder,
  auth: {
    getSession: async () => ({ data: { session: { user: { id:'u1', email:'hr@test.com' }, access_token:'tok' } } }),
    getUser: async () => ({ data: { user: { id:'u1', email:'hr@test.com' } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
    signOut: async () => ({}),
  },
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} }),
  removeChannel: () => {},
};
`;

test.beforeEach(async ({ page }) => {
  await page.route('**/js/supabase.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: SUPABASE_STUB }));
  await page.route('**/*.{woff2,woff,ttf}', route => route.abort());
  await page.route('**/fonts.googleapis.com/**', route => route.abort());
  await page.route('**/fonts.gstatic.com/**', route => route.abort());
});

// Views that render a list and must resolve past their loading state.
const VIEWS = [
  { hash: '#/recruitment', title: 'Recruitment' },
  { hash: '#/recruitment/interviews', title: 'Interviews' },
];

for (const view of VIEWS) {
  test(`${view.hash} renders without a view-init crash`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    await page.goto(`/app.html${view.hash}`);
    await page.waitForTimeout(2500);

    expect(errors, `uncaught error while rendering ${view.hash}`).toEqual([]);
    await expect(page.locator('.page-title')).toContainText(view.title);
  });
}

test('#/recruitment resolves its loading skeletons', async ({ page }) => {
  await page.goto('/app.html#/recruitment');
  await page.waitForTimeout(2500);

  const grid = page.locator('#jobs-grid');
  await expect(grid).toBeVisible();
  // Skeletons still present means the view died mid-render.
  await expect(grid.locator('.skeleton')).toHaveCount(0);
  await expect(grid).toContainText('Backend Engineer');
});
