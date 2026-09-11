-- ATLLANTA — open crm_partner_details writes for partner onboarding.
--
-- BDEs (member role) onboard new partners and update existing ones; managers,
-- admins and owners can also delete. Read stays org-wide. Replaces the earlier
-- admin-only write policies from 20260728000000.

-- Manager-or-above check (owner/admin/manager), SECURITY DEFINER to avoid RLS
-- recursion when reading the caller's own users row.
create or replace function public.crm_user_is_manager_plus()
  returns boolean language sql security definer stable set search_path=public as $$
  select exists (
    select 1 from users
    where id = auth.uid() and role in ('owner','admin','manager')
  );
$$;

drop policy if exists crm_partner_details_insert on public.crm_partner_details;
drop policy if exists crm_partner_details_update on public.crm_partner_details;
drop policy if exists crm_partner_details_delete on public.crm_partner_details;

-- Any signed-in org member can onboard + edit partners.
create policy crm_partner_details_insert on public.crm_partner_details
  for insert with check (org_id in (select auth_user_org_ids()));

create policy crm_partner_details_update on public.crm_partner_details
  for update using (org_id in (select auth_user_org_ids()))
  with check (org_id in (select auth_user_org_ids()));

-- Only managers and above can delete.
create policy crm_partner_details_delete on public.crm_partner_details
  for delete using (org_id in (select auth_user_org_ids()) and crm_user_is_manager_plus());
