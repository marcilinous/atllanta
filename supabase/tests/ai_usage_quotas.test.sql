-- Tests for the AI usage & quota database layer (spec §4, §9).
-- Run ONLY after the migration SQL, inside a transaction that is rolled back:
--   begin; <supabase/pending/ai_usage_quotas.sql> <this file> rollback;
-- Every check raises an exception on failure. A clean run returns one row:
--   result = 'all ai usage tests passed'
-- It uses real users; the rollback discards every change.

-- 0. Context --------------------------------------------------------------
do $$
declare
  v_p uuid; v_org_a uuid; v_admin_a uuid; v_member_a uuid; v_org_b uuid; v_admin_b uuid;
begin
  select a.id into v_p from auth.users a where lower(a.email) = 'anchansachinv99@gmail.com';
  select o.id into v_org_a from organizations o
   where exists (select 1 from users u where u.org_id = o.id and u.role in ('owner','admin') and u.status = 'active' and u.id <> v_p)
     and exists (select 1 from users u where u.org_id = o.id and u.role = 'member' and u.status = 'active')
   order by o.created_at limit 1;
  select u.id into v_admin_a from users u
   where u.org_id = v_org_a and u.role in ('owner','admin') and u.status = 'active' and u.id <> v_p
   order by u.created_at limit 1;
  select u.id into v_member_a from users u
   where u.org_id = v_org_a and u.role = 'member' and u.status = 'active'
   order by u.created_at limit 1;
  select u.org_id, u.id into v_org_b, v_admin_b from users u
   where u.org_id <> v_org_a and u.role in ('owner','admin') and u.status = 'active' and u.id <> v_p
   order by u.created_at limit 1;
  if v_p is null or v_org_a is null or v_admin_a is null or v_member_a is null or v_admin_b is null then
    raise exception '0: test context incomplete (p=%, org_a=%, admin_a=%, member_a=%, admin_b=%)', v_p, v_org_a, v_admin_a, v_member_a, v_admin_b;
  end if;
  perform set_config('t.p', v_p::text, true);
  perform set_config('t.org_a', v_org_a::text, true);
  perform set_config('t.admin_a', v_admin_a::text, true);
  perform set_config('t.member_a', v_member_a::text, true);
  perform set_config('t.org_b', v_org_b::text, true);
  perform set_config('t.admin_b', v_admin_b::text, true);
end $$;

-- 1. Seed and new-organisation trigger ------------------------------------
do $$
declare v_n int; v_org uuid;
begin
  select count(*) into v_n from organizations o left join ai_org_quotas q on q.org_id = o.id where q.org_id is null;
  if v_n <> 0 then raise exception '1a: % organisations have no quota row', v_n; end if;
  select count(*) into v_n from ai_org_quotas where monthly_tokens <> 2000000 or overage_mode <> 'hard_stop';
  if v_n <> 0 then raise exception '1b: % seeded quotas are not 2000000/hard_stop', v_n; end if;
  select count(*) into v_n from organizations o
   where not exists (select 1 from ai_user_limits l where l.org_id = o.id and l.user_id is null and l.daily_tokens = 200000);
  if v_n <> 0 then raise exception '1c: % organisations lack the 200000 default daily limit', v_n; end if;
  if not exists (select 1 from platform_admins where user_id = current_setting('t.p')::uuid) then
    raise exception '1d: platform admin not seeded';
  end if;
  insert into organizations (name, org_type)
  values ('AI quota trigger test', (select org_type from organizations limit 1))
  returning id into v_org;
  if not exists (select 1 from ai_org_quotas where org_id = v_org and monthly_tokens = 2000 and overage_mode = 'hard_stop') then
    raise exception '1e: new organisation not given 2000/hard_stop';
  end if;
  if not exists (select 1 from ai_user_limits where org_id = v_org and user_id is null and daily_tokens = 200000) then
    raise exception '1f: new organisation lacks the 200000 default daily limit';
  end if;
end $$;

-- 1b. Gateway function privileges ------------------------------------------
do $$
declare f text; r text;
begin
  foreach f in array array[
    'public.ai_quota_check(uuid,uuid)',
    'public.ai_record_usage(uuid,uuid,text,text,integer,integer,text,text,text)',
    'public.ai_bot_check(uuid,uuid,text,text)'] loop
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '1g: service_role cannot execute %', f;
    end if;
    foreach r in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '1h: % can execute %', r, f;
      end if;
    end loop;
  end loop;
end $$;

