-- AI usage tracking, token quotas and bot check (spec 2026-09-17-ai-usage-quotas-design.md §4).

-- Fail fast instead of queueing behind a long transaction on organizations/users.
set local lock_timeout = '5s';

-- Tables -------------------------------------------------------------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.ai_org_quotas (
  org_id         uuid primary key references public.organizations(id) on delete cascade,
  monthly_tokens bigint not null check (monthly_tokens >= 0),
  overage_mode   text   not null default 'hard_stop' check (overage_mode in ('hard_stop','soft_limit')),
  updated_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now()
);

create table public.ai_user_limits (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid references public.users(id) on delete cascade,
  daily_tokens bigint not null check (daily_tokens >= 0),
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);
create unique index ai_user_limits_user_uq    on public.ai_user_limits (org_id, user_id) where user_id is not null;
create unique index ai_user_limits_default_uq on public.ai_user_limits (org_id)          where user_id is null;

create table public.ai_usage (
  id                bigint generated always as identity primary key,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  user_id           uuid references public.users(id) on delete set null,
  feature           text not null check (feature in ('assistant','analytics_ask','resume_parse','jd_parse','candidate_extract','match','screen')),
  model             text not null,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens      integer not null default 0,
  outcome           text not null check (outcome in ('ok','error','blocked')),
  block_reason      text check (block_reason in ('org_month_exhausted','user_day_exhausted','paused_bot_check')),
  request_hash      text,
  created_at        timestamptz not null default now()
);
create index ai_usage_org_created_idx  on public.ai_usage (org_id, created_at);
create index ai_usage_user_created_idx on public.ai_usage (user_id, created_at);
create index ai_usage_user_hash_idx    on public.ai_usage (user_id, feature, request_hash, created_at);

create table public.ai_usage_org_month (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  month         date not null,
  tokens        bigint  not null default 0,
  calls         integer not null default 0,
  blocked_calls integer not null default 0,
  primary key (org_id, month)
);

create table public.ai_usage_user_day (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  day           date not null,
  tokens        bigint  not null default 0,
  calls         integer not null default 0,
  blocked_calls integer not null default 0,
  primary key (user_id, day)
);
create index ai_usage_user_day_org_idx on public.ai_usage_user_day (org_id, day);

create table public.ai_user_flags (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  reason       text not null check (reason in ('call_rate','repeated_request')),
  detail       jsonb not null default '{}'::jsonb,
  paused_until timestamptz not null,
  created_at   timestamptz not null default now(),
  cleared_by   uuid references auth.users(id) on delete set null,
  cleared_at   timestamptz
);
create index ai_user_flags_org_created_idx on public.ai_user_flags (org_id, created_at);
create index ai_user_flags_user_paused_idx on public.ai_user_flags (user_id, paused_until);

-- Helpers ------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function public.ai_is_org_admin_of(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.org_id = p_org_id and u.role in ('owner','admin')
  )
$$;

create or replace function public.ai_org_tz(p_org_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(o.timezone, '') from public.organizations o where o.id = p_org_id), 'Asia/Kolkata')
$$;

-- Row-level security -------------------------------------------------------
alter table public.platform_admins    enable row level security;
alter table public.ai_org_quotas      enable row level security;
alter table public.ai_user_limits     enable row level security;
alter table public.ai_usage           enable row level security;
alter table public.ai_usage_org_month enable row level security;
alter table public.ai_usage_user_day  enable row level security;
alter table public.ai_user_flags      enable row level security;

create policy ai_org_quotas_select on public.ai_org_quotas
  for select to authenticated using (public.is_platform_admin() or public.ai_is_org_admin_of(org_id));
create policy ai_usage_org_month_select on public.ai_usage_org_month
  for select to authenticated using (public.is_platform_admin() or public.ai_is_org_admin_of(org_id));
create policy ai_user_limits_select on public.ai_user_limits
  for select to authenticated using (public.is_platform_admin() or public.ai_is_org_admin_of(org_id) or user_id = auth.uid());
create policy ai_usage_select on public.ai_usage
  for select to authenticated using (public.is_platform_admin() or public.ai_is_org_admin_of(org_id) or user_id = auth.uid());
create policy ai_usage_user_day_select on public.ai_usage_user_day
  for select to authenticated using (public.is_platform_admin() or public.ai_is_org_admin_of(org_id) or user_id = auth.uid());
create policy ai_user_flags_select on public.ai_user_flags
  for select to authenticated using (public.is_platform_admin() or public.ai_is_org_admin_of(org_id) or user_id = auth.uid());

