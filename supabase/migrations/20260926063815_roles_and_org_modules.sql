-- Phase 3 Step 1: roles, role_permissions, org_modules, and users.custom_role_id.
--
-- Nothing in the application reads these tables yet — this migration only
-- creates the schema, its RLS policies, its seed data, and the SQL mirror of
-- the module gate (module_enabled()). Enforcement (the legacy nav reading
-- org_modules, and Server Actions calling module_enabled()) ships in later
-- Phase 3 steps.
--
-- A. Widens users.role's live CHECK (users_role_check — currently
--    owner/admin/manager/member and not tracked by any migration) to add
--    'developer', ending the drift noted in the Phase 3 plan.
-- B. roles: one row per org role — five system rows seeded per org
--    (owner/admin/developer/manager/member) plus any custom roles an org
--    creates. System rows are immutable (trg_roles_guard_system).
-- C. role_permissions: per-role module/permission grants for custom
--    (non-system) roles only; system roles get their defaults in code
--    (permissions.ts, Step 2), not rows here.
-- D. org_modules: one row per org per module key, seeded off for every org
--    (owner decision: existing orgs start with every module off). Rows are
--    seeded by seed_org_platform_rows(); there is no insert/delete policy —
--    users can only flip is_enabled on a row that already exists.
-- E. users.custom_role_id: an optional pointer to a custom (non-system) role
--    in the same org. A user always keeps a base users.role too — the
--    legacy app and RLS only understand users.role until each module's
--    cutover (Phase 3 plan, decision 2).
-- F. Extends users_guard_admin_fields() (from 20260926055357) to validate
--    and protect custom_role_id, without changing any of its existing
--    behaviour.
-- G. Seeds the five system roles and the 13 org_modules rows for every
--    existing organisation, and for every new one via trigger.
-- H. module_enabled(org, key): the SQL mirror of the module gate, used by
--    RLS and, later, Server Actions.

-- ---------------------------------------------------------------------------
-- A. users.role: add 'developer', and record the CHECK in a migration.
-- ---------------------------------------------------------------------------

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('owner','admin','developer','manager','member'));

-- ---------------------------------------------------------------------------
-- B. roles
-- ---------------------------------------------------------------------------

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  is_system boolean not null default false,
  description text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);

create index on public.roles (org_id);

alter table public.roles enable row level security;

create policy roles_select on public.roles
  for select using (org_id = auth_org_id());

create policy roles_insert on public.roles
  for insert with check (org_id = auth_org_id() and is_org_admin() and is_system = false);

create policy roles_update on public.roles
  for update
  using (org_id = auth_org_id() and is_org_admin() and is_system = false)
  with check (org_id = auth_org_id() and is_org_admin() and is_system = false);

create policy roles_delete on public.roles
  for delete using (org_id = auth_org_id() and is_org_admin() and is_system = false);

create or replace function public.roles_guard_system()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.is_system and auth.uid() is not null then
    raise exception 'System roles cannot be changed or deleted' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and auth.uid() is not null
     and (new.org_id is distinct from old.org_id or new.is_system = true) then
    raise exception 'System roles cannot be changed or deleted' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create trigger trg_roles_guard_system
  before update or delete on public.roles
  for each row execute function public.roles_guard_system();

-- ---------------------------------------------------------------------------
-- C. role_permissions
-- ---------------------------------------------------------------------------

create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  module_key text not null check (module_key in (
    'people','me','inbox','documents','finance','announcements',
    'recruitment','crm','crm_partner','analytics','helpdesk','projects','ai'
  )),
  permission text not null check (permission in ('view','create','edit','delete','approve')),
  created_at timestamptz not null default now(),
  unique (role_id, module_key, permission)
);

create index on public.role_permissions (role_id);

alter table public.role_permissions enable row level security;

create policy role_permissions_select on public.role_permissions
  for select using (org_id = auth_org_id());

create policy role_permissions_insert on public.role_permissions
  for insert with check (
    org_id = auth_org_id() and is_org_admin()
    and exists (
      select 1 from public.roles r
      where r.id = role_id and r.org_id = role_permissions.org_id and not r.is_system
    )
  );

create policy role_permissions_update on public.role_permissions
  for update
  using (
    org_id = auth_org_id() and is_org_admin()
    and exists (
      select 1 from public.roles r
      where r.id = role_id and r.org_id = role_permissions.org_id and not r.is_system
    )
  )
  with check (
    org_id = auth_org_id() and is_org_admin()
    and exists (
      select 1 from public.roles r
      where r.id = role_id and r.org_id = role_permissions.org_id and not r.is_system
    )
  );

create policy role_permissions_delete on public.role_permissions
  for delete using (
    org_id = auth_org_id() and is_org_admin()
    and exists (
      select 1 from public.roles r
      where r.id = role_id and r.org_id = role_permissions.org_id and not r.is_system
    )
  );

-- ---------------------------------------------------------------------------
-- D. org_modules — rows are seeded (part G), never created/removed by users.
-- ---------------------------------------------------------------------------

