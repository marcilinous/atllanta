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
    const lock = /perform pg_advisory_xact_lock\(hashtextextended\('submit_feedback:' \|\| v_uid::text, 0\)\);/;
    assert.match(f, lock);
    assert.ok(f.search(lock) < f.indexOf('select count(*) from public.platform_feedback'), 'lock before count');
  });

  test('keeps only on-site page paths', () => {
    assert.match(fnBody('submit_feedback'), /v_page := case when p_page like '\/%' and p_page not like '\/\/%' and position\(chr\(92\) in p_page\) = 0 and p_page !~ '\[\[:cntrl:\]\]' then left\(p_page, 300\) else null end;/);
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

describe('schemas', () => {
  const ok = { kind: 'idea', rating: null, message: 'More reports please', page: '/hrms/leave' };

  test('accepts the three kinds, a 1–5 or empty rating, and a trimmed 1–2000 message', async () => {
    const { submitFeedbackSchema, FEEDBACK_KINDS } = await import('../src/lib/platform/feedback/schemas.ts');
    assert.deepEqual(FEEDBACK_KINDS.map((k) => k.key), ['idea', 'problem', 'praise']);
    assert.equal(submitFeedbackSchema.parse({ ...ok, message: '  hi  ' }).message, 'hi');
    assert.ok(submitFeedbackSchema.safeParse({ ...ok, rating: 5 }).success);
    assert.ok(submitFeedbackSchema.safeParse({ ...ok, message: 'a'.repeat(2000) }).success);
    for (const bad of [{ ...ok, kind: 'bug' }, { ...ok, rating: 0 }, { ...ok, rating: 6 }, { ...ok, rating: 2.5 },
      { ...ok, message: '   \n  ' }, { ...ok, message: 'a'.repeat(2001) }]) {
      assert.equal(submitFeedbackSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
    }
  });

  test('never takes a sender, company or role from input', async () => {
    const { submitFeedbackSchema } = await import('../src/lib/platform/feedback/schemas.ts');
    const r = submitFeedbackSchema.parse({ ...ok, userId: 'x', orgId: 'y', role: 'owner' });
    for (const k of ['userId', 'orgId', 'role']) assert.equal(k in r, false, k);
  });

  test('safeFrom keeps on-site paths only', async () => {
    const { safeFrom } = await import('../src/lib/platform/feedback/schemas.ts');
    assert.equal(safeFrom('/hrms/leave'), '/hrms/leave');
    assert.equal(safeFrom('/#/dashboard'), '/#/dashboard');
    for (const bad of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '', null, undefined, 'x'.repeat(301)]) {
      assert.equal(safeFrom(bad), null, String(bad).slice(0, 30));
    }
  });

  test('mark-read needs a real id', async () => {
    const { markReadSchema } = await import('../src/lib/platform/feedback/schemas.ts');
    assert.ok(markReadSchema.safeParse({ id: '7b0e6c1e-1234-4abc-8def-0123456789ab', read: true }).success);
    assert.equal(markReadSchema.safeParse({ id: 'x', read: true }).success, false);
  });
});

describe('only the functions\' own refusals reach the screen', () => {
  test('allow-listed messages pass; anything else is hidden', async () => {
    const { explainFeedbackError } = await import('../src/lib/platform/feedback/explain.ts');
    const e = (code, message) => ({ code, message });
    assert.equal(explainFeedbackError(e('22023', "You've sent a lot of feedback today — please try again tomorrow")), "You've sent a lot of feedback today — please try again tomorrow");
    assert.equal(explainFeedbackError({ cause: e('22023', 'Write a message of up to 2,000 characters') }), 'Write a message of up to 2,000 characters');
    assert.equal(explainFeedbackError(e('42501', 'Only the Atllanta platform owner can do that')), 'Only the Atllanta platform owner can do that');
    assert.equal(explainFeedbackError(e('42501', 'permission denied for table platform_feedback')), null);
    assert.equal(explainFeedbackError(e('XX000', 'boom')), null);
  });
});

describe('static: actions', () => {
  test('run the functions as the caller, without the service role', () => {
    const s = read('src', 'lib', 'platform', 'feedback', 'actions.ts');
    assert.match(s, /^"use server";/);
    assert.match(s, /select public\.submit_feedback\(/);
    assert.match(s, /select public\.platform_feedback_mark_read\(/);
    assert.match(s, /withTransaction\(\{ id: user\.id \}/);
    assert.match(s, /revalidatePath\("\/platform\/feedback"\)/);
    assert.doesNotMatch(s, /service_?role/i);
  });
});

describe('static: platform feedback screen', () => {
  test('the platform layout checks the admin once and shows Companies / Feedback tabs with the unread count', () => {
    const l = read('app', '(platform)', 'platform', 'layout.tsx');
    assert.match(l, /if \(!user\) redirect\("\/login"\);/);
    assert.match(l, /if \(!\(await isPlatformAdmin\(user\.id\)\)\) notFound\(\);/);
    assert.match(l, /select count\(\*\)::int as n from public\.platform_feedback_list\(true\)/);
    assert.match(l, /<PlatformNav unread=\{unread\} \/>/);
    const n = read('app', '(platform)', 'platform', 'platform-nav.tsx');
    assert.match(n, /href: "\/platform"/);
    assert.match(n, /href: "\/platform\/feedback"/);
  });

  test('the feedback page reads through platform_feedback_list with filters from the query string', () => {
    const p = read('app', '(platform)', 'platform', 'feedback', 'page.tsx');
    assert.match(p, /select \* from public\.platform_feedback_list\(\$\{onlyUnread\}, \$\{kind\}\)/);
    assert.match(p, /const kind = FEEDBACK_KINDS\.some\(\(k\) => k\.key === sp\.kind\) \? \(sp\.kind \?\? null\) : null;/);
    const c = read('app', '(platform)', 'platform', 'feedback', 'feedback-list.tsx');
    assert.match(c, /^"use client";/);
    assert.match(c, /markFeedbackRead\(\{ id: f\.id, read: !f\.readAt \}\)/);
    assert.match(c, /whitespace-pre-wrap/);
  });
});

describe('static: sending', () => {
  test('/feedback: signed-out to /login, no account to /start, and blocked companies are NOT sent to /paused', () => {
    const p = read('app', '(auth)', 'feedback', 'page.tsx');
    assert.match(p, /if \(!user\) redirect\("\/login"\);/);
    assert.match(p, /if \(!access\) redirect\("\/start"\);/);
    assert.doesNotMatch(p, /redirect\("\/paused"\)/);
    assert.match(p, /const from = safeFrom\(sp\.from\);/);
  });

  test('the form sends once (disabled while pending), keeps the page, and thanks the sender', () => {
    const f = read('app', '(auth)', 'feedback', 'feedback-form.tsx');
    assert.match(f, /^"use client";/);
    assert.match(f, /await submitFeedback\(\{ kind, rating, message, page: from \}\)/);
    assert.match(f, /disabled=\{[^}]*isPending/);
    assert.match(f, /Thanks — this goes straight to the Atllanta team\./);
    assert.match(f, /maxLength=\{2000\}/);
  });

  test('entry points: legacy account menu, /paused, and the new-stack workspace', () => {
    const html = read('public', 'index.html');
    assert.match(html, /id="feedback-menu-btn"/);
    assert.match(html, /window\.location\.assign\('\/feedback\?from=' \+ encodeURIComponent\('\/' \+ \(location\.hash \|\| ''\)\)\)/);
    assert.match(read('app', '(auth)', 'paused', 'page.tsx'), /href="\/feedback\?from=\/paused"/);
    assert.match(read('app', '(dashboard)', 'layout.tsx'), /href="\/feedback\?from=\/hrms"/);
  });

  test('/feedback is never served from the service-worker cache', () => {
    const list = read('public', 'sw.js').match(/const NETWORK_ONLY_PREFIXES = \[([^\]]*)\]/)[1];
    assert.match(list, /"\/feedback"/);
  });
});
