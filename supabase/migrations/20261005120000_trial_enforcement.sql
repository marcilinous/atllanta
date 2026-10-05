-- v1.13.0: trial enforcement (spec docs/superpowers/specs/2026-10-05-trial-enforcement-design.md).
--
-- A company is blocked when its trial has ended or the platform owner paused
-- it (payment_status 'cancelled'). auth_org_id() — behind 176 of the 207
-- policies and every org-scoped function — returns null for a blocked
-- company, so it is refused everywhere at once; my_org_access() tells the
-- person why. The platform admin is never blocked; server code (no
-- auth.uid()) is unaffected. A guard stops company admins changing their
-- own billing and trial fields, which organizations_admin_update allowed.

-- 1. The one place the rule lives.
create or replace function public.org_access_state(p_status text, p_trial_ends_at timestamptz)
returns text
language sql
stable
set search_path to ''
as $function$
  select case
    when p_status = 'cancelled' then 'paused'
    when p_status = 'trial' and p_trial_ends_at is not null and p_trial_ends_at <= now() then 'trial_ended'
    else 'ok'
  end
$function$;

grant execute on function public.org_access_state(text, timestamptz) to authenticated;

-- 2. Extension counter; every company that exists today is active (owner, 2026-10-05).
alter table public.organizations add column if not exists trial_extended_days int not null default 0;
update public.organizations set payment_status = 'active' where payment_status <> 'active';

-- 3. The checkpoint.
create or replace function public.auth_org_id()
returns uuid
language sql
stable security definer
set search_path to ''
as $function$
  select u.org_id
  from public.users u
  join public.organizations o on o.id = u.org_id
  where u.id = auth.uid()
    and (public.org_access_state(o.payment_status, o.trial_ends_at) = 'ok'
         or public.is_platform_admin())
$function$;

-- 4. Why am I blocked? Reads the caller's own row, not through the checkpoint.
create or replace function public.my_org_access()
returns table(state text, org_name text, trial_ends_at timestamptz, role text)
language sql
stable security definer
set search_path to ''
as $function$
  select case when public.is_platform_admin() then 'ok'
              else public.org_access_state(o.payment_status, o.trial_ends_at) end,
         o.name, o.trial_ends_at, u.role
  from public.users u
  join public.organizations o on o.id = u.org_id
  where u.id = auth.uid()
$function$;

revoke all on function public.my_org_access() from public, anon;
grant execute on function public.my_org_access() to authenticated;

-- 5. Billing and trial fields are Atllanta's, not the company's.
create or replace function public.organizations_guard_billing_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or public.is_platform_admin() then
    return new;
  end if;
  if new.plan_tier is distinct from old.plan_tier
     or new.payment_status is distinct from old.payment_status
     or new.org_type is distinct from old.org_type
     or new.partner_crm_enabled is distinct from old.partner_crm_enabled
     or new.trial_started_at is distinct from old.trial_started_at
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.trial_extended_days is distinct from old.trial_extended_days
     or new.max_trial_extension_days is distinct from old.max_trial_extension_days
     or new.trial_candidate_cap is distinct from old.trial_candidate_cap
     or new.credits_included_monthly is distinct from old.credits_included_monthly
     or new.credit_overage_mode is distinct from old.credit_overage_mode
     or new.commission_percent is distinct from old.commission_percent
     or coalesce(new.credits_balance, 0) > coalesce(old.credits_balance, 0) then
    raise exception 'Billing and trial settings are managed by Atllanta' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_organizations_guard_billing_fields on public.organizations;
create trigger trg_organizations_guard_billing_fields
  before update on public.organizations
  for each row execute function public.organizations_guard_billing_fields();

-- 6. The platform owner's screen.
create or replace function public.platform_orgs()
returns table(id uuid, name text, people bigint, plan_tier text, payment_status text, state text,
              trial_ends_at timestamptz, trial_extended_days int, max_trial_extension_days int, created_at timestamptz)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';
  end if;
  return query
    select o.id, o.name,
           (select count(*) from public.users u where u.org_id = o.id),
           o.plan_tier, o.payment_status,
           public.org_access_state(o.payment_status, o.trial_ends_at),
           o.trial_ends_at, o.trial_extended_days, coalesce(o.max_trial_extension_days, 30), o.created_at
    from public.organizations o
    order by o.created_at;