revoke all on table public.platform_admins, public.ai_org_quotas, public.ai_user_limits, public.ai_usage,
                    public.ai_usage_org_month, public.ai_usage_user_day, public.ai_user_flags from anon;
revoke insert, update, delete, truncate on table public.platform_admins, public.ai_org_quotas, public.ai_user_limits, public.ai_usage,
                    public.ai_usage_org_month, public.ai_usage_user_day, public.ai_user_flags from authenticated;

-- New organisations start with a small quota ----------------------------------
create or replace function public.ai_seed_new_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_org_quotas (org_id, monthly_tokens, overage_mode)
  values (new.id, 2000, 'hard_stop')
  on conflict (org_id) do nothing;
  insert into public.ai_user_limits (org_id, user_id, daily_tokens)
  values (new.id, null, 200000)
  on conflict (org_id) where user_id is null do nothing;
  return new;
end $$;

create trigger trg_ai_seed_new_org
  after insert on public.organizations
  for each row execute function public.ai_seed_new_org();

-- Seed ---------------------------------------------------------------------
insert into public.platform_admins (user_id)
select a.id from auth.users a where lower(a.email) = 'anchansachinv99@gmail.com'
on conflict (user_id) do nothing;

insert into public.ai_org_quotas (org_id, monthly_tokens, overage_mode)
select o.id, 2000000, 'hard_stop' from public.organizations o
on conflict (org_id) do nothing;

insert into public.ai_user_limits (org_id, user_id, daily_tokens)
select o.id, null, 200000 from public.organizations o
on conflict (org_id) where user_id is null do nothing;

-- Grants (helpers) ----------------------------------------------------------
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;
revoke all on function public.ai_is_org_admin_of(uuid) from public, anon;
grant execute on function public.ai_is_org_admin_of(uuid) to authenticated, service_role;
revoke all on function public.ai_org_tz(uuid) from public, anon, authenticated;
revoke all on function public.ai_seed_new_org() from public, anon, authenticated;

