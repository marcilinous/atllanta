-- v1.9.1: attendance integrity (security). Found 2026-09-30 when starting the
-- Phase 4 attendance port, confirmed on production in a rolled-back probe as
-- a plain RTcompu member, who could: mark a colleague present with any time;
-- rewrite their own check-in time ("late" -> "present") with no
-- regularisation; submit a regularisation already approved; approve their
-- own regularisation; and create a work schedule. The policies checked only
-- the organisation, and the geofence trigger skips rows that are not the
-- caller's own and never looks at a check-in set by a later update.
--
-- The legitimate writes this keeps working (legacy screens + processors):
--   - self check-in: insert your own row, status 'present', check-in now
--     (attendance/dashboard.js, me/index.js);
--   - self check-out: set your own check_out once, with total hours and the
--     check-out location/selfie;
--   - a regularisation request for your own attendance, pending;
--   - an approver (admin, the reporting line, or a manager over the
--     department) approving/rejecting someone else's request and then
--     correcting that person's attendance row (approvals.js, inbox.js,
--     attendance/regularize.js);
--   - the server event processor (service role) marking lateness and
--     on-leave days — service role is exempt from every guard here.
--
-- Same approver rule as leave (owner decision 2026-09-29, option a): nobody
-- approves their own; an owner's or admin's needs an admin or another owner.

-- A. attendance -----------------------------------------------------------------

drop policy if exists att_insert on public.attendance;
create policy att_insert on public.attendance
  for insert with check (org_id = auth_org_id() and user_id = auth.uid());

create or replace function public.attendance_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner_role text;
begin
  if auth.uid() is null then
    return new; -- service role / server code
  end if;

  if tg_op = 'INSERT' then
    -- A check-in is today's, by you, now — not a backdated or finished day.
    if new.check_in is null or abs(extract(epoch from (new.check_in - now()))) > 900 then
      raise exception 'Check in at the time you arrive' using errcode = '42501';
    end if;
    if abs(new.date - (now() at time zone 'utc')::date) > 1 then
      raise exception 'Attendance is recorded for today' using errcode = '42501';
    end if;
    if coalesce(new.status, 'present') <> 'present' or new.check_out is not null or new.total_hours is not null then
      raise exception 'A check-in starts as present, without a check-out' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.org_id is distinct from old.org_id or new.user_id is distinct from old.user_id
     or new.date is distinct from old.date or new.created_at is distinct from old.created_at then
    raise exception 'An attendance record cannot be moved' using errcode = '42501';
  end if;

  if old.user_id = auth.uid() then
    -- Your own row: only the check-out, once, at the time you leave.
    if new.check_in is distinct from old.check_in
       or new.check_in_lat is distinct from old.check_in_lat or new.check_in_lng is distinct from old.check_in_lng
       or new.check_in_selfie_path is distinct from old.check_in_selfie_path
       or new.check_in_location_id is distinct from old.check_in_location_id
       or new.status is distinct from old.status or new.notes is distinct from old.notes then
      raise exception 'Ask for a regularisation to change your attendance' using errcode = '42501';
    end if;
    if new.check_out is distinct from old.check_out then
      if old.check_out is not null then
        raise exception 'You have already checked out' using errcode = '42501';
      end if;
      if new.check_out is null or abs(extract(epoch from (new.check_out - now()))) > 900 then
        raise exception 'Check out at the time you leave' using errcode = '42501';
      end if;
    elsif new.total_hours is distinct from old.total_hours
       or new.check_out_lat is distinct from old.check_out_lat or new.check_out_lng is distinct from old.check_out_lng
       or new.check_out_selfie_path is distinct from old.check_out_selfie_path
       or new.check_out_location_id is distinct from old.check_out_location_id then
      raise exception 'Ask for a regularisation to change your attendance' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Someone else's row (RLS already limits this to admins, the reporting
  -- line and managers over the department): an owner's or admin's needs an
  -- admin or another owner.
  select u.role into v_owner_role from public.users u where u.id = old.user_id;
  if v_owner_role in ('owner', 'admin') and not is_org_admin() then
    raise exception 'An owner''s or admin''s attendance is corrected by an admin or another owner' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.attendance_guard() from public, anon, authenticated;

drop trigger if exists trg_attendance_guard on public.attendance;
create trigger trg_attendance_guard
  before insert or update on public.attendance
  for each row execute function public.attendance_guard();

-- B. attendance_regularizations ------------------------------------------------

drop policy if exists attreg_insert on public.attendance_regularizations;
create policy attreg_insert on public.attendance_regularizations
  for insert with check (
    org_id = auth_org_id()
    and user_id = auth.uid()
    and coalesce(status, 'pending') = 'pending'
    and reviewed_by is null and reviewed_at is null
    and exists (select 1 from public.attendance a where a.id = attendance_id and a.user_id = auth.uid())
  );

create or replace function public.attendance_regularizations_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_requester_role text;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.org_id is distinct from old.org_id or new.user_id is distinct from old.user_id
     or new.attendance_id is distinct from old.attendance_id or new.reason is distinct from old.reason
     or new.requested_check_in is distinct from old.requested_check_in
     or new.requested_check_out is distinct from old.requested_check_out
     or new.created_at is distinct from old.created_at then
    raise exception 'A regularisation request cannot be changed after it is submitted' using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    if new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at then
      raise exception 'A regularisation request cannot be changed after it is submitted' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status is distinct from 'pending' then
    raise exception 'Only a pending regularisation can be approved or rejected' using errcode = '42501';
  end if;
  if new.status not in ('approved', 'rejected') then
    raise exception 'That status change is not allowed' using errcode = '42501';
  end if;
  if old.user_id = auth.uid() then
    raise exception 'You cannot approve or reject your own regularisation' using errcode = '42501';
  end if;
  select u.role into v_requester_role from public.users u where u.id = old.user_id;
  if v_requester_role in ('owner', 'admin') then
    if not is_org_admin() then
      raise exception 'An owner''s or admin''s regularisation is approved by an admin or another owner' using errcode = '42501';
    end if;
  elsif not (
    is_org_admin()
    or old.user_id in (select user_report_ids())
    or (hr_can_approve() and old.user_id in (select hr_visible_user_ids()))
  ) then
    raise exception 'You cannot approve or reject this regularisation' using errcode = '42501';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end;
$function$;

revoke all on function public.attendance_regularizations_guard() from public, anon, authenticated;

drop trigger if exists trg_attendance_regularizations_guard on public.attendance_regularizations;
create trigger trg_attendance_regularizations_guard
  before update on public.attendance_regularizations
  for each row execute function public.attendance_regularizations_guard();

-- C. work_schedules: owners and admins only ------------------------------------

drop policy if exists ws_insert on public.work_schedules;
create policy ws_insert on public.work_schedules
  for insert with check ((org_id in (select auth_user_org_ids())) and hr_can_configure());

drop policy if exists ws_update on public.work_schedules;
create policy ws_update on public.work_schedules
  for update
  using ((org_id in (select auth_user_org_ids())) and hr_can_configure())
  with check ((org_id in (select auth_user_org_ids())) and hr_can_configure());