end;
$function$;

create or replace function public.platform_activate_org(p_org uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';
  end if;
  select o.payment_status into v_old from public.organizations o where o.id = p_org for update;
  if not found then
    raise exception 'Company not found' using errcode = '22023';
  end if;
  update public.organizations set payment_status = 'active', updated_at = now() where id = p_org;
  insert into public.audit_logs (org_id, user_id, module, entity_type, entity_id, action, old_values, new_values)
  values (p_org, auth.uid(), 'platform', 'organization', p_org, 'activated',
          jsonb_build_object('payment_status', v_old), jsonb_build_object('payment_status', 'active'));
  insert into public.events (org_id, event_type, actor_id, payload)
  values (p_org, 'platform.org.activated', auth.uid(), jsonb_build_object('org_id', p_org, 'by', auth.uid()));
end;
$function$;

create or replace function public.platform_extend_trial(p_org uuid, p_days int)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_ends timestamptz;
  v_used int;
  v_cap int;
  v_new timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 14, 30) then
    raise exception 'Extend by 7, 14 or 30 days' using errcode = '22023';
  end if;
  select payment_status, trial_ends_at, trial_extended_days, coalesce(max_trial_extension_days, 30)
    into v_status, v_ends, v_used, v_cap
  from public.organizations where id = p_org for update;
  if not found then
    raise exception 'Company not found' using errcode = '22023';
  end if;
  if v_status <> 'trial' then
    raise exception 'Only a company on a trial can be extended' using errcode = '22023';
  end if;
  if v_used + p_days > v_cap then
    raise exception 'This would pass the %-day extension limit', v_cap using errcode = '22023';
  end if;
  v_new := greatest(coalesce(v_ends, now()), now()) + make_interval(days => p_days);
  update public.organizations
     set trial_ends_at = v_new, trial_extended_days = v_used + p_days, updated_at = now()
   where id = p_org;
  insert into public.audit_logs (org_id, user_id, module, entity_type, entity_id, action, old_values, new_values)
  values (p_org, auth.uid(), 'platform', 'organization', p_org, 'trial_extended',
          jsonb_build_object('trial_ends_at', v_ends, 'trial_extended_days', v_used),
          jsonb_build_object('trial_ends_at', v_new, 'trial_extended_days', v_used + p_days));
  insert into public.events (org_id, event_type, actor_id, payload)
  values (p_org, 'platform.org.trial_extended', auth.uid(),
          jsonb_build_object('org_id', p_org, 'by', auth.uid(), 'days', p_days, 'trial_ends_at', v_new));
  return v_new;
end;
$function$;

create or replace function public.platform_pause_org(p_org uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';
  end if;
  select o.payment_status into v_old from public.organizations o where o.id = p_org for update;
  if not found then
    raise exception 'Company not found' using errcode = '22023';
  end if;
  update public.organizations set payment_status = 'cancelled', updated_at = now() where id = p_org;
  insert into public.audit_logs (org_id, user_id, module, entity_type, entity_id, action, old_values, new_values)
  values (p_org, auth.uid(), 'platform', 'organization', p_org, 'paused',
          jsonb_build_object('payment_status', v_old), jsonb_build_object('payment_status', 'cancelled'));
  insert into public.events (org_id, event_type, actor_id, payload)
  values (p_org, 'platform.org.paused', auth.uid(), jsonb_build_object('org_id', p_org, 'by', auth.uid()));
end;
$function$;

revoke all on function public.platform_orgs() from public, anon;
grant execute on function public.platform_orgs() to authenticated;
revoke all on function public.platform_activate_org(uuid) from public, anon;
grant execute on function public.platform_activate_org(uuid) to authenticated;
revoke all on function public.platform_extend_trial(uuid, int) from public, anon;
grant execute on function public.platform_extend_trial(uuid, int) to authenticated;
revoke all on function public.platform_pause_org(uuid) from public, anon;
grant execute on function public.platform_pause_org(uuid) to authenticated;