-- Quota check (gateway, service role) ----------------------------------------
create or replace function public.ai_quota_check(p_org_id uuid, p_user_id uuid)
returns table (
  allowed boolean, reason text, paused_until timestamptz,
  org_used bigint, org_quota bigint, overage_mode text,
  user_used bigint, user_limit bigint,
  resets_day timestamptz, resets_month timestamptz
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tz    text := public.ai_org_tz(p_org_id);
  v_local timestamp := now() at time zone v_tz;
  v_day   date := v_local::date;
  v_month date := date_trunc('month', v_local)::date;
begin
  resets_day   := (v_day + 1)::timestamp at time zone v_tz;
  resets_month := (v_month + interval '1 month') at time zone v_tz;

  select max(f.paused_until) into paused_until
    from public.ai_user_flags f
   where f.user_id = p_user_id and f.paused_until > now();

  select coalesce(q.monthly_tokens, 0), coalesce(q.overage_mode, 'hard_stop')
    into org_quota, overage_mode
    from (select 1) one
    left join public.ai_org_quotas q on q.org_id = p_org_id;

  org_used := coalesce((select m.tokens from public.ai_usage_org_month m where m.org_id = p_org_id and m.month = v_month), 0);
  user_used := coalesce((select d.tokens from public.ai_usage_user_day d where d.user_id = p_user_id and d.day = v_day), 0);
  user_limit := coalesce(
    (select l.daily_tokens from public.ai_user_limits l where l.org_id = p_org_id and l.user_id = p_user_id),
    (select l.daily_tokens from public.ai_user_limits l where l.org_id = p_org_id and l.user_id is null),
    0);

  if paused_until is not null then
    allowed := false; reason := 'paused_bot_check';
  elsif user_used >= user_limit then
    allowed := false; reason := 'user_day_exhausted';
  elsif org_used >= org_quota and overage_mode = 'hard_stop' then
    allowed := false; reason := 'org_month_exhausted';
  else
    allowed := true; reason := null;
  end if;
  return next;
end $$;

-- Usage recording (gateway, service role) -----------------------------------
create or replace function public.ai_record_usage(
  p_org_id uuid, p_user_id uuid, p_feature text, p_model text,
  p_prompt integer, p_completion integer, p_outcome text,
  p_block_reason text default null, p_request_hash text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_local      timestamp := now() at time zone public.ai_org_tz(p_org_id);
  v_blocked    boolean := p_outcome = 'blocked';
  v_prompt     integer := case when p_outcome = 'blocked' then 0 else greatest(coalesce(p_prompt, 0), 0) end;
  v_completion integer := case when p_outcome = 'blocked' then 0 else greatest(coalesce(p_completion, 0), 0) end;
  v_total      integer := v_prompt + v_completion;
begin
  insert into public.ai_usage (org_id, user_id, feature, model, prompt_tokens, completion_tokens, total_tokens, outcome, block_reason, request_hash)
  values (p_org_id, p_user_id, p_feature, p_model, v_prompt, v_completion, v_total, p_outcome, p_block_reason, p_request_hash);

  insert into public.ai_usage_org_month as t (org_id, month, tokens, calls, blocked_calls)
  values (p_org_id, date_trunc('month', v_local)::date, v_total, case when v_blocked then 0 else 1 end, case when v_blocked then 1 else 0 end)
  on conflict (org_id, month) do update
    set tokens = t.tokens + excluded.tokens,
        calls = t.calls + excluded.calls,
        blocked_calls = t.blocked_calls + excluded.blocked_calls;

  if p_user_id is not null then
    insert into public.ai_usage_user_day as t (org_id, user_id, day, tokens, calls, blocked_calls)
    values (p_org_id, p_user_id, v_local::date, v_total, case when v_blocked then 0 else 1 end, case when v_blocked then 1 else 0 end)
    on conflict (user_id, day) do update
      set tokens = t.tokens + excluded.tokens,
          calls = t.calls + excluded.calls,
          blocked_calls = t.blocked_calls + excluded.blocked_calls;
  end if;
end $$;

-- Bot check (gateway, service role) -----------------------------------------
create or replace function public.ai_bot_check(p_org_id uuid, p_user_id uuid, p_feature text, p_request_hash text)
returns table (flagged boolean, reason text, paused_until timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_recent  integer;
  v_repeats integer := 0;
  v_reason  text;
  v_detail  jsonb;
  v_until   timestamptz;
  v_name    text;
begin
  -- Serialise checks per user, so parallel calls cannot both raise a flag.
  perform pg_advisory_xact_lock(hashtextextended('ai_bot_check:' || p_user_id::text, 0));

  -- Already paused: the quota check blocks; don't raise another flag.
  if exists (select 1 from public.ai_user_flags f where f.user_id = p_user_id and f.paused_until > now()) then
    flagged := false; reason := null; paused_until := null;
    return next; return;
  end if;

  select count(*) into v_recent
    from public.ai_usage u
   where u.user_id = p_user_id and u.outcome <> 'blocked'
     and u.created_at > now() - interval '60 seconds'
     -- Only count usage since the latest flag, so clearing a flag does not re-flag on the same rows.
     and u.created_at > coalesce((select max(f.created_at) from public.ai_user_flags f where f.user_id = p_user_id), '-infinity'::timestamptz);

  if p_request_hash is not null then
    select count(*) into v_repeats
      from public.ai_usage u
     where u.user_id = p_user_id and u.feature = p_feature and u.request_hash = p_request_hash
       and u.outcome <> 'blocked' and u.created_at > now() - interval '5 minutes'
       and u.created_at > coalesce((select max(f.created_at) from public.ai_user_flags f where f.user_id = p_user_id), '-infinity'::timestamptz);
  end if;

  if v_recent >= 60 then
    v_reason := 'call_rate';
    v_detail := jsonb_build_object('calls_last_minute', v_recent + 1);
  elsif v_repeats >= 9 then
    v_reason := 'repeated_request';
    v_detail := jsonb_build_object('feature', p_feature, 'repeats', v_repeats + 1);
  else
    flagged := false; reason := null; paused_until := null;
    return next; return;
  end if;

  v_until := now() + interval '10 minutes';
  insert into public.ai_user_flags (org_id, user_id, reason, detail, paused_until)
  values (p_org_id, p_user_id, v_reason, v_detail, v_until);

  select u.full_name into v_name from public.users u where u.id = p_user_id;
  insert into public.notifications (org_id, user_id, title, body, module, entity_type, entity_id, channel, status, email_status)
  select p_org_id, adm.id,
         'AI paused: unusual activity',
         'AI is paused for 10 minutes for ' || coalesce(v_name, 'a user') || ': ' ||
           case v_reason when 'call_rate' then 'too many AI requests in a minute.' else 'the same AI request was repeated many times.' end,
         'platform', 'user', p_user_id, 'in_app', 'unread', 'none'
    from public.users adm
   where adm.org_id = p_org_id and adm.role in ('owner','admin') and adm.status = 'active';

  flagged := true; reason := v_reason; paused_until := v_until;
  return next;
end $$;

-- Grants (gateway functions) --------------------------------------------------
revoke all on function public.ai_quota_check(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ai_quota_check(uuid, uuid) to service_role;
revoke all on function public.ai_record_usage(uuid, uuid, text, text, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.ai_record_usage(uuid, uuid, text, text, integer, integer, text, text, text) to service_role;
revoke all on function public.ai_bot_check(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.ai_bot_check(uuid, uuid, text, text) to service_role;

-- Platform admin: set an organisation's quota ------------------------------------
create or replace function public.platform_set_org_quota(p_org_id uuid, p_monthly_tokens bigint, p_overage_mode text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform_set_org_quota: not allowed' using errcode = '42501';
  end if;
  if p_monthly_tokens is null or p_monthly_tokens < 0 then
    raise exception 'platform_set_org_quota: monthly tokens must be 0 or more' using errcode = '22023';
  end if;
  if p_overage_mode is null or p_overage_mode not in ('hard_stop','soft_limit') then
    raise exception 'platform_set_org_quota: overage mode must be hard_stop or soft_limit' using errcode = '22023';
  end if;
  insert into public.ai_org_quotas (org_id, monthly_tokens, overage_mode, updated_by, updated_at)
  values (p_org_id, p_monthly_tokens, p_overage_mode, auth.uid(), now())
  on conflict (org_id) do update
    set monthly_tokens = excluded.monthly_tokens,
        overage_mode = excluded.overage_mode,
        updated_by = excluded.updated_by,
        updated_at = now();
end $$;

-- Org owner/admin: default and per-user daily limits ----------------------------------
create or replace function public.ai_set_user_limit(p_user_id uuid, p_daily_tokens bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_target_org uuid;
begin
  select u.org_id into v_org from public.users u where u.id = auth.uid() and u.role in ('owner','admin');
  if v_org is null then
    raise exception 'ai_set_user_limit: not allowed' using errcode = '42501';
  end if;

  if p_user_id is null then
    if p_daily_tokens is null or p_daily_tokens < 0 then
      raise exception 'ai_set_user_limit: the default daily limit must be 0 or more' using errcode = '22023';
    end if;
    insert into public.ai_user_limits (org_id, user_id, daily_tokens, updated_by, updated_at)
    values (v_org, null, p_daily_tokens, auth.uid(), now())
    on conflict (org_id) where user_id is null do update
      set daily_tokens = excluded.daily_tokens, updated_by = excluded.updated_by, updated_at = now();
    return;
  end if;

  select u.org_id into v_target_org from public.users u where u.id = p_user_id;
  if v_target_org is distinct from v_org then
    raise exception 'ai_set_user_limit: not allowed' using errcode = '42501';
  end if;

  if p_daily_tokens is null then
    delete from public.ai_user_limits where org_id = v_org and user_id = p_user_id;
    return;
  end if;
  if p_daily_tokens < 0 then
    raise exception 'ai_set_user_limit: the daily limit must be 0 or more' using errcode = '22023';
  end if;
  insert into public.ai_user_limits (org_id, user_id, daily_tokens, updated_by, updated_at)
  values (v_org, p_user_id, p_daily_tokens, auth.uid(), now())
  on conflict (org_id, user_id) where user_id is not null do update
    set daily_tokens = excluded.daily_tokens, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- Clear a bot-check flag (lifts an active pause) --------------------------------------
create or replace function public.ai_clear_flag(p_flag_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select f.org_id into v_org from public.ai_user_flags f where f.id = p_flag_id;
  if v_org is null or not (public.is_platform_admin() or public.ai_is_org_admin_of(v_org)) then
    raise exception 'ai_clear_flag: not allowed' using errcode = '42501';
  end if;
  update public.ai_user_flags
     set cleared_by = auth.uid(), cleared_at = now(), paused_until = least(paused_until, now())
   where id = p_flag_id and cleared_at is null;
end $$;

-- Every user: today's usage ----------------------------------------------------------
create or replace function public.ai_my_usage()
returns table (used_today bigint, daily_limit bigint, resets_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
  v_tz  text;
  v_day date;
begin
  select u.org_id into v_org from public.users u where u.id = auth.uid();
  if v_org is null then return; end if;
  v_tz := public.ai_org_tz(v_org);
  v_day := (now() at time zone v_tz)::date;
  used_today := coalesce((select d.tokens from public.ai_usage_user_day d where d.user_id = auth.uid() and d.day = v_day), 0);
  daily_limit := coalesce(
    (select l.daily_tokens from public.ai_user_limits l where l.org_id = v_org and l.user_id = auth.uid()),
    (select l.daily_tokens from public.ai_user_limits l where l.org_id = v_org and l.user_id is null),
    0);
  resets_at := (v_day + 1)::timestamp at time zone v_tz;
  return next;
end $$;

-- Shared report for one organisation and month (internal) ---------------------------------
create or replace function public.ai_usage_report(p_org_id uuid, p_month date, p_today date)
returns jsonb language sql stable security definer set search_path = public as $$
  with b as (
    select public.ai_org_tz(p_org_id) as tz,
           p_month as m_start,
           (p_month + interval '1 month')::date as m_end
  ), dl as (
    select (select l.daily_tokens from public.ai_user_limits l where l.org_id = p_org_id and l.user_id is null) as daily_tokens
  )
  select jsonb_build_object(
    'org', (
      select jsonb_build_object(
        'org_id', o.id, 'name', o.name, 'month', b.m_start,
        'quota', coalesce(q.monthly_tokens, 0),
        'overage_mode', coalesce(q.overage_mode, 'hard_stop'),
        'used', coalesce(m.tokens, 0),
        'remaining', greatest(coalesce(q.monthly_tokens, 0) - coalesce(m.tokens, 0), 0),
        'overage', greatest(coalesce(m.tokens, 0) - coalesce(q.monthly_tokens, 0), 0),
        'calls', coalesce(m.calls, 0),
        'blocked_calls', coalesce(m.blocked_calls, 0),
        'resets_month', b.m_end::timestamp at time zone b.tz)
      from public.organizations o
      cross join b
      left join public.ai_org_quotas q on q.org_id = o.id
      left join public.ai_usage_org_month m on m.org_id = o.id and m.month = b.m_start
      where o.id = p_org_id),
    'default_daily_tokens', (select dl.daily_tokens from dl),
    'users', coalesce((
      select jsonb_agg(x.j order by x.used_month desc, x.full_name)
      from (
        select u.full_name, coalesce(s.tokens, 0) as used_month,
               jsonb_build_object(
                 'user_id', u.id, 'full_name', u.full_name, 'role', u.role,
                 'daily_limit', coalesce(l.daily_tokens, (select dl.daily_tokens from dl), 0),
                 'is_override', l.id is not null,
                 'used_today', coalesce((select d.tokens from public.ai_usage_user_day d where d.user_id = u.id and d.day = p_today), 0),
                 'used_month', coalesce(s.tokens, 0),
                 'calls', coalesce(s.calls, 0),
                 'blocked_calls', coalesce(s.blocked_calls, 0),
                 'flagged', exists (select 1 from public.ai_user_flags f where f.user_id = u.id and f.cleared_at is null)) as j
        from public.users u
        cross join b
        left join public.ai_user_limits l on l.org_id = p_org_id and l.user_id = u.id
        left join lateral (
          select sum(d.tokens) as tokens, sum(d.calls) as calls, sum(d.blocked_calls) as blocked_calls
          from public.ai_usage_user_day d
          where d.user_id = u.id and d.day >= b.m_start and d.day < b.m_end
        ) s on true
        where u.org_id = p_org_id
      ) x), '[]'::jsonb),
    'features', coalesce((
      select jsonb_agg(jsonb_build_object('feature', f.feature, 'tokens', f.tokens, 'calls', f.calls) order by f.tokens desc)
      from (
        select a.feature, sum(a.total_tokens) as tokens, count(*) filter (where a.outcome <> 'blocked') as calls
        from public.ai_usage a cross join b
        where a.org_id = p_org_id
          and a.created_at >= b.m_start::timestamp at time zone b.tz
          and a.created_at <  b.m_end::timestamp at time zone b.tz
        group by a.feature
      ) f), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', dd.day, 'tokens', dd.tokens) order by dd.day)
      from (
        select d.day, sum(d.tokens) as tokens
        from public.ai_usage_user_day d cross join b
        where d.org_id = p_org_id and d.day >= b.m_start and d.day < b.m_end
        group by d.day
      ) dd), '[]'::jsonb),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'user_id', f.user_id, 'full_name', u.full_name, 'reason', f.reason, 'detail', f.detail,
               'created_at', f.created_at, 'paused_until', f.paused_until, 'cleared_at', f.cleared_at,
               'cleared_by', f.cleared_by, 'cleared_by_name', cb.full_name)
             order by f.created_at desc)
      from public.ai_user_flags f
      join public.users u on u.id = f.user_id
      left join public.users cb on cb.id = f.cleared_by
      cross join b
      where f.org_id = p_org_id
        and (f.cleared_at is null
             or (f.created_at >= b.m_start::timestamp at time zone b.tz
                 and f.created_at < b.m_end::timestamp at time zone b.tz))), '[]'::jsonb)
  )
$$;

-- Org owner/admin: this organisation's usage ------------------------------------------
create or replace function public.ai_org_usage(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
  v_tz  text;
  v_today date;
begin
  select u.org_id into v_org from public.users u where u.id = auth.uid() and u.role in ('owner','admin');
  if v_org is null then
    raise exception 'ai_org_usage: not allowed' using errcode = '42501';
  end if;
  v_tz := public.ai_org_tz(v_org);
  v_today := (now() at time zone v_tz)::date;
  return public.ai_usage_report(v_org, date_trunc('month', coalesce(p_month, v_today))::date, v_today);
end $$;

-- Platform admin: every organisation ------------------------------------------------------
create or replace function public.platform_org_usage(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_month date;
begin
  if not public.is_platform_admin() then
    raise exception 'platform_org_usage: not allowed' using errcode = '42501';
  end if;
  v_month := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date))::date;
  return jsonb_build_object(
    'month', v_month,
    'orgs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'org_id', o.id, 'name', o.name,
               'quota', coalesce(q.monthly_tokens, 0),
               'overage_mode', coalesce(q.overage_mode, 'hard_stop'),
               'used', coalesce(m.tokens, 0),
               'pct_used', case when coalesce(q.monthly_tokens, 0) > 0
                                then round(100.0 * coalesce(m.tokens, 0) / q.monthly_tokens, 1) end,
               'calls', coalesce(m.calls, 0),
               'blocked_calls', coalesce(m.blocked_calls, 0),
               'overage', greatest(coalesce(m.tokens, 0) - coalesce(q.monthly_tokens, 0), 0),
               'open_flags', (select count(*) from public.ai_user_flags f where f.org_id = o.id and f.cleared_at is null))
             order by o.name)
      from public.organizations o
      left join public.ai_org_quotas q on q.org_id = o.id
      left join public.ai_usage_org_month m on m.org_id = o.id and m.month = v_month), '[]'::jsonb),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'org_id', f.org_id, 'org_name', o.name, 'user_id', f.user_id, 'full_name', u.full_name,
               'reason', f.reason, 'detail', f.detail, 'created_at', f.created_at, 'paused_until', f.paused_until)
             order by f.created_at desc)
      from public.ai_user_flags f
      join public.organizations o on o.id = f.org_id
      join public.users u on u.id = f.user_id
      where f.cleared_at is null), '[]'::jsonb)
  );
