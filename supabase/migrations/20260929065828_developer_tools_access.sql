-- v1.7.0: the developer role may read and write the developer tools
-- (owner decision 2026-09-27, TRANSITION.md Decisions & Blockers item 2).
--
-- api_keys, webhook_endpoints and webhook_deliveries were owner/admin only
-- (is_org_admin()) on every policy. Each policy below is recreated exactly as
-- it was live on 2026-09-29, with is_org_admin() replaced by
-- can_manage_developer_tools(): owner, admin or developer, and never an
-- exited user. Nothing else changes — same org scoping (auth_user_org_ids()),
-- same created_by / acting_user_id stamping on insert, and webhook_deliveries
-- stays read-only (written by the server).
--
-- No application code used these tables at the time; the change only opens
-- them to developers for the tools that will.

create or replace function public.can_manage_developer_tools()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'developer')
      and coalesce(u.status, 'active') <> 'exited'
  );
$function$;

revoke all on function public.can_manage_developer_tools() from public, anon;
grant execute on function public.can_manage_developer_tools() to authenticated;

-- api_keys -------------------------------------------------------------------

drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys
  for select using ((org_id in (select auth_user_org_ids())) and can_manage_developer_tools());

drop policy if exists api_keys_insert on public.api_keys;
create policy api_keys_insert on public.api_keys
  for insert with check (
    (org_id in (select auth_user_org_ids())) and can_manage_developer_tools()
    and (created_by = auth.uid()) and (acting_user_id = auth.uid())
  );

drop policy if exists api_keys_update on public.api_keys;
create policy api_keys_update on public.api_keys
  for update using ((org_id in (select auth_user_org_ids())) and can_manage_developer_tools());

drop policy if exists api_keys_delete on public.api_keys;
create policy api_keys_delete on public.api_keys
  for delete using ((org_id in (select auth_user_org_ids())) and can_manage_developer_tools());

-- webhook_endpoints ----------------------------------------------------------

drop policy if exists webhook_endpoints_select on public.webhook_endpoints;
create policy webhook_endpoints_select on public.webhook_endpoints
  for select using ((org_id in (select auth_user_org_ids())) and can_manage_developer_tools());

drop policy if exists webhook_endpoints_insert on public.webhook_endpoints;
create policy webhook_endpoints_insert on public.webhook_endpoints
  for insert with check (
    (org_id in (select auth_user_org_ids())) and can_manage_developer_tools()
    and (created_by = auth.uid())
  );

drop policy if exists webhook_endpoints_update on public.webhook_endpoints;
create policy webhook_endpoints_update on public.webhook_endpoints
  for update using ((org_id in (select auth_user_org_ids())) and can_manage_developer_tools());

drop policy if exists webhook_endpoints_delete on public.webhook_endpoints;
create policy webhook_endpoints_delete on public.webhook_endpoints
  for delete using ((org_id in (select auth_user_org_ids())) and can_manage_developer_tools());

-- webhook_deliveries (read-only) ---------------------------------------------

drop policy if exists webhook_deliveries_select on public.webhook_deliveries;
create policy webhook_deliveries_select on public.webhook_deliveries
  for select using ((org_id in (select auth_user_org_ids())) and can_manage_developer_tools());
