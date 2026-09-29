// v1.7.0: the developer role (owner decision 2026-09-27). Read/write on the
// developer tools, read-only on organisation configuration, nothing else
// beyond a member. Static checks over the migration, the legacy screens and
// the new-stack settings gate.  Run: node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

describe('migration: developer tools', () => {
  const sql = read('supabase', 'migrations', '20260929080000_developer_tools_access.sql');

  test('the helper admits owner, admin and developer, never an exited user, and not anon', () => {
    assert.match(sql, /u\.role in \('owner', 'admin', 'developer'\)/);
    assert.match(sql, /coalesce\(u\.status, 'active'\) <> 'exited'/);
    assert.match(sql, /security definer\s+set search_path to 'public'/);
    assert.match(sql, /revoke all on function public\.can_manage_developer_tools\(\) from public, anon;/);
  });

  test('all nine policies are recreated on the helper, none still on is_org_admin()', () => {
    const creates = [...sql.matchAll(/create policy (\w+) on public\.(\w+)/g)].map(m => `${m[2]}.${m[1]}`).sort();
    assert.deepEqual(creates, [
      'api_keys.api_keys_delete', 'api_keys.api_keys_insert', 'api_keys.api_keys_select', 'api_keys.api_keys_update',
      'webhook_deliveries.webhook_deliveries_select',
      'webhook_endpoints.webhook_endpoints_delete', 'webhook_endpoints.webhook_endpoints_insert',
      'webhook_endpoints.webhook_endpoints_select', 'webhook_endpoints.webhook_endpoints_update',
    ]);
    const bodies = sql.split('create policy ').slice(1);
    for (const b of bodies) {
      assert.match(b, /\(org_id in \(select auth_user_org_ids\(\)\)\) and can_manage_developer_tools\(\)/);
      assert.doesNotMatch(b.split(';')[0], /is_org_admin/);
    }
  });

  test('insert still stamps the caller, and deliveries stay read-only', () => {
    assert.match(sql, /api_keys_insert[\s\S]*?\(created_by = auth\.uid\(\)\) and \(acting_user_id = auth\.uid\(\)\)/);
    assert.match(sql, /webhook_endpoints_insert[\s\S]*?\(created_by = auth\.uid\(\)\)/);
    assert.doesNotMatch(sql, /on public\.webhook_deliveries\s+for (insert|update|delete|all)/);
  });
});

describe('assignable', () => {
  test('the Users screen offers Developer in the filter, the role change and the invite', () => {
    const users = read('public', 'views', 'settings', 'users.js');
    assert.equal((users.match(/value="developer"/g) || []).length, 3);
    assert.match(users, /developer: 'success'/);
  });

  test('the server accepts it on invite and bulk import, and the CSV import too', () => {
    assert.match(read('server', 'legacy', 'create-org.js'), /allowedRoles = \["owner", "admin", "developer", "manager", "member"\]/);
    assert.match(read('server', 'legacy', 'bulk-import.js'), /\["owner", "admin", "developer", "manager", "member"\]\.includes\(row\.role\)/);
    assert.match(read('public', 'views', 'employees', 'import.js'), /validRoles = \['owner', 'admin', 'developer', 'manager', 'member'\]/);
  });
});

describe('where a developer can go', () => {
  test('the Admin button shows for developers; the feature-access bypass stays owner/admin', () => {
    const html = read('public', 'index.html');
    assert.match(html, /const canOpenAdminPanel = isAdmin \|\| userRole === 'developer';/);
    assert.match(html, /const isAdmin = \['owner', 'admin'\]\.includes\(userRole\);/);
  });

  test('the Admin panel shows a developer only their tools and read-only configuration', () => {
    const hub = read('public', 'views', 'admin', 'index.js');
    assert.match(hub, /\]\.filter\(s => !isDeveloper \|\| s\.developer\);/);
    const devCards = [...hub.matchAll(/title: '([^']+)'[^\n]*developer: true/g)].map(m => m[1]).sort();
    assert.deepEqual(devCards, ['Audit Log', 'Integrations', 'Modules & roles', 'Organization Settings']);
    // Never: users (member deletion), leave, expense (financial), helpdesk, announcements.
    for (const t of ['User Management', 'Leave Configuration', 'Expense Categories', 'Helpdesk Categories', 'Announcements']) {
      assert.doesNotMatch(hub, new RegExp(`title: '${t}'[^\\n]*developer: true`), t);
    }
  });

  test('the audit log is offered to developers wherever it is linked', () => {
    assert.match(read('public', 'views', 'reports', 'index.js'), /route: '#\/audit', roles: \['owner', 'admin', 'developer'\]/);
    assert.match(read('public', 'views', 'audit', 'log.js'), /\['owner', 'admin', 'developer'\]\.includes\(membership\.role\)/);
  });
});

describe('new-stack settings: developers read, never write', () => {
  test('the gate lets a developer view with canEdit false, and every action still needs canEdit', () => {
    const guard = read('src', 'lib', 'auth', 'admin.ts');
    assert.match(guard, /canEdit: row\.role !== "developer"/);
    assert.match(guard, /if \(result\.status === "forbidden" \|\| !result\.admin\.canEdit\) \{\n\s+throw new ActionError/);
    const actions = read('src', 'lib', 'settings', 'actions.ts');
    const all = [...actions.matchAll(/export const (\w+) = action\(/g)].map(m => m[1]);
    const gated = [...actions.matchAll(/export const (\w+) = action\([^,]+, async \(input\) => \{\n\s+const admin = await requireOrgAdmin\(\);/g)].map(m => m[1]);
    assert.deepEqual(gated, all);
  });

  test('every screen with controls is read-only for a developer', () => {
    const base = ['app', '(platform)', 'settings'];
    for (const [page, needle] of [
      ['modules/page.tsx', /<ModuleToggles modules=\{modules\} readOnly=\{!admin\.canEdit\} \/>/],
      ['access/page.tsx', /<AccessEditor data=\{data\} readOnly=\{!admin\.canEdit\} \/>/],
      ['roles/[roleId]/page.tsx', /<RoleForm key=\{role\.id\} role=\{role\} readOnly=\{!admin\.canEdit\} \/>/],
      ['roles/new/page.tsx', /if \(!admin\.canEdit\) return <ReadOnlyNotice \/>;/],
      ['roles/page.tsx', /\{admin\.canEdit \? \(\n\s+<Link href="\/settings\/roles\/new"/],
    ]) {
      assert.match(read(...base, ...page.split('/')), needle, page);
    }
    assert.match(read(...base, 'modules', 'module-toggles.tsx'), /disabled=\{readOnly \|\|/);
    assert.equal((read(...base, 'access', 'access-editor.tsx').match(/disabled=\{readOnly \|\| isPending\}/g) || []).length, 2);
    assert.match(read(...base, 'roles', 'role-form.tsx'), /<fieldset disabled=\{readOnly\}/);
    assert.match(read(...base, 'members', 'members-table.tsx'), /if \(data\.callerRole === "developer"\) return/);
  });
});
