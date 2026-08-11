-- ============================================================
-- SECURITY HARDENING (audit remediation)
-- ============================================================
-- 1) Remove unauthenticated (anon) EXECUTE on directly-callable data/mutation
--    RPCs. SECURITY DEFINER means these bypass RLS, and they are only ever
--    invoked by authenticated users or the service role — anon has no
--    legitimate reason to call them. RLS *predicate* helper functions
--    (auth_user_org_ids, is_org_admin, hr_*, crm_report_ids, …) are deliberately
--    left executable so row-level policies keep evaluating for every role.
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

-- 1b) These are trigger / seed functions, never meant to be called as RPCs by
--     anyone. They were granted to PUBLIC, so lock them down entirely (triggers
--     and the service role still run them regardless of these grants).
revoke execute on function public.crm_seed_default_stages(uuid) from public, anon, authenticated;
revoke execute on function public.crm_seed_stages_on_org() from public, anon, authenticated;
revoke execute on function public.enforce_attendance_geofence() from public, anon, authenticated;

-- 2) Pin a stable search_path on the functions flagged by the database linter,
--    preventing search_path hijacking (linter 0011_function_search_path_mutable).
alter function public.auth_accessible_client_ids() set search_path = public;
alter function public.auth_user_org_ids() set search_path = public;
alter function public.create_self_client() set search_path = public;
alter function public.geo_distance_m(numeric, numeric, numeric, numeric) set search_path = public;
