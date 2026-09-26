// Run: node --test tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM_ROLE_DEFAULTS,
  isSystemRole,
  permissionsFor,
  can,
  canSeeFeature,
  FEATURE_MODULE,
  ALWAYS_ON,
} from '../src/lib/auth/permissions-core.ts';
import { MODULE_KEYS, PERMISSIONS } from '../src/lib/auth/modules.ts';

function makeCtx(overrides = {}) {
  return {
    userId: 'user-1',
    orgId: 'org-1',
    role: 'member',
    customRoleId: null,
    enabledModules: new Set(),
    customGrants: new Map(),
    featureRules: [],
    ...overrides,
  };
}

describe('isSystemRole', () => {
  test('accepts exactly the five system roles', () => {
    for (const role of ['owner', 'admin', 'developer', 'manager', 'member']) {
      assert.strictEqual(isSystemRole(role), true);
    }
  });

  test('rejects anything else', () => {
    for (const bad of ['superadmin', '', null, undefined, 42, {}]) {
      assert.strictEqual(isSystemRole(bad), false);
    }
  });
});

describe('Role matrix', () => {
  const roles = ['owner', 'admin', 'developer', 'manager', 'member'];
  const expected = {
    owner: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    admin: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    manager: new Set(['view', 'create', 'edit', 'approve']),
    member: new Set(['view', 'create', 'edit']),
    developer: new Set(['view', 'create', 'edit']),
  };

  for (const role of roles) {
    for (const perm of PERMISSIONS) {
      test(`${role} can ${perm}? (enabled module)`, () => {
        const ctx = makeCtx({ role, enabledModules: new Set(['people']) });
        const expectedHas = expected[role].has(perm);
        assert.strictEqual(can(ctx, 'people', perm), expectedHas);
        assert.strictEqual(SYSTEM_ROLE_DEFAULTS[role].has(perm), expectedHas);
      });
    }
  }
});

describe('Disabled module denies everything', () => {
  test('owner with no enabled modules gets no permissions', () => {
    const ctx = makeCtx({ role: 'owner', enabledModules: new Set() });
    assert.strictEqual(permissionsFor(ctx, 'people').size, 0);
    for (const perm of PERMISSIONS) {
      assert.strictEqual(can(ctx, 'people', perm), false);
    }
  });

  test('re-enabling the module restores defaults', () => {
    const ctx = makeCtx({ role: 'owner', enabledModules: new Set(['people']) });
    for (const perm of PERMISSIONS) {
      assert.strictEqual(can(ctx, 'people', perm), true);
    }
  });
});

describe('Custom role override', () => {
  test('custom grants override the base role for modules they list', () => {
    const ctx = makeCtx({
      role: 'member',
      enabledModules: new Set(['crm', 'people']),
      customGrants: new Map([['crm', new Set(['view'])]]),
    });
    assert.strictEqual(can(ctx, 'crm', 'view'), true);
    assert.strictEqual(can(ctx, 'crm', 'create'), false);
    assert.strictEqual(can(ctx, 'crm', 'edit'), false);

    // people is enabled but has no custom grant -> falls back to member defaults
    assert.strictEqual(can(ctx, 'people', 'view'), true);
    assert.strictEqual(can(ctx, 'people', 'create'), true);
    assert.strictEqual(can(ctx, 'people', 'edit'), true);
    assert.strictEqual(can(ctx, 'people', 'delete'), false);
    assert.strictEqual(can(ctx, 'people', 'approve'), false);
  });

  test('custom grants for a disabled module grant nothing', () => {
    const ctx = makeCtx({
      role: 'member',
      enabledModules: new Set(['people']),
      customGrants: new Map([['finance', new Set(['view', 'approve'])]]),
    });
    assert.strictEqual(can(ctx, 'finance', 'view'), false);
    assert.strictEqual(can(ctx, 'finance', 'approve'), false);
  });
});

