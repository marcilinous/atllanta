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

select 'all ai usage tests passed' as result;
