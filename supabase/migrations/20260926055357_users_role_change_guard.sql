-- v1.3.2: only an owner may grant or remove the owner role.
--
-- Before: users_guard_admin_fields() returned early for any org admin
-- (is_org_admin()), so an admin could INSERT or UPDATE a user's role to
-- 'owner', or demote the last remaining owner, with nothing stopping it.
--
-- After: nobody may change their own role. Only an owner
-- (public.is_org_owner()) may grant and remove the owner role, on INSERT or
-- UPDATE. An organisation must always keep at least one owner: demoting the
-- last owner is refused. Everything else about the trigger (service-role
-- bypass, the org_id-is-assigned-by-Atllanta rule, the plain-member reset
-- branch) is unchanged.

create or replace function public.users_guard_admin_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
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

  if tg_op = 'INSERT' and new.role = 'owner' and not is_org_owner() then
    raise exception 'Only an owner can grant or remove the owner role' using errcode = '42501';
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
