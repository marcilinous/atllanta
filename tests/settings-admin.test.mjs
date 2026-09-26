// Phase 3 Step 4 (v1.4.0): the admin screens under app/(platform)/settings/.
// Behaviour tests for the pure pieces (catalogue, grant flattening, input
// schemas) and static checks that every action and page goes through the
// owner/admin gate and never takes an org id from the browser.
// Run: node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODULE_KEYS,
  MODULE_LABELS,
  ACCESS_FEATURES,
  ACCESS_ROLES,
  slugify,
  grantRows,
  grantsFromRows,
} from '../src/lib/settings/catalogue.ts';
import {
  setModuleEnabledSchema,
  createCustomRoleSchema,
  updateCustomRoleSchema,
  setFeatureRuleSchema,
} from '../src/lib/settings/schemas.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Normalised to LF: a Windows checkout with autocrlf gives CRLF working files.
const readAbs = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const read = (p) => readAbs(path.join(ROOT, p));
const UUID = '7b0e6c1e-1234-4abc-8def-0123456789ab';

describe('catalogue', () => {
  test('every module key has a label, and nothing else does', () => {
    assert.deepEqual(Object.keys(MODULE_LABELS).sort(), [...MODULE_KEYS].sort());
  });

  test('the access editor offers exactly the legacy FEATURES, minus locked ones, in order', () => {
    const src = read('public/js/features.js');
    const block = src.slice(src.indexOf('export const FEATURES'), src.indexOf('];', src.indexOf('export const FEATURES')));
    const legacy = [...block.matchAll(/\{ key: '([a-z_]+)', label: '([^']+)'(, locked: true)? \}/g)]
      .filter((m) => !m[3])
      .map((m) => ({ key: m[1], label: m[2] }));
    assert.ok(legacy.length > 10, 'parsed the legacy FEATURES list');
    assert.deepEqual(ACCESS_FEATURES.map((f) => ({ key: f.key, label: f.label })), legacy);
  });

  test('owners and admins are never configurable (they bypass feature rules)', () => {
    const keys = ACCESS_ROLES.map((r) => r.key);
    assert.ok(!keys.includes('owner') && !keys.includes('admin'));
    assert.deepEqual(keys, ['manager', 'developer', 'member']);
  });
});

describe('slugify', () => {
  test('lower-case ASCII with single hyphens', () => {
    assert.equal(slugify('  Sales Lead (North) '), 'sales-lead-north');
    assert.equal(slugify('Café Manager'), 'cafe-manager');
    assert.equal(slugify('HR -- Ops'), 'hr-ops');
  });
  test('a name with no ASCII letters or digits gives an empty slug', () => {
    assert.equal(slugify('प्रबंधक'), '');
    assert.equal(slugify('---'), '');
  });
  test('capped at 48 characters without a trailing hyphen', () => {
    const s = slugify('a'.repeat(47) + ' bcd');
    assert.ok(s.length <= 48);
    assert.ok(!s.endsWith('-'));
  });
});

describe('grantRows / grantsFromRows', () => {
  test('flattens in module order then permission order, deduplicated', () => {
    const rows = grantRows([
      { moduleKey: 'crm', permissions: ['edit', 'view', 'view'] },
      { moduleKey: 'people', permissions: ['approve', 'view'] },
    ]);
    assert.deepEqual(rows, [
      { moduleKey: 'people', permission: 'view' },
      { moduleKey: 'people', permission: 'approve' },
      { moduleKey: 'crm', permission: 'view' },
      { moduleKey: 'crm', permission: 'edit' },
    ]);
  });

  test('round-trips, and drops keys the constants no longer know', () => {
    const grants = grantsFromRows([
      { moduleKey: 'crm', permission: 'edit' },
      { moduleKey: 'crm', permission: 'view' },
      { moduleKey: 'retired_module', permission: 'view' },
      { moduleKey: 'crm', permission: 'superpower' },
    ]);
    assert.deepEqual(grants, [{ moduleKey: 'crm', permissions: ['view', 'edit'] }]);
    assert.deepEqual(grantRows(grants), [
      { moduleKey: 'crm', permission: 'view' },
      { moduleKey: 'crm', permission: 'edit' },
    ]);
  });
});

describe('schemas', () => {
  test('module toggle: known key and a boolean only', () => {
    assert.ok(setModuleEnabledSchema.safeParse({ moduleKey: 'crm', enabled: true }).success);
    assert.ok(!setModuleEnabledSchema.safeParse({ moduleKey: 'dashboard', enabled: true }).success);
    assert.ok(!setModuleEnabledSchema.safeParse({ moduleKey: 'crm', enabled: 'yes' }).success);
  });

  test('no schema lets the browser choose the org', () => {
    const parsed = setModuleEnabledSchema.parse({ moduleKey: 'crm', enabled: true, orgId: UUID });
    assert.equal('orgId' in parsed, false);
    const role = createCustomRoleSchema.parse({ name: 'Ops', grants: [], orgId: UUID });
    assert.equal('orgId' in role, false);
  });

  test('custom role: trimmed name required, empty description becomes null', () => {
    const r = createCustomRoleSchema.parse({ name: '  Ops  ', description: '   ', grants: [] });
    assert.equal(r.name, 'Ops');
    assert.equal(r.description, null);
    assert.ok(!createCustomRoleSchema.safeParse({ name: '   ', grants: [] }).success);
    assert.ok(!createCustomRoleSchema.safeParse({ name: 'x'.repeat(61), grants: [] }).success);
  });

  test('a grant needs View, at least one permission, and a module only once', () => {
    const ok = createCustomRoleSchema.safeParse({ name: 'Ops', grants: [{ moduleKey: 'crm', permissions: ['view', 'edit'] }] });
    assert.ok(ok.success);
    assert.ok(!createCustomRoleSchema.safeParse({ name: 'Ops', grants: [{ moduleKey: 'crm', permissions: ['edit'] }] }).success);
    assert.ok(!createCustomRoleSchema.safeParse({ name: 'Ops', grants: [{ moduleKey: 'crm', permissions: [] }] }).success);
    assert.ok(
      !createCustomRoleSchema.safeParse({
        name: 'Ops',
        grants: [
          { moduleKey: 'crm', permissions: ['view'] },
          { moduleKey: 'crm', permissions: ['view', 'edit'] },
        ],
      }).success
    );
    assert.ok(!createCustomRoleSchema.safeParse({ name: 'Ops', grants: [{ moduleKey: 'crm', permissions: ['view', 'own'] }] }).success);
  });

  test('update needs a role id', () => {
    assert.ok(!updateCustomRoleSchema.safeParse({ roleId: 'nope', name: 'Ops', grants: [] }).success);
    assert.ok(updateCustomRoleSchema.safeParse({ roleId: UUID, name: 'Ops', grants: [] }).success);
  });

  test('feature rule: roles are manager/developer/member and tick boxes; people are ids with a default', () => {
    const ok = (v) => setFeatureRuleSchema.safeParse(v).success;
    assert.ok(ok({ subjectType: 'role', subjectKey: 'manager', featureKey: 'crm', value: 'hidden' }));
    assert.ok(!ok({ subjectType: 'role', subjectKey: 'admin', featureKey: 'crm', value: 'hidden' }));
    assert.ok(!ok({ subjectType: 'role', subjectKey: 'owner', featureKey: 'crm', value: 'hidden' }));
    assert.ok(!ok({ subjectType: 'role', subjectKey: 'member', featureKey: 'crm', value: 'default' }));
    assert.ok(ok({ subjectType: 'user', subjectKey: UUID, featureKey: 'reports', value: 'default' }));
    assert.ok(!ok({ subjectType: 'user', subjectKey: 'member', featureKey: 'crm', value: 'hidden' }));
    assert.ok(!ok({ subjectType: 'user', subjectKey: UUID, featureKey: 'dashboard', value: 'hidden' }));
    assert.ok(!ok({ subjectType: 'user', subjectKey: UUID, featureKey: 'crm_contacts', value: 'hidden' }));
  });
});

describe('static: the gate', () => {
  const actions = read('src/lib/settings/actions.ts');

  test('every exported action checks owner/admin before anything else', () => {
    const exported = [...actions.matchAll(/export const (\w+) = action\([^,]+, async \(input\) => \{\n\s+const admin = await requireOrgAdmin\(\);/g)].map((m) => m[1]);
    const all = [...actions.matchAll(/export const (\w+) = action\(/g)].map((m) => m[1]);
    assert.deepEqual(exported, all);
    assert.deepEqual(all.sort(), ['createCustomRole', 'deleteCustomRole', 'setFeatureRule', 'setModuleEnabled', 'updateCustomRole']);
  });

  test('actions never take an org id from input, and write only through withTransaction', () => {
    assert.doesNotMatch(actions, /input\.orgId/);
    assert.doesNotMatch(actions, /getDb\(/);
    assert.match(actions, /^"use server";/);
  });

  test('every settings page goes through adminOrNull()', () => {
    const dir = path.join(ROOT, 'app/(platform)/settings');
    const pages = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === 'page.tsx') pages.push(p);
      }
    })(dir);
    assert.ok(pages.length >= 5);
    for (const p of pages) {
      const src = readAbs(p);
      if (/redirect\("\/settings\/modules"\)/.test(src)) continue; // the index redirect
      assert.match(src, /const admin = await adminOrNull\(\);\n\s+if \(!admin\) return <NotAllowed \/>;/, p);
    }
  });

  test('the guard refuses exited users and non-admins', () => {
    const guard = read('src/lib/auth/admin.ts');
    assert.match(guard, /import "server-only";/);
    assert.match(guard, /row\.status === "exited"/);
    assert.match(guard, /row\.role !== "owner" && row\.role !== "admin"/);
  });
});
