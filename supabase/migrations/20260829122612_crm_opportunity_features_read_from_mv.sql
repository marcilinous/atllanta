-- Refresh entry point. CONCURRENTLY so readers are never blocked. Called by
-- the nightly Vercel cron (/api/event-processor) and on demand after a report
-- import; there is no pg_cron on this project.
CREATE OR REPLACE FUNCTION crm_refresh_opportunity_features()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT crm_user_is_org_admin() THEN
    RAISE EXCEPTION 'Only an org admin may refresh the opportunity engine';
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY crm_opportunity_features_mv;
  RETURN now();
END $function$;

COMMENT ON FUNCTION crm_refresh_opportunity_features() IS
  'Recompute the opportunity feature cache. Admin-only; run nightly and after any report import.';

GRANT EXECUTE ON FUNCTION crm_refresh_opportunity_features() TO authenticated;

-- When the engine last recomputed — surfaced in the UI so a stale score is
-- visible rather than silently trusted.
CREATE OR REPLACE FUNCTION crm_opportunity_computed_at()
RETURNS timestamptz
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT max(computed_at) FROM crm_opportunity_features_mv;
$function$;

GRANT EXECUTE ON FUNCTION crm_opportunity_computed_at() TO authenticated;

-- Reader: cheap per-user scoping over the cache. Date-relative fields
-- (days_since_visit) are derived here rather than stored, so they stay exact
-- between refreshes.
CREATE OR REPLACE FUNCTION crm_opportunity_features()
RETURNS TABLE(
  account_id uuid, name text, external_id text, hub text, district_new text,
  region text, owner_id uuid, telecaller text,
  customer_count integer, customer_base_active_3y boolean,
  tss_lfy_value numeric, tss_cfy_count integer, tss_cfy_value numeric,
  tp_lfy_value numeric, tp_cfy_value numeric,
  tp_lfy_count integer, tp_cfy_count integer,
  rev_lfy numeric, rev_cfy numeric, any_cfy_count integer,
  visits_total integer, visits_last_90d integer, visits_since_lapse integer,
  last_visit_date date, days_since_visit integer,
  calls_total integer, calls_this_cycle integer, last_call_date date,
  telecaller_contacted_this_cycle boolean,
  visit_conversion_rate numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT m.account_id, m.name, m.external_id, m.hub, m.district_new,
         m.region, m.owner_id, m.telecaller,
         m.customer_count, m.customer_base_active_3y,
         m.tss_lfy_value, m.tss_cfy_count, m.tss_cfy_value,
         m.tp_lfy_value, m.tp_cfy_value, m.tp_lfy_count, m.tp_cfy_count,
         m.rev_lfy, m.rev_cfy, m.any_cfy_count,
         m.visits_total, m.visits_last_90d, m.visits_since_lapse,
         m.last_visit_date,
         CASE WHEN m.last_visit_date IS NOT NULL
              THEN (current_date - m.last_visit_date)::int END,
         m.calls_total, m.calls_this_cycle, m.last_call_date,
         m.calls_this_cycle > 0,
         m.visit_conversion_rate
  FROM crm_opportunity_features_mv m
  WHERE m.org_id IN (SELECT auth_user_org_ids())
    AND (crm_user_is_org_admin()
         OR m.owner_id = auth.uid()
         OR m.owner_id IN (SELECT crm_report_ids()));
$function$;

COMMENT ON FUNCTION crm_opportunity_features() IS
  'Per-partner opportunity inputs, scoped to the caller. Reads the nightly cache; refresh with crm_refresh_opportunity_features().';

GRANT EXECUTE ON FUNCTION crm_opportunity_features() TO authenticated;

-- Benchmark now reads the cache instead of rescanning the raw report rows.
CREATE OR REPLACE FUNCTION crm_customer_value_per_head()
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    NULLIF(percentile_cont(0.75) WITHIN GROUP (
      ORDER BY m.rev_cfy / m.customer_count), 0),
    856)
  FROM crm_opportunity_features_mv m
  WHERE m.org_id IN (SELECT auth_user_org_ids())
    AND m.customer_count > 0;
$function$;

COMMENT ON FUNCTION crm_customer_value_per_head() IS
  'Peer benchmark: rupees a strong partner bills per end customer per year (75th percentile of actual, current FY). The single swap point for when the Customer Base report gains a real value column.';

GRANT EXECUTE ON FUNCTION crm_customer_value_per_head() TO authenticated;