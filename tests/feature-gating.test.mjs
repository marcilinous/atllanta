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
function asOrg({ crm, pack, admin = false }) {
  F.setCrmEnabled(crm);
  F.setPartnerPack(pack);
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
