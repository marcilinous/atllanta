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

create policy crm_partner_details_insert on public.crm_partner_details
  for insert with check (org_id in (select auth_user_org_ids()));

create policy crm_partner_details_update on public.crm_partner_details
  for update using (org_id in (select auth_user_org_ids()))
  with check (org_id in (select auth_user_org_ids()));

create policy crm_partner_details_delete on public.crm_partner_details
  for delete using (org_id in (select auth_user_org_ids()) and crm_user_is_manager_plus());