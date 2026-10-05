-- v1.12.0: company sign-up (spec docs/superpowers/specs/2026-10-05-company-signup-design.md).
--
-- Self-serve company creation was removed on 2026-09-08 (Phase 1b) and never
-- rebuilt. organizations still has no insert policy; create_company() is the
-- only way a signed-in person without an organisation can create one, and it
-- makes them its owner in the same transaction.
--
-- 1. users_guard_admin_fields(): identical to the live function except one
--    clause. It lets create_company() insert the founding owner row: the
--    caller's own row, only while create_company's transaction-local marker
--    names this org, and only while the org has no users at all.
-- 2. create_company(): checks the caller and the input, then creates the org
--    (existing triggers seed roles, modules (off), CRM stages and AI quota
--    rows), the owner, the chosen modules, three leave types, an audit row
--    and the platform.org.created event.

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

  -- Founding owner (v1.12.0): create_company() inserts the first user of a
  -- brand-new organisation as its owner. Only the caller's own row, only
  -- while create_company's transaction-local marker names this org, and
  -- only while the org has no users at all.
  if tg_op = 'INSERT' and new.role = 'owner'
     and new.id = auth.uid()
     and current_setting('atllanta.bootstrap_org', true) = new.org_id::text
     and not exists (select 1 from public.users u where u.org_id = new.org_id) then
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

create or replace function public.create_company(p_name text, p_timezone text, p_currency text, p_modules text[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_known text[] := array['people', 'me', 'inbox', 'documents', 'finance', 'announcements', 'recruitment', 'crm', 'analytics', 'helpdesk', 'projects', 'ai'];
  v_org uuid;
  v_slug text;
  v_base text;
  v_email text;
  v_meta jsonb;
  v_full_name text;
  v_tries int := 0;
begin
  if v_uid is null then
    raise exception 'Sign in to create a company' using errcode = '42501';
  end if;
  if exists (select 1 from public.users where id = v_uid) then
    raise exception 'You already belong to an organisation' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'Company name must be 2 to 100 characters' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Choose a valid time zone' using errcode = '22023';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Choose a valid currency' using errcode = '22023';
  end if;
  if p_modules is null or cardinality(p_modules) = 0 then
    raise exception 'Choose at least one module' using errcode = '22023';
  end if;
  if not (p_modules <@ v_known) then
    raise exception 'Unknown module' using errcode = '22023';
  end if;

  select u.email, coalesce(u.raw_user_meta_data, '{}'::jsonb) into v_email, v_meta
  from auth.users u where u.id = v_uid;
  if v_email is null then
    raise exception 'Sign in to create a company' using errcode = '42501';
  end if;
  v_full_name := coalesce(
    nullif(btrim(v_meta->>'full_name'), ''),
    nullif(btrim(v_meta->>'name'), ''),
    split_part(v_email, '@', 1)
  );

  v_base := left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 40);
  if v_base = '' then
    v_base := 'org';
  end if;
  loop
    v_slug := v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
    exit when not exists (select 1 from public.organizations o where o.slug = v_slug);
    v_tries := v_tries + 1;
    if v_tries > 5 then
      raise exception 'Could not create the company, please try again';
    end if;
  end loop;

  insert into public.organizations (name, slug, org_type, timezone, currency)
  values (v_name, v_slug, 'direct', p_timezone, p_currency)
  returning id into v_org;

  perform set_config('atllanta.bootstrap_org', v_org::text, true);
  insert into public.users (id, org_id, email, full_name, avatar_url, role, status, date_of_joining)
  values (v_uid, v_org, v_email, v_full_name, nullif(v_meta->>'avatar_url', ''), 'owner', 'active',
          (now() at time zone p_timezone)::date);
  perform set_config('atllanta.bootstrap_org', '', true);

  update public.org_modules set is_enabled = true, enabled_by = v_uid, enabled_at = now()
  where org_id = v_org and module_key = any (p_modules);

  insert into public.leave_types (org_id, name, code, annual_quota, is_paid)
  values (v_org, 'Casual Leave', 'CL', 12, true),
         (v_org, 'Sick Leave', 'SL', 12, true),
         (v_org, 'Earned Leave', 'EL', 15, true);

  insert into public.audit_logs (org_id, user_id, module, entity_type, entity_id, action, new_values)
  values (v_org, v_uid, 'platform', 'organization', v_org, 'created',
          jsonb_build_object('name', v_name, 'slug', v_slug, 'modules', to_jsonb(p_modules)));

  insert into public.events (org_id, event_type, actor_id, payload)
  values (v_org, 'platform.org.created', v_uid,
          jsonb_build_object('org_id', v_org, 'owner_id', v_uid, 'name', v_name, 'modules', to_jsonb(p_modules)));

  return v_org;
end;
$function$;

revoke all on function public.create_company(text, text, text, text[]) from public, anon;
grant execute on function public.create_company(text, text, text, text[]) to authenticated;
