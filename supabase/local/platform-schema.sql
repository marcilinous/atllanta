-- Module 0 (Shared Platform & Identity) as code, for a LOCAL database only.
--
-- Why this file exists: the live schema predates this repo's migrations, so the
-- three files in supabase/migrations cannot build a database from empty. This
-- reproduces the platform tables, helpers, trigger and policies exactly as they
-- are in production on 2026-09-23 (including v1.2.2's org_id guard and v1.2.3's
-- policy set), so tenancy can be tested without touching the live database.
--
-- It is never applied to production: production already has all of this. Keep it
-- in step with the live schema — it is the fixture the isolation test runs on.

-- Function bodies reference tables created further down; check them at call
-- time, the way pg_dump restores a schema.
set check_function_bodies = off;

-- Helpers -------------------------------------------------------------------

create or replace function public.auth_org_id()
returns uuid language sql stable security definer set search_path to ''
as $$ select org_id from public.users where id = auth.uid() $$;

create or replace function public.auth_user_org_ids()
returns setof uuid language sql stable security definer set search_path to ''
as $$ select public.auth_org_id() $$;

create or replace function public.is_org_admin()
returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from users u where u.id = auth.uid() and u.role in ('owner','admin')) $$;

create or replace function public.hr_can_configure()
returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from users u where u.id = auth.uid() and u.role in ('owner','admin')) $$;

-- Tables --------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_type text not null check (org_type in ('direct','agency')),
  plan_tier text not null default 'starter' check (plan_tier in ('starter','growth','agency_partner','enterprise')),
  payment_status text not null default 'trial' check (payment_status in ('trial','active','past_due','cancelled')),
  trial_started_at timestamptz default now(),
  trial_ends_at timestamptz default (now() + interval '14 days'),
  trial_candidate_cap integer default 25,
  max_trial_extension_days integer default 30,
  credits_included_monthly integer default 200,
  credits_balance integer default 200,
  credit_overage_mode text default 'soft_bill' check (credit_overage_mode in ('soft_bill','hard_stop')),
  commission_percent numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  slug text unique,
  logo_url text,
  timezone text default 'Asia/Kolkata',
  currency text default 'INR',
  date_format text default 'DD/MM/YYYY',
  crm_enabled boolean not null default true,
  partner_crm_enabled boolean not null default false
);

create table if not exists public.users (
  id uuid primary key,
  org_id uuid references public.organizations(id),
  full_name text,
  email text,
  phone text,
  avatar_url text,
  role text default 'member' check (role in ('owner','admin','manager','member')),
  designation text,
  department_id uuid,
  team_id uuid,
  reporting_manager_id uuid,
  status text default 'active' check (status in ('active','on_notice','exited')),
  date_of_joining date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  head_id uuid,
  created_at timestamptz default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  department_id uuid not null references public.departments(id),
  name text not null,
  lead_id uuid,
  created_at timestamptz default now()
);

alter table public.users
  add constraint users_department_id_fkey foreign key (department_id) references public.departments(id),
  add constraint users_team_id_fkey foreign key (team_id) references public.teams(id);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  email text not null,
  role text not null default 'member',
  invited_by uuid,
  status text not null default 'pending',
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '7 days'),
  full_name text,
  phone text,
  unique (org_id, email)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  user_id uuid references public.users(id),
  module text not null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  event_type text not null,
  actor_id uuid,
  payload jsonb not null default '{}'::jsonb,
  status text default 'pending' check (status in ('pending','processing','completed','failed')),
  attempts integer default 0,
  created_at timestamptz default now(),
  processed_at timestamptz,
  locked_at timestamptz,
  last_error text,
  failed_at timestamptz
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  user_id uuid not null references public.users(id),
  title text not null,
  body text,
  module text not null,
  entity_type text,
  entity_id uuid,
  channel text not null default 'in_app' check (channel in ('in_app','email','push','sms','whatsapp')),
  status text default 'unread' check (status in ('unread','read','dismissed')),
  sent_at timestamptz default now(),
  email_status text not null default 'none' check (email_status in ('none','pending','sent','failed')),
  emailed_at timestamptz
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  uploaded_by uuid not null,
  file_name text not null,
  file_path text not null,
  file_size integer,
  mime_type text,
  entity_type text,
  entity_id uuid,
  created_at timestamptz default now()
);

create table if not exists public.feature_access (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  subject_type text not null check (subject_type in ('role','user')),
  subject_key text not null,
  feature_key text not null,
  allowed boolean not null,
  updated_at timestamptz not null default now(),
  unique (org_id, subject_type, subject_key, feature_key)
);

-- org_id is assigned by Atllanta (v1.2.2) ------------------------------------

create or replace function public.users_guard_admin_fields()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'org_id is assigned by Atllanta and cannot be changed'
      using errcode = '42501';
  end if;
  if is_org_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.role := 'member';
    return new;
  end if;
  new.role := old.role;
  new.status := old.status;
  new.org_id := old.org_id;
  new.department_id := old.department_id;
  new.team_id := old.team_id;
  new.reporting_manager_id := old.reporting_manager_id;
  new.designation := old.designation;
  new.date_of_joining := old.date_of_joining;
  return new;
end;
$function$;

drop trigger if exists trg_users_guard_admin_fields on public.users;
create trigger trg_users_guard_admin_fields
  before insert or update on public.users
  for each row execute function public.users_guard_admin_fields();

