// Feature-gating regression tests.  Run: node --test tests/
//
// These guard the tenant boundary in the sidebar and router: an org without
// partner_crm_enabled must never reach the RTcompu partner screens, and an
// org's own admin must not be able to bypass that. RLS is the real data
// boundary — this is the UI one, and it has silently gone missing before.
//
// Deliberately dependency-free (node:test, not Playwright): the repo ships no
// node_modules, and this needs no browser. app-shell.spec.js still covers the
// rendered UI under Playwright.
//
// public/js/features.js imports public/js/supabase.js, which pulls supabase-js from a CDN and
// reads window.ATLLANTA_CONFIG, so it cannot be imported in Node as-is. We copy
// features.js next to a stub supabase.js and import that; the logic under test
// is untouched.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'public/js', 'features.js');

let F, tmp;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-gating-'));
  fs.writeFileSync(
    path.join(tmp, 'supabase.js'),
    'export default { from() { throw new Error("no database in unit tests"); } };'
  );
  fs.writeFileSync(path.join(tmp, 'features.js'), fs.readFileSync(SRC, 'utf8'));
  F = await import(pathToFileURL(path.join(tmp, 'features.js')).href);
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

// Mirrors index.html's bootstrap: platform gates from the org row, then the
// per-user rules (skipped here — no database).
// `modules` is the org's switched-on org_modules keys; omitted = not loaded,
// which leaves the module gate off (the pre-Step-3 behaviour).
function asOrg({ crm, pack, admin = false, modules = null }) {
  F.setCrmEnabled(crm);
  F.setPartnerPack(pack);
  F.setEnabledModules(modules);
  F.loadFeatureAccess({ orgId: null, userId: null, role: admin ? 'admin' : 'member', isAdmin: admin });
  return F.isRouteAllowed;
}

const PARTNER_ROUTES = [
  'crm/partners', 'crm/partner', 'crm/field-sales', 'crm/log-visit',
  'crm/prospects', 'crm/events', 'crm/exports', 'crm/pjp',
  'crm/sales', 'crm/reports',
];

describe('platform gates', () => {
  test('a generic-CRM tenant sees the generic screens', () => {
    const allowed = asOrg({ crm: true, pack: false });
    assert.equal(allowed('crm'), true);
    assert.equal(allowed('crm/leads'), true);
    assert.equal(allowed('crm/opportunities'), true);
  });

  test('a generic-CRM tenant reaches no partner screen', () => {
    const allowed = asOrg({ crm: true, pack: false });
    for (const route of PARTNER_ROUTES) {
      assert.equal(allowed(route), false, `${route} must be blocked without the partner pack`);
    }
  });

  test('the partner tenant reaches every partner screen', () => {
    const allowed = asOrg({ crm: true, pack: true });
    for (const route of PARTNER_ROUTES) {
      assert.equal(allowed(route), true, `${route} must be open with the partner pack`);
    }
    assert.equal(allowed('crm/leads'), true);
  });

  test('disabling CRM hides it without affecting other modules', () => {
    const allowed = asOrg({ crm: false, pack: false });
    assert.equal(allowed('crm'), false);
    assert.equal(allowed('crm/leads'), false);
    assert.equal(allowed('people'), true);
    assert.equal(allowed('dashboard'), true);
  });
});

describe('admin bypass must not defeat a platform gate', () => {
  test('an admin without the pack still cannot reach partner screens', () => {
    const allowed = asOrg({ crm: true, pack: false, admin: true });
    for (const route of PARTNER_ROUTES) {
      assert.equal(allowed(route), false, `${route} must stay blocked even for an admin`);
    }
  });

  test('an admin keeps the screens their org does have', () => {
    const allowed = asOrg({ crm: true, pack: false, admin: true });
    assert.equal(allowed('crm/leads'), true);
    assert.equal(allowed('crm'), true);
  });
});

describe('route mapping', () => {
  test('sub-routes resolve to their own feature key', () => {
    assert.equal(F.featureForRoute('crm/field-sales'), 'crm_field_sales');
    assert.equal(F.featureForRoute('crm/log-visit'), 'crm_visits');
    assert.equal(F.featureForRoute('crm/leads'), 'crm_leads');
    assert.equal(F.featureForRoute('crm'), 'crm');
  });

  test('aliases fold onto their parent module', () => {
    assert.equal(F.featureForRoute('employees/profile'), 'people');
    assert.equal(F.featureForRoute('attendance/checkin'), 'me');
    assert.equal(F.featureForRoute('approvals'), 'inbox');
  });

  test('query strings do not change the decision', () => {
    const allowed = asOrg({ crm: true, pack: false });
    assert.equal(allowed('crm/partners?id=123'), false);
    assert.equal(allowed('crm/leads?id=123'), true);
  });

  test('unknown routes stay open rather than locking people out', () => {
    const allowed = asOrg({ crm: true, pack: false });
    assert.equal(allowed('settings/org'), true);
    assert.equal(allowed('helpdesk'), true);
  });
});

