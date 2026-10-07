-- v1.16.2: assets integrity (security). Found 2026-10-07 when starting the
-- Phase 4 assets port. Before this, on the live rules:
--   - every member could read the whole asset register — purchase costs,
--     serial numbers, notes, who holds what — and its full history; only the
--     legacy screen (owners/admins only) hid it, the database did not;
--   - nothing kept an asset's status, its holder and its history in step: an
--     asset could be "assigned" with nobody holding it, held while "available",
--     held by someone from another company or who has left, or carry two
--     open assignment records; the history itself could be rewritten or
--     deleted, and the legacy screen ignored a failed history write.
-- Production had 0 assets and 0 assignment records when this was written; the
-- People module is switched on for two companies.
--
-- The legitimate writes this keeps working (legacy people/assets.js, then the
-- new stack, which does each step in one transaction):
--   - an owner/admin adding, editing, retiring or deleting an unassigned asset;
--   - assigning: the asset is given its holder, then a history record is added
--     for that same person;
--   - returning: the asset is cleared, then its open record is closed;
--   - deleting an asset takes its history with it (on delete cascade);
--   - the server event processor (service role): exempt, as everywhere.
--
-- Owner decision 2026-10-07 (option a): owners and admins see every asset;
-- everyone else sees only what is assigned to them, and their own history.

-- A. Who sees what ----------------------------------------------------------------

drop policy if exists org_isolation_select on public.assets;
create policy assets_select on public.assets
  for select using (
    org_id = auth_org_id()
    and (is_org_admin() or assigned_to = auth.uid())
  );

drop policy if exists org_isolation_select on public.asset_assignments;
create policy asset_assignments_select on public.asset_assignments
  for select using (
    org_id = auth_org_id()
    and (is_org_admin() or user_id = auth.uid())
  );

-- B. Who writes: owners and admins of the company (the guards decide what) --------

drop policy if exists org_isolation_insert on public.assets;
drop policy if exists org_isolation_update on public.assets;
drop policy if exists org_isolation_delete on public.assets;
create policy assets_insert on public.assets
  for insert with check (org_id = auth_org_id() and is_org_admin());
create policy assets_update on public.assets
  for update using (org_id = auth_org_id() and is_org_admin())
  with check (org_id = auth_org_id() and is_org_admin());
create policy assets_delete on public.assets
  for delete using (org_id = auth_org_id() and is_org_admin());

drop policy if exists org_isolation_insert on public.asset_assignments;
drop policy if exists org_isolation_update on public.asset_assignments;
drop policy if exists org_isolation_delete on public.asset_assignments;
create policy asset_assignments_insert on public.asset_assignments
  for insert with check (org_id = auth_org_id() and is_org_admin());
create policy asset_assignments_update on public.asset_assignments
  for update using (org_id = auth_org_id() and is_org_admin())
  with check (org_id = auth_org_id() and is_org_admin());
create policy asset_assignments_delete on public.asset_assignments
  for delete using (org_id = auth_org_id() and is_org_admin());

-- C. Status, holder and history agree ----------------------------------------------

alter table public.assets
  add constraint assets_holder_consistent check (
    (status = 'assigned') = (assigned_to is not null)
    and (assigned_to is null) = (assigned_at is null)
  );

alter table public.assets
  add constraint assets_purchase_cost_nonnegative check (purchase_cost is null or purchase_cost >= 0);

create unique index asset_assignments_one_open
  on public.asset_assignments (asset_id) where returned_at is null;

-- D. The asset guard -----------------------------------------------------------------

create or replace function public.assets_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return coalesce(new, old); -- service role / server code
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'assigned' then
      raise exception 'Return this asset before deleting it' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'assigned' or new.assigned_to is not null or new.assigned_at is not null then
      raise exception 'Add the asset first, then assign it' using errcode = '42501';
    end if;
    new.created_by := auth.uid();
    return new;
  end if;

  -- UPDATE
  if new.org_id is distinct from old.org_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'An asset cannot be moved to another company or re-attributed' using errcode = '42501';
  end if;

  if new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to then
    if old.assigned_to is not null then
      raise exception 'Return this asset before assigning it again' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.users u
      where u.id = new.assigned_to and u.org_id = new.org_id and u.status <> 'exited'
    ) then
      raise exception 'That person is not a current member of this company' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.assets_guard() from public, anon, authenticated;

drop trigger if exists trg_assets_guard on public.assets;
create trigger trg_assets_guard
  before insert or update or delete on public.assets
  for each row execute function public.assets_guard();

-- E. The history guard ---------------------------------------------------------------
-- A record is added only for the asset's current holder, stamped by the
-- database; afterwards the only write is closing it, once the asset has been
-- returned. It is deleted only together with its asset.

create or replace function public.asset_assignments_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return coalesce(new, old); -- service role / server code
  end if;

  if tg_op = 'DELETE' then
    -- During the cascade from a deleted asset, the asset is already gone.
    if exists (select 1 from public.assets a where a.id = old.asset_id) then
      raise exception 'Assignment history cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.assets a
      where a.id = new.asset_id and a.org_id = new.org_id and a.assigned_to = new.user_id
    ) then
      raise exception 'Assign the asset to this person first' using errcode = '42501';
    end if;
    new.assigned_by := auth.uid();
    new.assigned_at := now();
    new.returned_at := null;
    return new;
  end if;

  -- UPDATE: only closing an open record.
  if new.id is distinct from old.id
     or new.org_id is distinct from old.org_id
     or new.asset_id is distinct from old.asset_id
     or new.user_id is distinct from old.user_id
     or new.assigned_at is distinct from old.assigned_at
     or new.assigned_by is distinct from old.assigned_by
     or new.notes is distinct from old.notes then
    raise exception 'Assignment history cannot be changed' using errcode = '42501';
  end if;
  if old.returned_at is not null or new.returned_at is null then
    raise exception 'Assignment history cannot be changed' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.assets a
    where a.id = old.asset_id and a.assigned_to = old.user_id
  ) then
    raise exception 'Mark the asset returned first' using errcode = '42501';
  end if;
  new.returned_at := now();
  return new;
end;
$function$;

revoke all on function public.asset_assignments_guard() from public, anon, authenticated;

drop trigger if exists trg_asset_assignments_guard on public.asset_assignments;
create trigger trg_asset_assignments_guard
  before insert or update or delete on public.asset_assignments
  for each row execute function public.asset_assignments_guard();