-- Event bus RPCs (the events table has no INSERT policy on purpose) ----------

create or replace function public.publish_event(p_event_type text, p_payload jsonb default '{}'::jsonb, p_org_id uuid default null)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare v_org uuid; v_id uuid;
begin
  if p_event_type is null or length(btrim(p_event_type)) = 0 then
    raise exception 'publish_event: event_type is required';
  end if;
  if p_org_id is not null then
    if p_org_id not in (select auth_user_org_ids()) then
      raise exception 'publish_event: not a member of org %', p_org_id using errcode = '42501';
    end if;
    v_org := p_org_id;
  else
    select o into v_org from auth_user_org_ids() o limit 1;
  end if;
  if v_org is null then
    raise exception 'publish_event: no organisation for the caller' using errcode = '42501';
  end if;
  insert into events (org_id, event_type, actor_id, payload)
  values (v_org, p_event_type, auth.uid(), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.claim_events(batch_size integer default 20)
returns setof events language plpgsql security definer set search_path to 'public'
as $function$
begin
  return query
  update events e set status = 'processing', attempts = e.attempts + 1, locked_at = now()
  where e.id in (
    select id from events
    where status = 'pending' and org_id in (select auth_user_org_ids())
    order by created_at limit greatest(batch_size, 1) for update skip locked
  )
  returning e.*;
end;
$function$;

create or replace function public.resolve_event(event_id uuid, new_status text, p_error text default null)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new_status not in ('completed','failed','pending') then
    raise exception 'resolve_event: invalid status %', new_status;
  end if;
  update events set
    status = new_status,
    locked_at = case when new_status = 'processing' then locked_at else null end,
    processed_at = case when new_status = 'completed' then now() else processed_at end,
    failed_at = case when new_status = 'failed' then now() else failed_at end,
    last_error = case when new_status = 'completed' then null else left(p_error, 500) end
  where id = event_id and org_id in (select auth_user_org_ids());
end;
$function$;

-- Row level security ---------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.departments enable row level security;
alter table public.teams enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_logs enable row level security;
alter table public.events enable row level security;
alter table public.notifications enable row level security;
alter table public.files enable row level security;
alter table public.feature_access enable row level security;

create policy organizations_self on public.organizations
  for select using (id = auth_org_id());
create policy organizations_admin_update on public.organizations
  for update using (id = auth_org_id() and is_org_admin())
  with check (id = auth_org_id() and is_org_admin());

create policy users_select on public.users
  for select using ((org_id in (select auth_user_org_ids())) or (id = auth.uid()));
create policy users_insert on public.users
  for insert with check (((id = auth.uid()) or is_org_admin()) and (org_id in (select auth_user_org_ids())));
create policy users_update on public.users
  for update using ((id = auth.uid()) or is_org_admin())
  with check (((id = auth.uid()) or is_org_admin()) and org_id = auth_org_id());

create policy dept_select on public.departments
  for select using (org_id in (select auth_user_org_ids()));
create policy dept_insert on public.departments
  for insert with check ((org_id in (select auth_user_org_ids())) and is_org_admin());
create policy dept_update on public.departments
  for update using ((org_id in (select auth_user_org_ids())) and is_org_admin());
create policy dept_delete on public.departments
  for delete using ((org_id in (select auth_user_org_ids())) and is_org_admin());

create policy teams_select on public.teams
  for select using (org_id in (select auth_user_org_ids()));
create policy teams_insert on public.teams
  for insert with check ((org_id in (select auth_user_org_ids())) and is_org_admin());
create policy teams_update on public.teams
  for update using ((org_id in (select auth_user_org_ids())) and is_org_admin());
create policy teams_delete on public.teams
  for delete using ((org_id in (select auth_user_org_ids())) and is_org_admin());

create policy invitations_admin_all on public.invitations
  for all using (org_id = auth_org_id() and is_org_admin())
  with check (org_id = auth_org_id() and is_org_admin());

create policy audit_select on public.audit_logs
  for select using (org_id in (select auth_user_org_ids()));

create policy events_select on public.events
  for select using (org_id in (select auth_user_org_ids()));

create policy notif_select on public.notifications
  for select using (user_id = auth.uid());
create policy notif_insert on public.notifications
  for insert with check (org_id in (select auth_user_org_ids()));
create policy notif_update on public.notifications
  for update using (user_id = auth.uid());

create policy files_select on public.files
  for select using (org_id in (select auth_user_org_ids()));
create policy files_insert on public.files
  for insert with check (org_id in (select auth_user_org_ids()));
create policy files_delete on public.files
  for delete using (uploaded_by = auth.uid());

create policy feature_access_select on public.feature_access
  for select using ((org_id in (select auth_user_org_ids()))
    and (is_org_admin() or hr_can_configure() or (subject_type = 'role')
         or (subject_type = 'user' and subject_key = (auth.uid())::text)));
create policy feature_access_insert on public.feature_access
  for insert with check ((org_id in (select auth_user_org_ids())) and (is_org_admin() or hr_can_configure()));
create policy feature_access_update on public.feature_access
  for update using ((org_id in (select auth_user_org_ids())) and (is_org_admin() or hr_can_configure()));
create policy feature_access_delete on public.feature_access
  for delete using ((org_id in (select auth_user_org_ids())) and (is_org_admin() or hr_can_configure()));

-- The API roles Supabase ships with; RLS decides what they can see.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
