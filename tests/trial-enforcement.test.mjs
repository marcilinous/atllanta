// v1.13.0: trial enforcement. A company whose trial has ended, or which the
// platform owner paused, is refused everywhere (auth_org_id() returns null)
// and sent to /paused; the platform owner activates, extends or pauses
// companies at /platform. The same scenarios run against production in an
// always-rolled-back probe before the migration is applied.
// Run: node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const migDir = path.join(ROOT, 'supabase', 'migrations');
const migFile = fs.readdirSync(migDir).find((f) => f.endsWith('_trial_enforcement.sql'));
const sql = migFile ? read('supabase', 'migrations', migFile) : '';
const fnBody = (name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  return sql.slice(start, sql.indexOf('$function$;', start));
};

describe('migration: the blocked rule and the checkpoint', () => {
  test('org_access_state: cancelled → paused, an ended trial → trial_ended, else ok', () => {
    assert.ok(migFile, 'migration file exists');
    const f = fnBody('org_access_state');
    assert.match(f, /when p_status = 'cancelled' then 'paused'/);
    assert.match(f, /when p_status = 'trial' and p_trial_ends_at is not null and p_trial_ends_at <= now\(\) then 'trial_ended'/);
    assert.match(f, /else 'ok'/);
  });

  test('all existing companies become active; the extension counter exists', () => {
    assert.match(sql, /alter table public\.organizations add column if not exists trial_extended_days int not null default 0;/);
    assert.match(sql, /update public\.organizations set payment_status = 'active' where payment_status <> 'active';/);
  });

  test('auth_org_id keeps its shape and returns nothing for a blocked company, except for the platform admin', () => {
    const f = fnBody('auth_org_id');
    assert.match(f, /returns uuid/);
    assert.match(f, /stable security definer/);
    assert.match(f, /set search_path to ''/);
    assert.match(f, /public\.org_access_state\(o\.payment_status, o\.trial_ends_at\) = 'ok'/);
    assert.match(f, /or public\.is_platform_admin\(\)/);
  });

  test('my_org_access explains the block without going through auth_org_id', () => {
    const f = fnBody('my_org_access');
    assert.match(f, /returns table\(state text, org_name text, trial_ends_at timestamptz, role text\)/);
    assert.match(f, /where u\.id = auth\.uid\(\)/);
    assert.doesNotMatch(f, /auth_org_id/);
    assert.match(sql, /grant execute on function public\.my_org_access\(\) to authenticated;/);
  });
});

describe('migration: the billing guard', () => {
  test('protects every billing and trial column; exempts server code and the platform admin; credits may only go down', () => {
    const g = fnBody('organizations_guard_billing_fields');
    assert.match(g, /if auth\.uid\(\) is null or public\.is_platform_admin\(\) then\s+return new;/);
    for (const col of ['plan_tier', 'payment_status', 'org_type', 'partner_crm_enabled', 'trial_started_at', 'trial_ends_at',
      'trial_extended_days', 'max_trial_extension_days', 'trial_candidate_cap', 'credits_included_monthly',
      'credit_overage_mode', 'commission_percent']) {
      assert.match(g, new RegExp(`new\\.${col} is distinct from old\\.${col}`), col);
    }
    assert.match(g, /coalesce\(new\.credits_balance, 0\) > coalesce\(old\.credits_balance, 0\)/);
    assert.match(g, /'Billing and trial settings are managed by Atllanta' using errcode = '42501'/);
    assert.match(sql, /create trigger trg_organizations_guard_billing_fields\s+before update on public\.organizations/);
  });
});