-- 2. ai_record_usage --------------------------------------------------------
do $$
declare
  a uuid := current_setting('t.org_a')::uuid;
  m uuid := current_setting('t.member_a')::uuid;
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_month date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
  v_row record;
begin
  perform ai_record_usage(a, m, 'match', 'openai/gpt-oss-120b', 100, 50, 'ok', null, 'h-ok');
  select * into v_row from ai_usage where org_id = a order by id desc limit 1;
  if v_row.total_tokens is distinct from 150 or v_row.prompt_tokens is distinct from 100 or v_row.completion_tokens is distinct from 50
     or v_row.outcome is distinct from 'ok' or v_row.request_hash is distinct from 'h-ok' or v_row.user_id is distinct from m then
    raise exception '2a: ledger row wrong: %', row_to_json(v_row);
  end if;
  if (select tokens from ai_usage_org_month where org_id = a and month = v_month) is distinct from 150 then raise exception '2b: org month tokens not 150'; end if;
  if (select calls from ai_usage_org_month where org_id = a and month = v_month) is distinct from 1 then raise exception '2c: org month calls not 1'; end if;
  if (select tokens from ai_usage_user_day where user_id = m and day = v_day) is distinct from 150::bigint then
    raise exception '2d: user day tokens not 150 on the org-local date';
  end if;
  perform ai_record_usage(a, m, 'match', 'openai/gpt-oss-120b', 999, 999, 'blocked', 'user_day_exhausted', null);
  if (select tokens from ai_usage_org_month where org_id = a and month = v_month) is distinct from 150 then raise exception '2e: a blocked call added tokens'; end if;
  if (select blocked_calls from ai_usage_org_month where org_id = a and month = v_month) is distinct from 1 then raise exception '2f: a blocked call was not counted as blocked'; end if;
  if (select calls from ai_usage_user_day where user_id = m and day = v_day) is distinct from 1 then raise exception '2g: a blocked call was counted as a call'; end if;
  if (select total_tokens from ai_usage where org_id = a and outcome = 'blocked') is distinct from 0 then raise exception '2h: a blocked ledger row has tokens'; end if;
end $$;

-- 3. ai_quota_check ---------------------------------------------------------
do $$
declare
  a uuid := current_setting('t.org_a')::uuid;
  m uuid := current_setting('t.member_a')::uuid;
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_month date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
  r record;
begin
  select * into r from ai_quota_check(a, m);
  if r.allowed is not true or r.reason is not null then raise exception '3a: under quota should be allowed: %', row_to_json(r); end if;
  if r.user_limit is distinct from 200000 or r.org_quota is distinct from 2000000 or r.user_used is distinct from 150 or r.org_used is distinct from 150 then
    raise exception '3b: figures wrong: %', row_to_json(r);
  end if;
  if r.resets_day is distinct from ((v_day + 1)::timestamp at time zone 'Asia/Kolkata') then raise exception '3c: resets_day is not the next local midnight'; end if;
  if r.resets_month is distinct from ((v_month + interval '1 month')::timestamp at time zone 'Asia/Kolkata') then raise exception '3d: resets_month is not the next local 1st'; end if;

  update ai_org_quotas set monthly_tokens = 150, overage_mode = 'hard_stop' where org_id = a;
  select * into r from ai_quota_check(a, m);
  if r.allowed is not false or r.reason is distinct from 'org_month_exhausted' then raise exception '3e: org at quota should block in hard_stop: %', row_to_json(r); end if;

  update ai_org_quotas set overage_mode = 'soft_limit' where org_id = a;
  select * into r from ai_quota_check(a, m);
  if r.allowed is not true then raise exception '3f: soft_limit should allow over quota: %', row_to_json(r); end if;

  update ai_usage_user_day set tokens = 200000 where user_id = m and day = v_day;
  select * into r from ai_quota_check(a, m);
  if r.allowed is not false or r.reason is distinct from 'user_day_exhausted' then raise exception '3g: user at daily limit should block even in soft_limit: %', row_to_json(r); end if;

  insert into ai_user_limits (org_id, user_id, daily_tokens) values (a, m, 500000);
  select * into r from ai_quota_check(a, m);
  if r.allowed is not true or r.user_limit is distinct from 500000 then raise exception '3h: user override should beat the org default: %', row_to_json(r); end if;

  delete from ai_org_quotas where org_id = a;
  select * into r from ai_quota_check(a, m);
  if r.allowed is not false or r.reason is distinct from 'org_month_exhausted' or r.org_quota is distinct from 0 or r.overage_mode is distinct from 'hard_stop' then
    raise exception '3i: a missing quota row should block: %', row_to_json(r);
  end if;

  -- restore
  insert into ai_org_quotas (org_id, monthly_tokens, overage_mode) values (a, 2000000, 'hard_stop');
  delete from ai_user_limits where org_id = a and user_id = m;
  update ai_usage_user_day set tokens = 150 where user_id = m and day = v_day;