end $$;

create or replace function public.platform_org_detail(p_org_id uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
begin
  if not public.is_platform_admin() then
    raise exception 'platform_org_detail: not allowed' using errcode = '42501';
  end if;
  v_tz := public.ai_org_tz(p_org_id);
  v_today := (now() at time zone v_tz)::date;
  return public.ai_usage_report(p_org_id, date_trunc('month', coalesce(p_month, v_today))::date, v_today);
end $$;

-- Grants (client functions) ------------------------------------------------------------------
revoke all on function public.ai_usage_report(uuid, date, date) from public, anon, authenticated;
revoke all on function public.platform_set_org_quota(uuid, bigint, text) from public, anon;
grant execute on function public.platform_set_org_quota(uuid, bigint, text) to authenticated;
revoke all on function public.ai_set_user_limit(uuid, bigint) from public, anon;
grant execute on function public.ai_set_user_limit(uuid, bigint) to authenticated;
revoke all on function public.ai_clear_flag(bigint) from public, anon;
grant execute on function public.ai_clear_flag(bigint) to authenticated;
revoke all on function public.ai_my_usage() from public, anon;
grant execute on function public.ai_my_usage() to authenticated;
revoke all on function public.ai_org_usage(date) from public, anon;
grant execute on function public.ai_org_usage(date) to authenticated;
revoke all on function public.platform_org_usage(date) from public, anon;
grant execute on function public.platform_org_usage(date) to authenticated;
revoke all on function public.platform_org_detail(uuid, date) from public, anon;
grant execute on function public.platform_org_detail(uuid, date) to authenticated;