describe('migration: platform functions', () => {
  test('each checks the platform admin first and is only for signed-in users', () => {
    for (const [name, sig] of [['platform_orgs', ''], ['platform_activate_org', 'uuid'], ['platform_extend_trial', 'uuid, int'], ['platform_pause_org', 'uuid']]) {
      const f = fnBody(name);
      assert.match(f, /security definer/, name);
      assert.match(f, /if not public\.is_platform_admin\(\) then\s+raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';/, name);
      assert.ok(sql.includes(`revoke all on function public.${name}(${sig}) from public, anon;`), `${name} revoked from anon`);
      assert.ok(sql.includes(`grant execute on function public.${name}(${sig}) to authenticated;`), `${name} granted`);
    }
  });

  test('extending: 7/14/30 only, trials only, within the cap, from today or the old end', () => {
    const f = fnBody('platform_extend_trial');
    assert.match(f, /p_days not in \(7, 14, 30\)/);
    assert.match(f, /if v_status <> 'trial' then/);
    assert.match(f, /if v_used \+ p_days > v_cap then/);
    assert.match(f, /coalesce\(max_trial_extension_days, 30\)/);
    assert.match(f, /greatest\(coalesce\(v_ends, now\(\)\), now\(\)\) \+ make_interval\(days => p_days\)/);
  });

  test('every change is audited against the target company and published', () => {
    for (const [name, action, event] of [
      ['platform_activate_org', 'activated', 'platform.org.activated'],
      ['platform_extend_trial', 'trial_extended', 'platform.org.trial_extended'],
      ['platform_pause_org', 'paused', 'platform.org.paused'],
    ]) {
      const f = fnBody(name);
      assert.ok(f.includes(`'platform', 'organization', p_org, '${action}'`), `${name} audit`);
      assert.ok(f.includes(`'${event}'`), `${name} event`);
    }
  });
});

describe('static: shared helpers', () => {
  test('the contact shown to blocked companies is the owner\'s', async () => {
    const { PLATFORM_CONTACT } = await import('../src/lib/platform/contact.ts');
    assert.deepEqual({ ...PLATFORM_CONTACT }, {
      email: 'anchansachinv99@gmail.com',
      phone: '8073163762',
      whatsapp: 'https://wa.me/918073163762',
    });
  });

  test('access helpers ask the database as the caller, never the table directly', () => {
    const a = read('src', 'lib', 'platform', 'access.ts');
    assert.match(a, /^import "server-only";/m);
    assert.match(a, /select \* from public\.my_org_access\(\)/);
    assert.match(a, /select public\.is_platform_admin\(\) as is_admin/);
    assert.match(a, /withTransaction\(\{ id: userId \}/);
    assert.doesNotMatch(a, /from platform_admins|platformAdmins|service_?role/i);
  });

  test('sign-out is a server action that clears the session and goes to /login', () => {
    const s = read('src', 'lib', 'auth', 'sign-out.ts');
    assert.match(s, /^"use server";/);
    assert.match(s, /await supabase\.auth\.signOut\(\);/);
    assert.match(s, /redirect\("\/login"\);/);
  });
});

describe('static: /paused', () => {
  const page = () => read('app', '(auth)', 'paused', 'page.tsx');

  test('routes the signed-out, the company-less and the allowed away; never loops', () => {
    const p = page();
    assert.match(p, /if \(!user\) redirect\("\/login"\);/);
    assert.match(p, /if \(!access\) redirect\("\/start"\);/);
    assert.match(p, /if \(access\.state === "ok"\) redirect\("\/"\);/);
  });

  test('only owners and admins see the contact; everyone can sign out', () => {
    const p = page();
    assert.match(p, /const canContact = access\.role === "owner" \|\| access\.role === "admin";/);
    assert.match(p, /PLATFORM_CONTACT\.email/);
    assert.match(p, /PLATFORM_CONTACT\.phone/);
    assert.match(p, /PLATFORM_CONTACT\.whatsapp/);
    assert.match(p, /Please ask your admin\./);
    assert.match(p, /<SignOutButton \/>/);
    const b = read('app', '(auth)', 'paused', 'sign-out-button.tsx');
    assert.match(b, /^"use client";/);
    assert.match(b, /signOut\(\)/);
  });
});

describe('schema mirror', () => {
  test('Drizzle knows trial_extended_days', () => {
    assert.match(read('src', 'db', 'schema', 'platform.ts'), /trialExtendedDays: integer\("trial_extended_days"\)\.notNull\(\)\.default\(0\),/);
  });
});
