// v1.15.0: private in-app feedback. Anyone signed in (blocked companies
// included) sends Idea / Problem / Praise with an optional rating; only the
// platform owner reads it. The same scenarios run against production in an
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
const migFile = fs.readdirSync(migDir).find((f) => f.endsWith('_platform_feedback.sql'));
const sql = migFile ? read('supabase', 'migrations', migFile) : '';
const fnBody = (name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  return sql.slice(start, sql.indexOf('$function$;', start));
};

describe('migration: the table is private', () => {
  test('RLS on, no grants to anon or authenticated, kinds/rating/message/page constrained', () => {
    assert.ok(migFile, 'migration file exists');
    assert.match(sql, /create table if not exists public\.platform_feedback \(/);
    assert.match(sql, /user_id uuid references auth\.users\(id\) on delete set null/);
    assert.match(sql, /kind text not null check \(kind in \('idea', 'problem', 'praise'\)\)/);
    assert.match(sql, /rating smallint check \(rating between 1 and 5\)/);
    assert.match(sql, /check \(char_length\(regexp_replace\(message, '\^\x5cs\+\|\x5cs\+\$', '', 'g'\)\) between 1 and 2000\)/);
    assert.match(sql, /alter table public\.platform_feedback enable row level security;/);
    assert.match(sql, /revoke all on table public\.platform_feedback from public, anon, authenticated;/);
    assert.doesNotMatch(sql, /create policy/i);
  });
});

describe('migration: submit_feedback', () => {
  test('stamps the sender from their own users row (not auth_org_id), so blocked companies can send', () => {
    const f = fnBody('submit_feedback');
    assert.match(f, /security definer/);
    assert.match(f, /select u\.org_id, u\.role into v_org, v_role from public\.users u where u\.id = v_uid;/);
    assert.doesNotMatch(f, /auth_org_id/);
    assert.match(f, /values \(v_uid, v_org, v_role, p_kind, p_rating, v_msg, v_page\)/);
  });

  test('checks kind, rating, trimmed message length and the 10-per-24h limit', () => {
    const f = fnBody('submit_feedback');
    assert.match(f, /p_kind not in \('idea', 'problem', 'praise'\)/);
    assert.match(f, /p_rating < 1 or p_rating > 5/);
    assert.match(f, /v_msg text := regexp_replace\(coalesce\(p_message, ''\), '\^\x5cs\+\|\x5cs\+\$', '', 'g'\);/);
    assert.match(f, /char_length\(v_msg\) < 1 or char_length\(v_msg\) > 2000/);
    assert.match(f, /f\.created_at > now\(\) - interval '24 hours'\) >= 10/);
  });

  test('keeps only on-site page paths', () => {
    assert.match(fnBody('submit_feedback'), /v_page := case when p_page like '\/%' and p_page not like '\/\/%' and position\(chr\(92\) in p_page\) = 0 then left\(p_page, 300\) else null end;/);
  });

  test('notifies every platform admin in their own org, in-app only', () => {
    const f = fnBody('submit_feedback');
    assert.match(f, /insert into public\.notifications \(org_id, user_id, title, body, module, entity_type, entity_id, channel, status, email_status\)/);
    assert.match(f, /from public\.platform_admins pa join public\.users u on u\.id = pa\.user_id/);
    assert.match(f, /'platform', 'feedback', v_id, 'in_app', 'unread', 'none'/);
  });
});

describe('migration: platform owner functions', () => {
  test('list and mark-read are for the platform admin only; list survives deleted accounts', () => {
    for (const name of ['platform_feedback_list', 'platform_feedback_mark_read']) {
      assert.match(fnBody(name), /if not public\.is_platform_admin\(\) then\s+raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';/, name);
    }
    const l = fnBody('platform_feedback_list');
    assert.match(l, /left join public\.users u on u\.id = f\.user_id/);
    assert.match(l, /left join public\.organizations o on o\.id = f\.org_id/);
    assert.match(l, /order by f\.created_at desc\s+limit 500;/);
  });

  test('grants: signed-in users only', () => {
    for (const sig of ['submit_feedback(text, int, text, text)', 'platform_feedback_list(boolean, text)', 'platform_feedback_mark_read(uuid, boolean)']) {
      assert.ok(sql.includes(`revoke all on function public.${sig} from public, anon;`), sig);
      assert.ok(sql.includes(`grant execute on function public.${sig} to authenticated;`), sig);
    }
  });
});
