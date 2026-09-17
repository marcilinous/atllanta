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

-- 1c. Client, helper and internal function privileges ------------------------
do $$
declare f text; r text;
begin
  -- Callable by signed-in users (each re-checks the caller inside).
  foreach f in array array[
    'public.platform_set_org_quota(uuid,bigint,text)',
    'public.ai_set_user_limit(uuid,bigint)',
    'public.ai_clear_flag(bigint)',
    'public.ai_my_usage()',
    'public.ai_org_usage(date)',
    'public.platform_org_usage(date)',
    'public.platform_org_detail(uuid,date)',
    'public.is_platform_admin()',
    'public.ai_is_org_admin_of(uuid)'] loop
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '1i: authenticated cannot execute %', f;
    end if;
    foreach r in array array['public', 'anon'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '1j: % can execute %', r, f;
      end if;
    end loop;
  end loop;
  -- Internal: only reachable from inside SECURITY DEFINER functions.
  foreach f in array array[
    'public.ai_usage_report(uuid,date,date)',
    'public.ai_org_tz(uuid)',
    'public.ai_seed_new_org()'] loop
    foreach r in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '1k: % can execute internal function %', r, f;
      end if;
    end loop;
  end loop;
end $$;

-- 1d. Table privileges ---------------------------------------------------------
do $$
declare tb text; p text;
begin
  foreach tb in array array[
    'public.platform_admins', 'public.ai_org_quotas', 'public.ai_user_limits', 'public.ai_usage',
    'public.ai_usage_org_month', 'public.ai_usage_user_day', 'public.ai_user_flags'] loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate'] loop
      if has_table_privilege('anon', tb, p) then raise exception '1l: anon has % on %', p, tb; end if;
    end loop;
    foreach p in array array['insert', 'update', 'delete', 'truncate'] loop
      if has_table_privilege('authenticated', tb, p) then raise exception '1m: authenticated has % on %', p, tb; end if;
    end loop;
    if not has_table_privilege('authenticated', tb, 'select') then raise exception '1n: authenticated lacks select on %', tb; end if;
    if not has_table_privilege('service_role', tb, 'insert') then raise exception '1o: service_role lacks insert on %', tb; end if;
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

-- 5. As member A --------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.member_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r record; v_n int;
begin
  begin perform ai_clear_flag(current_setting('t.flag_m')::bigint); raise exception '5a: a member cleared a flag'; exception when insufficient_privilege then null; end;
  begin perform ai_set_user_limit(null, 1); raise exception '5b: a member set the default limit'; exception when insufficient_privilege then null; end;
  begin perform platform_set_org_quota(current_setting('t.org_a')::uuid, 1, 'hard_stop'); raise exception '5c: a member set an org quota'; exception when insufficient_privilege then null; end;
  begin perform ai_org_usage(null); raise exception '5d: a member read org usage'; exception when insufficient_privilege then null; end;
  begin perform platform_org_usage(null); raise exception '5e: a member read platform usage'; exception when insufficient_privilege then null; end;
  select count(*) into v_n from ai_usage where user_id <> auth.uid();
  if v_n <> 0 then raise exception '5f: a member sees % usage rows of others', v_n; end if;
  select count(*) into v_n from ai_usage where user_id = auth.uid();
  if v_n = 0 then raise exception '5g: a member cannot see their own usage'; end if;
  select count(*) into v_n from ai_org_quotas;
  if v_n <> 0 then raise exception '5h: a member sees org quotas'; end if;
  select * into r from ai_my_usage();
  if r.daily_limit is distinct from 200000 or r.used_today is distinct from 150 then raise exception '5i: ai_my_usage wrong: %', row_to_json(r); end if;
  begin
    insert into ai_usage (org_id, user_id, feature, model, outcome) values (current_setting('t.org_a')::uuid, auth.uid(), 'match', 'x', 'ok');
    raise exception '5j: a member inserted usage directly';
  exception when insufficient_privilege then null; end;
  begin perform ai_record_usage(current_setting('t.org_a')::uuid, auth.uid(), 'match', 'x', 1, 1, 'ok'); raise exception '5k: a member called ai_record_usage'; exception when insufficient_privilege then null; end;
  begin perform ai_quota_check(current_setting('t.org_a')::uuid, auth.uid()); raise exception '5l: a member called ai_quota_check'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 6. As an admin of another organisation ----------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.admin_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_n int; tb text;
begin
  begin perform ai_clear_flag(current_setting('t.flag_m')::bigint); raise exception '6a: another org''s admin cleared a flag'; exception when insufficient_privilege then null; end;
  begin perform ai_set_user_limit(current_setting('t.member_a')::uuid, 5); raise exception '6b: another org''s admin set a limit'; exception when insufficient_privilege then null; end;
  select count(*) into v_n from ai_usage where org_id = current_setting('t.org_a')::uuid;
  if v_n <> 0 then raise exception '6c: another org''s admin sees org A usage'; end if;
  select count(*) into v_n from ai_user_flags where org_id = current_setting('t.org_a')::uuid;
  if v_n <> 0 then raise exception '6d: another org''s admin sees org A flags'; end if;
  if (ai_org_usage(null)->'org'->>'org_id')::uuid is distinct from current_setting('t.org_b')::uuid then raise exception '6e: ai_org_usage returned another org'; end if;
  foreach tb in array array['public.ai_org_quotas', 'public.ai_usage_org_month', 'public.ai_user_limits', 'public.ai_usage_user_day'] loop
    execute format('select count(*) from %s where org_id = $1', tb) into v_n using current_setting('t.org_a')::uuid;
    if v_n <> 0 then raise exception '6f: another org''s admin sees % org A rows in %', v_n, tb; end if;
  end loop;
end $$;
reset role;

-- 7. As an admin of org A ---------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.admin_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_n int; j jsonb; tb text;
begin
  begin perform platform_set_org_quota(current_setting('t.org_a')::uuid, 1, 'hard_stop'); raise exception '7a: an org admin set a platform quota'; exception when insufficient_privilege then null; end;
  begin perform platform_org_usage(null); raise exception '7b: an org admin read platform usage'; exception when insufficient_privilege then null; end;
  begin perform platform_org_detail(current_setting('t.org_a')::uuid, null); raise exception '7c: an org admin read platform detail'; exception when insufficient_privilege then null; end;

  perform ai_set_user_limit(current_setting('t.member_a')::uuid, 1234);
  if (select daily_tokens from ai_user_limits where user_id = current_setting('t.member_a')::uuid) is distinct from 1234 then raise exception '7d: override not saved'; end if;
  begin perform ai_set_user_limit(current_setting('t.member_a')::uuid, -1); raise exception '7e: a negative limit was accepted'; exception when invalid_parameter_value then null; end;
  perform ai_set_user_limit(current_setting('t.member_a')::uuid, null);
  if exists (select 1 from ai_user_limits where user_id = current_setting('t.member_a')::uuid) then raise exception '7f: null did not reset the user to the default'; end if;
  perform ai_set_user_limit(null, 150000);
  if (select daily_tokens from ai_user_limits where org_id = current_setting('t.org_a')::uuid and user_id is null) is distinct from 150000 then raise exception '7g: org default not saved'; end if;
  begin perform ai_set_user_limit(null, null); raise exception '7h: a null default was accepted'; exception when invalid_parameter_value then null; end;

  select count(*) into v_n from ai_usage where org_id <> current_setting('t.org_a')::uuid;
  if v_n <> 0 then raise exception '7i: an org admin sees other orgs'' usage'; end if;
  select count(*) into v_n from ai_usage where org_id = current_setting('t.org_a')::uuid;
  if v_n = 0 then raise exception '7j: an org admin cannot see their org''s usage'; end if;
  foreach tb in array array['public.ai_org_quotas', 'public.ai_usage_org_month', 'public.ai_user_limits', 'public.ai_usage_user_day', 'public.ai_user_flags'] loop
    execute format('select count(*) from %s where org_id <> $1', tb) into v_n using current_setting('t.org_a')::uuid;
    if v_n <> 0 then raise exception '7q: an org admin sees % other-org rows in %', v_n, tb; end if;
  end loop;

  j := ai_org_usage(null);
  if (j->'org'->>'org_id')::uuid is distinct from current_setting('t.org_a')::uuid or (j->>'default_daily_tokens')::bigint is distinct from 150000 then
    raise exception '7k: ai_org_usage wrong: %', j;
  end if;
  if coalesce((j->'org'->>'used')::bigint, -1) < 150 or coalesce(jsonb_array_length(j->'users'), 0) = 0 or coalesce(jsonb_array_length(j->'features'), 0) = 0 or coalesce(jsonb_array_length(j->'flags'), 0) = 0 then
    raise exception '7l: ai_org_usage sections missing: %', j;
  end if;
  if not exists (select 1 from jsonb_array_elements(j->'users') u where (u->>'user_id')::uuid = current_setting('t.member_a')::uuid and (u->>'flagged')::boolean) then
    raise exception '7m: the flagged member is not marked flagged';
  end if;

  perform ai_clear_flag(current_setting('t.flag_m')::bigint);
  if exists (select 1 from ai_user_flags where id = current_setting('t.flag_m')::bigint and (cleared_at is null or paused_until > now())) then
    raise exception '7n: clearing did not lift the pause';
  end if;
end $$;
reset role;

do $$
declare r record;
begin
  select * into r from ai_quota_check(current_setting('t.org_a')::uuid, current_setting('t.member_a')::uuid);
  if r.reason = 'paused_bot_check' then raise exception '7o: a cleared flag still pauses the user'; end if;
  select * into r from ai_bot_check(current_setting('t.org_a')::uuid, current_setting('t.member_a')::uuid, 'assistant', 'h-new');
  if r.flagged is not false then raise exception '7p: the next call after clearing re-flagged the user on the same rows'; end if;
end $$;

-- 8. As the platform admin -----------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.p'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare j jsonb; v_n int;
begin
  perform platform_set_org_quota(current_setting('t.org_a')::uuid, 3000000, 'soft_limit');
  if not exists (select 1 from ai_org_quotas where org_id = current_setting('t.org_a')::uuid and monthly_tokens = 3000000 and overage_mode = 'soft_limit') then
    raise exception '8a: platform quota not saved';
  end if;
  begin perform platform_set_org_quota(current_setting('t.org_a')::uuid, -5, 'hard_stop'); raise exception '8b: a negative quota was accepted'; exception when invalid_parameter_value then null; end;
  begin perform platform_set_org_quota(current_setting('t.org_a')::uuid, 5, 'unlimited'); raise exception '8c: an unknown mode was accepted'; exception when invalid_parameter_value then null; end;
  select count(distinct org_id) into v_n from ai_org_quotas;
  if v_n < 2 then raise exception '8d: the platform admin cannot see every quota'; end if;
  j := platform_org_usage(null);
  if not exists (select 1 from jsonb_array_elements(j->'orgs') o where (o->>'org_id')::uuid = current_setting('t.org_a')::uuid and (o->>'quota')::bigint = 3000000) then
    raise exception '8e: platform_org_usage misses org A: %', j;
  end if;
  if not exists (select 1 from jsonb_array_elements(j->'flags') f where (f->>'user_id')::uuid = current_setting('t.admin_a')::uuid) then
    raise exception '8f: platform_org_usage misses the open flag';
  end if;
  j := platform_org_detail(current_setting('t.org_b')::uuid, null);
  if (j->'org'->>'org_id')::uuid is distinct from current_setting('t.org_b')::uuid then raise exception '8g: platform_org_detail returned the wrong org'; end if;
  perform ai_clear_flag((select id from ai_user_flags where user_id = current_setting('t.admin_a')::uuid));
  if exists (select 1 from ai_user_flags where user_id = current_setting('t.admin_a')::uuid and cleared_at is null) then
    raise exception '8h: the platform admin could not clear a flag';
  end if;
end $$;
reset role;

-- 9. As anon --------------------------------------------------------------------------
set local role anon;
do $$
begin
  begin perform count(*) from ai_usage; raise exception '9a: anon read ai_usage'; exception when insufficient_privilege then null; end;
  begin perform ai_my_usage(); raise exception '9b: anon ran ai_my_usage'; exception when insufficient_privilege then null; end;
  begin perform is_platform_admin(); raise exception '9c: anon ran is_platform_admin'; exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'all ai usage tests passed' as result;
