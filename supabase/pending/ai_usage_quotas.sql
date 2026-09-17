-- AI usage tracking, token quotas and bot check (spec 2026-09-17-ai-usage-quotas-design.md §4).

-- Tables -------------------------------------------------------------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.ai_org_quotas (
  org_id         uuid primary key references public.organizations(id) on delete cascade,
  monthly_tokens bigint not null check (monthly_tokens >= 0),
  overage_mode   text   not null default 'hard_stop' check (overage_mode in ('hard_stop','soft_limit')),
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now()
);

create table public.ai_user_limits (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid references public.users(id) on delete cascade,
  daily_tokens bigint not null check (daily_tokens >= 0),
  updated_by   uuid references auth.users(id),
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
  cleared_by   uuid references auth.users(id),
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
