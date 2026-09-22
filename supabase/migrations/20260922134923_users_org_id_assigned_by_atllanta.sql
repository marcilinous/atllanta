-- v1.2.2: org_id is assigned by Atllanta, never by a signed-in user.
--
-- Before: users_guard_admin_fields() reset org_id (and other admin fields) for
-- members, but returned early for owners/admins, and the users_update policy's
-- WITH CHECK never constrained org_id. Any tenant's owner/admin could set their
-- own org_id to another organisation and keep their role there.
--
-- After: on UPDATE, a changed org_id from any caller with a JWT (auth.uid() set,
-- admins included) is rejected. Server code using the service key has no
-- auth.uid() and still assigns org_id (org creation, invites). INSERT is
-- unchanged: users_insert already limits new rows to the caller's own org.

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
