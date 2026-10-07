// Phase 4 item 3 (assets, v1.17.0 preview): the new-stack assets logic.
// Behaviour tests for the input schemas, and static checks that every action
// passes both gates, is refused to anyone but an owner or admin, never takes
// the org, the creator or the assigner from input, does each assign/return in
// one transaction under the v1.16.2 rules, and publishes the legacy events.
// Run: node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAssetSchema,
  updateAssetSchema,
  assignAssetSchema,
  returnAssetSchema,
  deleteAssetSchema,
  registerFilterSchema,
  ASSET_MAX_COST,
  ASSET_TYPES,
  ASSET_STATUSES,
} from '../src/lib/hrms/assets/schemas.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const UUID = '7b0e6c1e-1234-4abc-8def-0123456789ab';
const asset = { name: 'MacBook Pro 14"', type: 'Laptop', serialNumber: '', purchaseDate: '', purchaseCost: '', warrantyEnd: '', notes: '' };

describe('input schemas', () => {
  test('the type and status lists are the database schema\'s', () => {
    const hrms = read('src', 'db', 'schema', 'hrms.ts');
    const list = (name) => JSON.parse(hrms.match(new RegExp(`export const ${name} = (\\[[^\\]]*\\]) as const;`))[1]);
    assert.deepEqual([...ASSET_TYPES], list('ASSET_TYPES'));
    assert.deepEqual([...ASSET_STATUSES], list('ASSET_STATUSES'));
  });

  test('an asset needs a name and one of the eight types; everything else is optional', () => {
    const ok = createAssetSchema.parse(asset);
    assert.equal(ok.name, 'MacBook Pro 14"');
    for (const k of ['serialNumber', 'purchaseDate', 'purchaseCost', 'warrantyEnd', 'notes']) assert.equal(ok[k], null, k);
    assert.ok(!createAssetSchema.safeParse({ ...asset, name: '  ' }).success, 'blank name');
    assert.ok(!createAssetSchema.safeParse({ ...asset, name: 'x'.repeat(201) }).success, 'long name');
    assert.ok(!createAssetSchema.safeParse({ ...asset, type: 'Car' }).success, 'unknown type');
    for (const type of ['Laptop', 'Phone', 'Access Card', 'Monitor', 'Keyboard', 'Mouse', 'Headset', 'Other']) {
      assert.ok(createAssetSchema.safeParse({ ...asset, type }).success, type);
    }
  });

  test('dates are real calendar dates; cost is not negative, at most two decimals, and bounded', () => {
    const full = createAssetSchema.parse({ ...asset, purchaseDate: '2026-01-31', warrantyEnd: '2028-01-31', purchaseCost: '1200.50' });
    assert.equal(full.purchaseDate, '2026-01-31');
    assert.equal(full.purchaseCost, '1200.50');
    assert.equal(createAssetSchema.parse({ ...asset, purchaseCost: '0' }).purchaseCost, '0', 'a free asset is fine');
    for (const purchaseCost of ['-1', '12.345', 'abc', '1e3']) {
      assert.ok(!createAssetSchema.safeParse({ ...asset, purchaseCost }).success, purchaseCost);
    }
    assert.ok(!createAssetSchema.safeParse({ ...asset, purchaseCost: String(ASSET_MAX_COST + 1) }).success, 'too large');
    for (const d of ['2026-02-30', '31/01/2026']) {
      assert.ok(!createAssetSchema.safeParse({ ...asset, purchaseDate: d }).success, d);
      assert.ok(!createAssetSchema.safeParse({ ...asset, warrantyEnd: d }).success, d);
    }
  });

  test('no org, creator, holder or status is accepted when adding; edits set only available, maintenance or retired', () => {
    const parsed = createAssetSchema.parse({ ...asset, orgId: UUID, createdBy: UUID, assignedTo: UUID, status: 'assigned' });
    for (const k of ['orgId', 'createdBy', 'assignedTo', 'status']) assert.equal(k in parsed, false, k);
    assert.ok(updateAssetSchema.safeParse({ ...asset, assetId: UUID, status: 'maintenance' }).success);
    assert.ok(!updateAssetSchema.safeParse({ ...asset, assetId: UUID, status: 'assigned' }).success, 'assigning is its own action');
    assert.equal('assignedTo' in updateAssetSchema.parse({ ...asset, assetId: UUID, status: 'available', assignedTo: UUID }), false);
  });

  test('assign names an asset and a person; return and delete name an asset', () => {
    assert.ok(assignAssetSchema.safeParse({ assetId: UUID, userId: UUID }).success);
    assert.ok(!assignAssetSchema.safeParse({ assetId: UUID, userId: '' }).success, 'choose a person');
    assert.ok(!assignAssetSchema.safeParse({ assetId: UUID, userId: UUID, notes: 'x'.repeat(501) }).success);
    assert.equal('assignedBy' in assignAssetSchema.parse({ assetId: UUID, userId: UUID, assignedBy: UUID }), false);
    for (const s of [returnAssetSchema, deleteAssetSchema]) {
      assert.ok(s.safeParse({ assetId: UUID }).success);
      assert.ok(!s.safeParse({ assetId: 'x' }).success);
    }
  });

  test('register filters fall back to "all" on anything unknown', () => {
    assert.deepEqual(registerFilterSchema.parse({}), { q: '', type: '', status: '' });
    assert.deepEqual(registerFilterSchema.parse({ q: ' mac ', type: 'Laptop', status: 'assigned' }), { q: 'mac', type: 'Laptop', status: 'assigned' });
    assert.deepEqual(registerFilterSchema.parse({ q: ['a', 'b'], type: 'Car', status: 'gone' }), { q: '', type: '', status: '' });
    assert.equal(registerFilterSchema.parse({ q: 'x'.repeat(300) }).q.length, 100);
  });
});

