-- v1.7.1: leave integrity (security). Found 2026-09-29 while starting the
-- Phase 4 leave port, confirmed on production in a rolled-back probe: any
-- signed-in member could approve their own leave, give themselves or a
-- colleague any leave balance, add company holidays, and submit a request
-- already marked approved — the policies only checked the organisation.
-- The browser event processor also trusted a leave event's payload (days,
-- person, leave type), so a forged event could deduct a colleague's balance.
--
-- Owner decision 2026-09-29 (option a): nobody approves their own leave; an
-- owner's or admin's leave is approved by an admin or another owner.
--
-- A. leave_requests: a new request must be the caller's own and pending; a
--    guard trigger allows only these changes by a signed-in caller —
--    the requester cancels their own pending request; an approver (admin,
--    the reporting line, or a manager over the requester's department)
--    approves or rejects someone else's pending request, stamping
--    reviewed_by/reviewed_at from the database, not the client. Nothing else
--    about a submitted request changes.
-- B. leave_balances: only owners/admins (hr_can_configure()) insert/update.
-- C. holidays: only owners/admins insert/update/delete (the screens that
--    edit them were already owner/admin-only).
-- D. apply_approved_leave_usage(request, event): the one way a leave
--    deduction happens. Security definer; reads the real request; deducts
--    only if it is approved and in the caller's organisation; exactly once
--    per request (advisory lock + per-request side-effect key, also honouring
--    the pre-v1.2.5 bare 'leave_used' key). Both event processors call it.
--    apply_leave_usage() is withdrawn from signed-in users (service role
--    keeps it).
-- E. init_leave_balances(user): a new employee's default balances, for the
--    browser processor, which runs as whichever member claims the event.

-- A. leave_requests ------------------------------------------------------------

drop policy if exists lr_insert on public.leave_requests;
create policy lr_insert on public.leave_requests
  for insert with check (
    org_id = auth_org_id()
    and user_id = auth.uid()
    and coalesce(status, 'pending') = 'pending'
    and reviewed_by is null and reviewed_at is null and review_comment is null
  );

create or replace function public.leave_requests_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_requester_role text;
begin
  -- Service role / server code (event processor, imports).
  if auth.uid() is null then
    return new;
  end if;

  if new.org_id is distinct from old.org_id
     or new.user_id is distinct from old.user_id
     or new.leave_type_id is distinct from old.leave_type_id
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or new.days is distinct from old.days
     or new.reason is distinct from old.reason
     or new.document_url is distinct from old.document_url
     or new.created_at is distinct from old.created_at then
    raise exception 'A leave request cannot be changed after it is submitted' using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    if new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.review_comment is distinct from old.review_comment then
      raise exception 'A leave request cannot be changed after it is submitted' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status is distinct from 'pending' then
    raise exception 'Only a pending leave request can be approved, rejected or cancelled' using errcode = '42501';
  end if;

  if new.status = 'cancelled' then
    if old.user_id <> auth.uid() then
      raise exception 'Only the person who asked can cancel a leave request' using errcode = '42501';
    end if;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.review_comment := old.review_comment;
    return new;
  end if;

  if new.status in ('approved', 'rejected') then
    if old.user_id = auth.uid() then
      raise exception 'You cannot approve or reject your own leave request' using errcode = '42501';
    end if;
    select u.role into v_requester_role from public.users u where u.id = old.user_id;
    if v_requester_role in ('owner', 'admin') then
      if not is_org_admin() then
        raise exception 'An owner''s or admin''s leave is approved by an admin or another owner' using errcode = '42501';
      end if;
    elsif not (
      is_org_admin()
      or old.user_id in (select user_report_ids())
      or (hr_can_approve() and old.user_id in (select hr_visible_user_ids()))
    ) then
      raise exception 'You cannot approve or reject this leave request' using errcode = '42501';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    return new;
  end if;

  raise exception 'That status change is not allowed' using errcode = '42501';
end;
$function$;

revoke all on function public.leave_requests_guard() from public, anon, authenticated;

drop trigger if exists trg_leave_requests_guard on public.leave_requests;
create trigger trg_leave_requests_guard
  before update on public.leave_requests
  for each row execute function public.leave_requests_guard();

-- B. leave_balances ------------------------------------------------------------

drop policy if exists lb_insert on public.leave_balances;
create policy lb_insert on public.leave_balances
  for insert with check ((org_id in (select auth_user_org_ids())) and hr_can_configure());

drop policy if exists lb_update on public.leave_balances;
create policy lb_update on public.leave_balances
  for update
  using ((org_id in (select auth_user_org_ids())) and hr_can_configure())
  with check ((org_id in (select auth_user_org_ids())) and hr_can_configure());

-- C. holidays ------------------------------------------------------------------

drop policy if exists hol_insert on public.holidays;
create policy hol_insert on public.holidays
  for insert with check ((org_id in (select auth_user_org_ids())) and hr_can_configure());

drop policy if exists hol_update on public.holidays;
create policy hol_update on public.holidays
  for update
  using ((org_id in (select auth_user_org_ids())) and hr_can_configure())
  with check ((org_id in (select auth_user_org_ids())) and hr_can_configure());

drop policy if exists hol_delete on public.holidays;
create policy hol_delete on public.holidays
  for delete using ((org_id in (select auth_user_org_ids())) and hr_can_configure());

-- D. apply_approved_leave_usage ------------------------------------------------

create or replace function public.apply_approved_leave_usage(p_leave_request_id uuid, p_event_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.leave_requests%rowtype;
  v_key text;
  v_used numeric;
begin
  select * into r from public.leave_requests where id = p_leave_request_id;
  if not found then
    return null;
  end if;
  if auth.uid() is not null and r.org_id is distinct from auth_org_id() then
    raise exception 'apply_approved_leave_usage: request not in caller org' using errcode = '42501';
  end if;
  if r.status is distinct from 'approved' or coalesce(r.days, 0) <= 0 then
    return null;
  end if;

  v_key := 'leave_used:' || r.id::text;
  -- One deduction per request, even with both processors racing.
  perform pg_advisory_xact_lock(hashtext(v_key));

  if exists (select 1 from public.event_side_effects where effect_key = v_key)
     or exists (
       select 1 from public.event_side_effects s
       join public.events e on e.id = s.event_id
       where s.effect_key = 'leave_used'
         and e.event_type = 'leave.request.approved'
         and e.payload->>'leave_request_id' = r.id::text
     ) then
    return null;
  end if;

  insert into public.event_side_effects (event_id, effect_key) values (p_event_id, v_key);

  insert into public.leave_balances (org_id, user_id, leave_type_id, year, opening_balance, accrued, used)
  values (r.org_id, r.user_id, r.leave_type_id, extract(year from r.start_date)::int, 0, 0, r.days)
  on conflict (user_id, leave_type_id, year)
  do update set used = coalesce(public.leave_balances.used, 0) + excluded.used
  returning used into v_used;

  return v_used;
end;
$function$;

revoke all on function public.apply_approved_leave_usage(uuid, uuid) from public, anon;
grant execute on function public.apply_approved_leave_usage(uuid, uuid) to authenticated, service_role;

revoke execute on function public.apply_leave_usage(uuid, uuid, integer, numeric) from public, anon, authenticated;

-- E. init_leave_balances -------------------------------------------------------

create or replace function public.init_leave_balances(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
  v_n integer;
begin
  select org_id into v_org from public.users where id = p_user_id;
  if v_org is null then
    return 0;
  end if;
  if auth.uid() is not null and v_org is distinct from auth_org_id() then
    raise exception 'init_leave_balances: person not in caller org' using errcode = '42501';
  end if;

  insert into public.leave_balances (org_id, user_id, leave_type_id, year, opening_balance, accrued, used)
  select v_org, p_user_id, lt.id, extract(year from now())::int, coalesce(lt.annual_quota, 0), 0, 0
  from public.leave_types lt
  where lt.org_id = v_org and coalesce(lt.is_active, true)
  on conflict (user_id, leave_type_id, year) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.init_leave_balances(uuid) from public, anon;
grant execute on function public.init_leave_balances(uuid) to authenticated, service_role;
