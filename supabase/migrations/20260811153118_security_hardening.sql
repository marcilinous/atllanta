revoke execute on function public.crm_coverage() from anon;
revoke execute on function public.crm_partner_activity() from anon;
revoke execute on function public.crm_sales_by(text, text, text) from anon;
revoke execute on function public.crm_seed_default_stages(uuid) from anon;
revoke execute on function public.crm_seed_stages_on_org() from anon;
revoke execute on function public.crm_telecaller_book(text) from anon;
revoke execute on function public.crm_telecaller_names() from anon;
revoke execute on function public.crm_uncovered_partners(uuid) from anon;
revoke execute on function public.claim_events(integer) from anon;
revoke execute on function public.resolve_event(uuid, text) from anon;

alter function public.auth_accessible_client_ids() set search_path = public;
alter function public.auth_user_org_ids() set search_path = public;
alter function public.create_self_client() set search_path = public;
alter function public.geo_distance_m(numeric, numeric, numeric, numeric) set search_path = public;