// Phase 3 Step 3: the org_modules gate.
describe('module gate', () => {
  const ALL = ['people', 'me', 'inbox', 'documents', 'finance', 'announcements', 'recruitment',
    'crm', 'crm_partner', 'analytics', 'helpdesk', 'projects', 'ai'];

  test('a module the org has switched off is hidden, with its sub-routes and aliases', () => {
    const allowed = asOrg({ crm: true, pack: true, modules: ALL.filter(m => m !== 'people' && m !== 'crm') });
    for (const r of ['people', 'employees/profile', 'lifecycle', 'crm/leads', 'crm/opportunities']) {
      assert.equal(allowed(r), false, r);
    }
    assert.equal(allowed('recruitment'), true);
    assert.equal(allowed('crm/partners'), true, 'the partner pack is its own module');
    assert.equal(allowed('crm'), true, 'the hub still opens for the partner pack');
  });

  test('an org with nothing switched on keeps only the non-module screens', () => {
    const allowed = asOrg({ crm: true, pack: true, modules: [] });
    for (const r of ['people', 'me', 'attendance/checkin', 'approvals', 'recruitment', 'crm', 'crm/partners',
      'analytics', 'helpdesk', 'announcements', 'finance', 'documents', 'ai']) {
      assert.equal(allowed(r), false, r);
    }
    for (const r of ['dashboard', 'reports', 'admin', 'settings', 'settings/org', 'audit']) {
      assert.equal(allowed(r), true, r);
    }
  });

  test('owners and admins do not bypass it (it is a platform gate)', () => {
    const allowed = asOrg({ crm: true, pack: true, admin: true, modules: ['people'] });
    assert.equal(allowed('people'), true);
    assert.equal(allowed('crm'), false);
    assert.equal(allowed('admin'), true, 'the admin panel, and so Modules & roles, stays reachable');
  });

  test('switching a module on does not override the partner-pack platform flag', () => {
    const allowed = asOrg({ crm: true, pack: false, modules: ALL });
    assert.equal(allowed('crm/partners'), false);
    assert.equal(allowed('crm/leads'), true);
  });

  test('not loaded (null) leaves every module as before', () => {
    const allowed = asOrg({ crm: true, pack: true, modules: null });
    for (const r of ['people', 'crm', 'crm/partners', 'recruitment', 'ai']) assert.equal(allowed(r), true, r);
  });

  test('a failed load falls back to not applying the gate', async () => {
    F.setEnabledModules(['people']);
    const warn = console.warn; console.warn = () => {};
    try {
      await F.loadOrgModules('org-1'); // the stub database throws
    } catch {
      // loadOrgModules must not throw into the bootstrap
      assert.fail('loadOrgModules threw');
    } finally {
      console.warn = warn;
    }
    // ...and the gate is off again, not stuck on the previous org's modules.
    F.setCrmEnabled(true); F.setPartnerPack(true);
    F.loadFeatureAccess({ orgId: null, userId: null, role: 'member', isAdmin: false });
    assert.equal(F.isRouteAllowed('crm'), true);
  });

  // The CRM hub (#/crm) fronts both generic CRM and the partner pack, like the
  // sidebar CRM button (index.html shows it if crm OR crm_partners is allowed).
  test('the CRM hub opens with only the partner pack switched on', () => {
    const allowed = asOrg({ crm: true, pack: true, modules: ['crm_partner', 'people'] });
    assert.equal(allowed('crm'), true, 'hub reachable');
    assert.equal(allowed('crm?x=1'), true, 'hub with a query string');
    assert.equal(allowed('crm/partners'), true);
    assert.equal(allowed('crm/leads'), false, 'generic screens stay behind the crm module');
    assert.equal(allowed('crm/opportunities'), false);
  });

  test('the CRM hub stays hidden when neither CRM module is on', () => {
    const allowed = asOrg({ crm: true, pack: true, modules: ['people'] });
    assert.equal(allowed('crm'), false);
  });

  test('the CRM hub only offers cards the user can open', () => {
    const hub = fs.readFileSync(path.join(HERE, '..', 'public/views/crm/index.js'), 'utf8');
    assert.match(hub, /import \{ isRouteAllowed \} from '\.\.\/\.\.\/js\/features\.js';/);
    assert.match(hub, /\.filter\(\(?c\)? => isRouteAllowed\(c\.route\)\)/);
  });

  test('the legacy map equals the new stack\'s FEATURE_MODULE', async () => {
    const { FEATURE_MODULE } = await import('../src/lib/auth/permissions-core.ts');
    assert.deepEqual({ ...F.MODULE_OF }, { ...FEATURE_MODULE });
  });
});