describe('Custom grant can exceed the base role', () => {
  test('member with a custom approve grant can approve', () => {
    const ctx = makeCtx({
      role: 'member',
      enabledModules: new Set(['finance']),
      customGrants: new Map([['finance', new Set(['approve', 'view'])]]),
    });
    assert.strictEqual(can(ctx, 'finance', 'approve'), true);
    assert.strictEqual(can(ctx, 'finance', 'view'), true);
    assert.strictEqual(can(ctx, 'finance', 'create'), false);
    assert.strictEqual(can(ctx, 'finance', 'edit'), false);
    assert.strictEqual(can(ctx, 'finance', 'delete'), false);
  });
});

describe('canSeeFeature', () => {
  test('always-on features are true regardless of modules or role', () => {
    const ctx = makeCtx({ enabledModules: new Set() });
    assert.strictEqual(canSeeFeature(ctx, 'dashboard'), true);
    assert.strictEqual(canSeeFeature(ctx, 'reports'), true);
    assert.strictEqual(ALWAYS_ON.has('dashboard'), true);
    assert.strictEqual(ALWAYS_ON.has('reports'), true);
  });

  test('unknown feature key returns true (legacy: unknown keys allowed)', () => {
    const ctx = makeCtx({ enabledModules: new Set() });
    assert.strictEqual(canSeeFeature(ctx, 'totally-unknown-key'), true);
  });

  test('crm_leads follows the crm module gate', () => {
    const ctxDisabled = makeCtx({ role: 'member', enabledModules: new Set() });
    assert.strictEqual(canSeeFeature(ctxDisabled, 'crm_leads'), false);

    const ctxEnabled = makeCtx({ role: 'member', enabledModules: new Set(['crm']) });
    assert.strictEqual(canSeeFeature(ctxEnabled, 'crm_leads'), true);
  });

  test('a partner key maps to crm_partner, not crm', () => {
    const ctx = makeCtx({ role: 'member', enabledModules: new Set(['crm']) }); // crm_partner not enabled
    assert.strictEqual(canSeeFeature(ctx, 'crm_partners'), false);
  });

  test('a role rule with allowed:false hides the feature for a member', () => {
    const ctx = makeCtx({
      role: 'member',
      enabledModules: new Set(['crm']),
      featureRules: [
        { subjectType: 'role', subjectKey: 'member', featureKey: 'crm_leads', allowed: false },
      ],
    });
    assert.strictEqual(canSeeFeature(ctx, 'crm_leads'), false);
  });

  test('a user rule with allowed:true beats a role rule with allowed:false', () => {
    const ctx = makeCtx({
      role: 'member',
      enabledModules: new Set(['crm']),
      featureRules: [
        { subjectType: 'role', subjectKey: 'member', featureKey: 'crm_leads', allowed: false },
        { subjectType: 'user', subjectKey: 'user-1', featureKey: 'crm_leads', allowed: true },
      ],
    });
    assert.strictEqual(canSeeFeature(ctx, 'crm_leads'), true);
  });

  test('owner/admin ignore role/user feature rules but are still blocked by a disabled module', () => {
    const disallowingRule = [
      { subjectType: 'role', subjectKey: 'owner', featureKey: 'crm_leads', allowed: false },
    ];

    const ctxModuleDisabled = makeCtx({
      role: 'owner',
      enabledModules: new Set(),
      featureRules: disallowingRule,
    });
    assert.strictEqual(canSeeFeature(ctxModuleDisabled, 'crm_leads'), false);

    const ctxModuleEnabled = makeCtx({
      role: 'owner',
      enabledModules: new Set(['crm']),
      featureRules: disallowingRule,
    });
    assert.strictEqual(canSeeFeature(ctxModuleEnabled, 'crm_leads'), true);
  });
});

describe('MODULE_KEYS coverage', () => {
  test('every module key maps to itself in FEATURE_MODULE', () => {
    for (const key of MODULE_KEYS) {
      assert.strictEqual(FEATURE_MODULE[key], key);
    }
  });
});