end $$;

-- 4. ai_bot_check -----------------------------------------------------------
do $$
declare
  a uuid := current_setting('t.org_a')::uuid;
  m uuid := current_setting('t.member_a')::uuid;
  r record; v_before int; v_admins int;
begin
  -- 59 non-blocked calls in the last minute (section 2 added 1 ok + 1 blocked): top up to 59 ok rows
  insert into ai_usage (org_id, user_id, feature, model, total_tokens, outcome, request_hash)
  select a, m, 'assistant', 'openai/gpt-oss-120b', 10, 'ok', 'h' || g from generate_series(1, 58) g;
  select * into r from ai_bot_check(a, m, 'assistant', 'h-new');
  if r.flagged is not false then raise exception '4a: 59 recent calls must not flag: %', row_to_json(r); end if;

  insert into ai_usage (org_id, user_id, feature, model, total_tokens, outcome, request_hash)
  values (a, m, 'assistant', 'openai/gpt-oss-120b', 10, 'ok', 'h60');
  select count(*) into v_admins from users where org_id = a and role in ('owner','admin') and status = 'active';
  select count(*) into v_before from notifications where org_id = a and title = 'AI paused: unusual activity';
  select * into r from ai_bot_check(a, m, 'assistant', 'h-new');
  if r.flagged is not true or r.reason is distinct from 'call_rate' then raise exception '4b: the 61st call in a minute must flag call_rate: %', row_to_json(r); end if;
  if r.paused_until is null or r.paused_until < now() + interval '9 minutes' or r.paused_until > now() + interval '11 minutes' then
    raise exception '4c: pause is not about 10 minutes: %', r.paused_until;
  end if;
  if (select count(*) from notifications where org_id = a and title = 'AI paused: unusual activity') - v_before <> v_admins then
    raise exception '4d: expected % owner/admin notifications', v_admins;
  end if;
  if (select (detail->>'calls_last_minute')::int from ai_user_flags where user_id = m) is distinct from 61 then
    raise exception '4e: detail.calls_last_minute should be 61';
  end if;

  select * into r from ai_quota_check(a, m);
  if r.allowed is not false or r.reason is distinct from 'paused_bot_check' or r.paused_until is null then raise exception '4f: a paused user must be blocked: %', row_to_json(r); end if;

  select * into r from ai_bot_check(a, m, 'assistant', 'h-new');
  if r.flagged is not false then raise exception '4g: an already-paused user must not be flagged again'; end if;
  if (select count(*) from ai_user_flags where user_id = m) <> 1 then raise exception '4h: expected exactly one flag'; end if;

  perform set_config('t.flag_m', (select id::text from ai_user_flags where user_id = m), true);
end $$;

do $$
declare
  a uuid := current_setting('t.org_a')::uuid;
  ad uuid := current_setting('t.admin_a')::uuid;
  r record;
begin
  insert into ai_usage (org_id, user_id, feature, model, total_tokens, outcome, request_hash)
  select a, ad, 'match', 'openai/gpt-oss-120b', 10, 'ok', 'same' from generate_series(1, 9);
  select * into r from ai_bot_check(a, ad, 'match', 'different');
  if r.flagged is not false then raise exception '4i: a different request must not count as a repeat'; end if;
  select * into r from ai_bot_check(a, ad, 'screen', 'same');
  if r.flagged is not false then raise exception '4j: the same hash under another feature must not count'; end if;
  insert into ai_usage (org_id, user_id, feature, model, total_tokens, outcome, request_hash)
  values (a, ad, 'match', 'openai/gpt-oss-120b', 0, 'blocked', 'same');
  select * into r from ai_bot_check(a, ad, 'match', 'same');
  if r.flagged is not true or r.reason is distinct from 'repeated_request' then raise exception '4k: the 10th identical request must flag: %', row_to_json(r); end if;
  if (select (detail->>'repeats')::int from ai_user_flags where user_id = ad) is distinct from 10 then raise exception '4l: detail.repeats should be 10 (blocked rows do not count)'; end if;
end $$;

select 'all ai usage tests passed' as result;
