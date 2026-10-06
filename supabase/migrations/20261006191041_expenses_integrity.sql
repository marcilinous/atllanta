-- v1.15.1: expenses integrity (security). Found 2026-10-07 when starting the
-- Phase 4 expenses port. Before this, on the live rules:
--   - every member could read every colleague's claims (select was org-wide);
--   - a claimant could change the amount, date or receipt of a claim after it
--     was approved (the old guard froze only the review fields);
--   - a claimant could delete a claim at any status, even once reimbursed;
--   - owners and admins skipped the guard: they could approve their own claim
--     and stamp anyone as the reviewer;
--   - managers were shown Approve/Reject, but the update policy let only
--     owners/admins touch someone else's row, so the click changed nothing
--     while the screen said "Expense approved";
--   - any manager in the org could read every receipt in storage.
-- Production had 0 expenses and 0 categories when this was written; Finance is
-- switched on for two companies.
--
-- The legitimate writes this keeps working (legacy finance/index.js and the
-- new stack after it):
--   - submit your own claim, pending;
--   - withdraw (delete) your own claim while it is pending;
--   - an approver approving/rejecting someone else's pending claim;
--   - an owner/admin marking an approved claim reimbursed;
--   - the server event processor (service role) — exempt, as everywhere.
--
-- Owner decision 2026-10-07 (option a): approvers are the same people as leave
-- (admins, the reporting line, a manager over the department); nobody approves
-- their own; an owner's or admin's claim needs an admin or another owner. Only
-- owners and admins mark a claim reimbursed — that is paying out money.

-- A. Who sees a claim: the same people who see that person's leave ------------

drop policy if exists org_isolation_select on public.expenses;
create policy exp_select on public.expenses
  for select using (
    org_id = auth_org_id()
    and (
      is_org_admin()
      or user_id = auth.uid()
      or user_id in (select user_report_ids())
      or user_id in (select hr_visible_user_ids())
    )
  );

-- B. Submitting: your own claim, pending, unreviewed ----------------------------

drop policy if exists org_isolation_insert on public.expenses;
create policy exp_insert on public.expenses
  for insert with check (
    org_id = auth_org_id()
    and user_id = auth.uid()
    and coalesce(status, 'pending') = 'pending'
    and reviewed_by is null and reviewed_at is null
    and review_comment is null and reimbursed_at is null
  );

-- C. Reviewing: approvers only (the guard decides which change is allowed) ------

drop policy if exists org_isolation_update on public.expenses;
create policy exp_update on public.expenses
  for update
  using (
    org_id = auth_org_id()
    and (
      is_org_admin()
      or user_id in (select user_report_ids())
      or (hr_can_approve() and user_id in (select hr_visible_user_ids()))
    )
  )
  with check (org_id = auth_org_id());

-- D. Withdrawing: your own claim, while it is pending ---------------------------

drop policy if exists org_isolation_delete on public.expenses;
create policy exp_delete on public.expenses
  for delete using (
    org_id = auth_org_id()
    and user_id = auth.uid()
    and status = 'pending'
  );

-- E. A claim is for a positive amount -------------------------------------------

alter table public.expenses
  add constraint expenses_amount_positive check (amount > 0);

-- F. The guard ------------------------------------------------------------------

drop trigger if exists trg_expenses_guard_review on public.expenses;
drop function if exists public.expenses_guard_review();

create or replace function public.expenses_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_claimant_role text;
begin
  if auth.uid() is null then
    return new; -- service role / server code
  end if;

  if tg_op = 'INSERT' then
    -- A category from another company is not yours to use.
    if new.category_id is not null and not exists (
      select 1 from public.expense_categories c
      where c.id = new.category_id and c.org_id = new.org_id
    ) then
      raise exception 'That expense category does not exist' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE: what was claimed never changes.
  if new.org_id is distinct from old.org_id
     or new.user_id is distinct from old.user_id
     or new.category_id is distinct from old.category_id
     or new.title is distinct from old.title
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.expense_date is distinct from old.expense_date
     or new.receipt_url is distinct from old.receipt_url
     or new.description is distinct from old.description
     or new.created_at is distinct from old.created_at then
    raise exception 'An expense claim cannot be changed after it is submitted' using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    if new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.review_comment is distinct from old.review_comment
       or new.reimbursed_at is distinct from old.reimbursed_at then
      raise exception 'An expense claim cannot be changed after it is submitted' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.user_id = auth.uid() then
    raise exception 'You cannot review your own expense claim' using errcode = '42501';
  end if;

  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    select u.role into v_claimant_role from public.users u where u.id = old.user_id;
    if v_claimant_role in ('owner', 'admin') then
      if not is_org_admin() then
        raise exception 'An owner''s or admin''s claim is approved by an admin or another owner' using errcode = '42501';
      end if;
    elsif not (
      is_org_admin()
      or old.user_id in (select user_report_ids())
      or (hr_can_approve() and old.user_id in (select hr_visible_user_ids()))
    ) then
      raise exception 'You cannot approve or reject this expense claim' using errcode = '42501';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    new.reimbursed_at := null;
    return new;
  end if;

  if old.status = 'approved' and new.status = 'reimbursed' then
    if not is_org_admin() then
      raise exception 'Only an owner or admin can mark a claim reimbursed' using errcode = '42501';
    end if;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.review_comment := old.review_comment;
    new.reimbursed_at := now();
    return new;
  end if;

  raise exception 'That status change is not allowed' using errcode = '42501';
end;
$function$;

revoke all on function public.expenses_guard() from public, anon, authenticated;

drop trigger if exists trg_expenses_guard on public.expenses;
create trigger trg_expenses_guard
  before insert or update on public.expenses
  for each row execute function public.expenses_guard();

-- G. Receipts: readable by whoever can see the claim ----------------------------
-- The subqueries run under the expenses select policy above, so a receipt is
-- readable by its uploader and by exactly the people who can see its claim.
-- Its uploader can delete it only while no reviewed claim points at it (an
-- upload abandoned before submitting, or a pending claim); owners and admins
-- keep their delete, as before.

drop policy if exists documents_expenses_read on storage.objects;
create policy documents_expenses_read on storage.objects
  for select to authenticated using (
    bucket_id = 'documents'
    and split_part(name, '/', 1) = 'expenses'
    and storage_path_uuid(split_part(name, '/', 2)) = auth_org_id()
    and (
      owner = auth.uid()
      or exists (select 1 from public.expenses e where e.receipt_url = objects.name)
    )
  );

drop policy if exists documents_expenses_delete on storage.objects;
create policy documents_expenses_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'documents'
    and split_part(name, '/', 1) = 'expenses'
    and storage_path_uuid(split_part(name, '/', 2)) = auth_org_id()
    and (
      is_org_admin()
      or (
        owner = auth.uid()
        and not exists (
          select 1 from public.expenses e
          where e.receipt_url = objects.name and e.status <> 'pending'
        )
      )
    )
  );