describe('static: the actions', () => {
  const src = read('src', 'lib', 'hrms', 'assets', 'actions.ts');
  const body = (name) => {
    const start = src.indexOf(`export const ${name} =`);
    assert.ok(start >= 0, name);
    const next = src.indexOf('\nexport ', start + 1);
    return src.slice(start, next > 0 ? next : undefined);
  };
  const ACTIONS = { createAsset: 'create', updateAsset: 'edit', assignAsset: 'edit', returnAsset: 'edit', deleteAsset: 'delete' };

  test('every action passes both gates for People and is for owners and admins only', () => {
    assert.match(src, /async function requireAssetAdmin\(permission: Permission\)[\s\S]*requireFeature\("people", "people", permission\)[\s\S]*ctx\.role !== "owner" && ctx\.role !== "admin"/);
    for (const [name, perm] of Object.entries(ACTIONS)) {
      assert.match(body(name), new RegExp(`requireAssetAdmin\\("${perm}"\\)`), name);
    }
  });

  test('org, creator, holder and assigner come from the server or the database', () => {
    for (const name of Object.keys(ACTIONS)) {
      assert.doesNotMatch(body(name), /input\.(orgId|createdBy|assignedBy)\b/, name);
    }
    assert.match(body('createAsset'), /orgId: ctx\.orgId/);
    assert.doesNotMatch(src, /createdBy:|assignedBy:/, 'the database stamps the creator and the assigner');
    assert.doesNotMatch(src, /service_?role|SERVICE_ROLE/i);
  });

  test('assign and return each change the asset and its history in one transaction, in the guard\'s order', () => {
    const assign = body('assignAsset');
    assert.match(assign, /withTransaction\(\{ id: ctx\.userId \}[\s\S]*\.update\(assets\)[\s\S]*inArray\(assets\.status, \["available", "maintenance"\]\)[\s\S]*\.insert\(assetAssignments\)/);
    const ret = body('returnAsset');
    assert.match(ret, /withTransaction\(\{ id: ctx\.userId \}[\s\S]*\.update\(assets\)[\s\S]*eq\(assets\.status, "assigned"\)[\s\S]*\.update\(assetAssignments\)[\s\S]*isNull\(assetAssignments\.returnedAt\)/);
  });

  test('an edit never assigns, and changes the status only while the asset is not held', () => {
    const upd = body('updateAsset');
    assert.doesNotMatch(upd, /assignedTo/);
    assert.match(upd, /current\.status === "assigned"/);
  });

  test('a held asset is never deleted; database refusals are explained', () => {
    assert.match(body('deleteAsset'), /ne\(assets\.status, "assigned"\)/);
    for (const name of ['assignAsset', 'returnAsset', 'updateAsset', 'createAsset', 'deleteAsset']) {
      assert.match(body(name), /refusal\(err/, name);
    }
    assert.match(src, /hasPgCode\(err, "42501"\)/);
    assert.match(src, /hasPgCode\(err, "23505"\)/);
  });

  test('events keep the legacy names and payloads', () => {
    assert.match(body('createAsset'), /"people\.asset\.created", \{\s*asset_id: created\.id,\s*name: input\.name,\s*type: input\.type/);
    assert.match(body('assignAsset'), /"people\.asset\.assigned", \{\s*asset_id: result\.id,\s*name: result\.name,\s*assigned_to: input\.userId,\s*assigned_name:/);
    assert.match(body('returnAsset'), /"people\.asset\.returned", \{\s*asset_id: result\.id,\s*name: result\.name/);
  });

  test('every change is audited under module people', () => {
    for (const name of Object.keys(ACTIONS)) {
      assert.match(body(name), /await audit\(\{[\s\S]*module: "people"/, name);
    }
  });
});

describe('static: the screens', () => {
  test('My assets is self-service; the register is People, owners and admins only', () => {
    const mine = read('app', '(dashboard)', 'hrms', 'assets', 'page.tsx');
    assert.match(mine, /featureContext\("me", "me", "view"\)/);
    for (const p of [['register', 'page.tsx'], ['register', '[assetId]', 'page.tsx']]) {
      const page = read('app', '(dashboard)', 'hrms', 'assets', ...p);
      assert.match(page, /assetAdminContext\(\)/, p.join('/'));
    }
    const q = read('src', 'lib', 'hrms', 'assets', 'queries.ts');
    assert.match(q, /featureContext\("people", "people", "view"\)[\s\S]*ctx\.role === "owner" \|\| ctx\.role === "admin"/);
  });

  test('My assets reads only what the caller holds; people to assign exclude anyone who has left', () => {
    const q = read('src', 'lib', 'hrms', 'assets', 'queries.ts');
    assert.match(q, /eq\(assets\.assignedTo, ctx\.userId\)/);
    assert.match(q, /ne\(users\.status, "exited"\)/);
  });
});