create table public.org_modules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null check (module_key in (
    'people','me','inbox','documents','finance','announcements',
    'recruitment','crm','crm_partner','analytics','helpdesk','projects','ai'
  )),
  is_enabled boolean not null default false,
  enabled_by uuid references public.users(id) on delete set null,
  enabled_at timestamptz,
  unique (org_id, module_key)
);

alter table public.org_modules enable row level security;

create policy org_modules_select on public.org_modules
  for select using (org_id = auth_org_id());

create policy org_modules_update on public.org_modules
  for update
  using (org_id = auth_org_id() and is_org_admin())
  with check (org_id = auth_org_id() and is_org_admin());

-- No insert/delete policy: rows are seeded by seed_org_platform_rows() and
-- never created or removed by users.

-- ---------------------------------------------------------------------------
-- E. users.custom_role_id
-- ---------------------------------------------------------------------------

alter table public.users add column custom_role_id uuid references public.roles(id) on delete set null;

create index on public.users (custom_role_id);

-- ---------------------------------------------------------------------------
-- F. users_guard_admin_fields(): extend the v1.3.2 guard (20260926055357) to
--    validate and protect custom_role_id. Everything else is byte-identical
--    to that migration's body.
-- ---------------------------------------------------------------------------

create or replace function public.users_guard_admin_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- A custom role must belong to the caller's own org and be one of that
  -- org's custom (non-system) roles. This holds for everyone, including
  -- service-role writes, so it runs before the service-role bypass below.
  if new.custom_role_id is not null and not exists (
    select 1 from public.roles r
    where r.id = new.custom_role_id and r.org_id = new.org_id and not r.is_system
  ) then
    raise exception 'A custom role must be one of this organisation''s custom roles' using errcode = '42501';
  end if;

  -- Service role / server code: Atllanta assigns org_id and admin fields.
  if auth.uid() is null then
    return new;
  end if;

  -- Nobody signed in may move a user between organisations, admins included.
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'org_id is assigned by Atllanta and cannot be changed'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    -- Nobody may change their own role.
    if old.id = auth.uid() then
      raise exception 'You cannot change your own role' using errcode = '42501';
    end if;
    -- Only an owner may grant or remove the owner role.
    if (old.role = 'owner' or new.role = 'owner') and not is_org_owner() then
      raise exception 'Only an owner can grant or remove the owner role' using errcode = '42501';
    end if;
    -- An org must always keep at least one owner.
    if old.role = 'owner' and not exists (select 1 from public.users u where u.org_id = old.org_id and u.role = 'owner' and u.id <> old.id) then
      raise exception 'An organisation must keep at least one owner' using errcode = '42501';
    end if;
  end if;

  -- Changing your own custom_role_id is a role change too.
  if tg_op = 'UPDATE' and new.custom_role_id is distinct from old.custom_role_id and old.id = auth.uid() then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and new.role = 'owner' and not is_org_owner() then
    raise exception 'Only an owner can grant or remove the owner role' using errcode = '42501';
  end if;

  if is_org_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.role := 'member';
    new.custom_role_id := null;
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
  new.custom_role_id := old.custom_role_id;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- G. Seed the five system roles and the 13 org_modules rows, per org.
-- ---------------------------------------------------------------------------

create or replace function public.seed_org_platform_rows(p_org uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.roles (org_id, name, slug, is_system)
  values
    (p_org, 'Owner', 'owner', true),
    (p_org, 'Admin', 'admin', true),
    (p_org, 'Developer', 'developer', true),
    (p_org, 'Manager', 'manager', true),
    (p_org, 'Member', 'member', true)
  on conflict (org_id, slug) do nothing;

  insert into public.org_modules (org_id, module_key, is_enabled)
  values
    (p_org, 'people', false),
    (p_org, 'me', false),
    (p_org, 'inbox', false),
    (p_org, 'documents', false),
    (p_org, 'finance', false),
    (p_org, 'announcements', false),
    (p_org, 'recruitment', false),
    (p_org, 'crm', false),
    (p_org, 'crm_partner', false),
    (p_org, 'analytics', false),
    (p_org, 'helpdesk', false),
    (p_org, 'projects', false),
    (p_org, 'ai', false)
  on conflict (org_id, module_key) do nothing;
$function$;

revoke all on function public.seed_org_platform_rows(uuid) from public, anon, authenticated;

create or replace function public.organizations_seed_platform_rows()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.seed_org_platform_rows(new.id);
  return new;
end;
$function$;

create trigger trg_organizations_seed_platform_rows
  after insert on public.organizations
  for each row execute function public.organizations_seed_platform_rows();

-- Backfill: seed every existing organisation the same way (five system
-- roles, 13 org_modules rows all off). Idempotent via the ON CONFLICT
-- clauses above.
select public.seed_org_platform_rows(id) from public.organizations;

-- ---------------------------------------------------------------------------
-- H. module_enabled(): the SQL mirror of the module gate.
-- ---------------------------------------------------------------------------

create or replace function public.module_enabled(p_org uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when auth.uid() is not null and p_org is distinct from auth_org_id() then false
    else coalesce((select is_enabled from public.org_modules where org_id = p_org and module_key = p_key), false)
  end;
$function$;

revoke all on function public.module_enabled(uuid, text) from public, anon;
grant execute on function public.module_enabled(uuid, text) to authenticated;
