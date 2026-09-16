CREATE OR REPLACE FUNCTION crm_report_event_date(txt text)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE d date;
BEGIN
  IF txt IS NULL OR btrim(txt) = '' THEN RETURN NULL; END IF;

  IF left(txt, 10) ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN RETURN left(txt, 10)::date; EXCEPTION WHEN others THEN RETURN NULL; END;
  END IF;

  IF txt ~ '^[A-Za-z]{3,} +\d{1,2} +\d{4}' THEN
    BEGIN
      RETURN to_date(regexp_replace(txt, '^([A-Za-z]{3,} +\d{1,2} +\d{4}).*$', '\1'), 'Mon FMDD YYYY');
    EXCEPTION WHEN others THEN RETURN NULL; END;
  END IF;

  IF txt ~ '^\d{1,2} +[A-Za-z]{3,}' THEN
    BEGIN
      d := to_date(
        regexp_replace(txt, '^(\d{1,2} +[A-Za-z]{3,}).*$', '\1') || ' ' ||
        EXTRACT(year FROM current_date)::int::text, 'FMDD Mon YYYY');
      IF d > current_date THEN d := (d - interval '1 year')::date; END IF;
      RETURN d;
    EXCEPTION WHEN others THEN RETURN NULL; END;
  END IF;

  RETURN NULL;
END $function$;

COMMENT ON FUNCTION crm_report_event_date(text) IS
  'Parse the three date formats used across CRM report imports. Year-less dates resolve to the most recent non-future occurrence.';

CREATE OR REPLACE FUNCTION crm_customer_value_per_head()
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    percentile_cont(0.5) WITHIN GROUP (
      ORDER BY (rr.data->>'sum of activation value')::numeric
    ),
    4500)
  FROM crm_report_rows rr
  JOIN crm_report_imports i ON i.id = rr.import_id
  WHERE i.org_id IN (SELECT auth_user_org_ids())
    AND i.report_type ILIKE 'Sales'
    AND rr.data->>'activation type' = 'TSS'
    AND rr.data->>'sum of activation value' ~ '^-?[0-9]+(\.[0-9]+)?$'
    AND (rr.data->>'sum of activation value')::numeric > 0;
$function$;

COMMENT ON FUNCTION crm_customer_value_per_head() IS
  'Rupee value of one end customer per year. Single swap point for when the Customer Base report gains a real value column.';

GRANT EXECUTE ON FUNCTION crm_report_event_date(text) TO authenticated;
GRANT EXECUTE ON FUNCTION crm_customer_value_per_head() TO authenticated;

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
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  cfy_start date := make_date(
    EXTRACT(year FROM current_date)::int
      - CASE WHEN EXTRACT(month FROM current_date) >= 4 THEN 0 ELSE 1 END, 4, 1);
  cfy_end date; lfy_start date; lfy_end date;
BEGIN
  cfy_end   := (cfy_start + interval '1 year - 1 day')::date;
  lfy_start := (cfy_start - interval '1 year')::date;
  lfy_end   := (cfy_start - interval '1 day')::date;

  RETURN QUERY
  WITH acct AS (
    SELECT a.id, a.name, a.external_id, a.hub, a.district_new, a.region,
           a.owner_id, a.telecaller, a.customer_count, a.customer_base_active_3y
    FROM crm_accounts a
    WHERE a.org_id IN (SELECT auth_user_org_ids())
      AND COALESCE(a.region, '') <> 'Kerala'
      AND (crm_user_is_org_admin()
           OR a.owner_id = auth.uid()
           OR a.owner_id IN (SELECT crm_report_ids()))
  ),
  sales AS (
    SELECT rr.account_id AS acct_id,
      rr.data->>'activation type' AS atype,
      CASE WHEN rr.data->>'sum of activation value' ~ '^-?[0-9]+(\.[0-9]+)?$'
           THEN (rr.data->>'sum of activation value')::numeric ELSE 0 END AS rev,
      crm_report_event_date(rr.data->>'activation date') AS adate
    FROM crm_report_rows rr
    JOIN crm_report_imports i ON i.id = rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids())
      AND i.report_type ILIKE 'Sales'
      AND rr.account_id IS NOT NULL
  ),
  sagg AS (
    SELECT s.acct_id,
      COALESCE(sum(s.rev) FILTER (WHERE s.atype = 'TSS' AND s.adate BETWEEN lfy_start AND lfy_end), 0) AS tss_lfy_value,
      count(*) FILTER (WHERE s.atype = 'TSS' AND s.adate BETWEEN cfy_start AND cfy_end)::int AS tss_cfy_count,
      COALESCE(sum(s.rev) FILTER (WHERE s.atype = 'TSS' AND s.adate BETWEEN cfy_start AND cfy_end), 0) AS tss_cfy_value,
      COALESCE(sum(s.rev) FILTER (WHERE s.atype = 'New' AND s.adate BETWEEN lfy_start AND lfy_end), 0) AS tp_lfy_value,
      COALESCE(sum(s.rev) FILTER (WHERE s.atype = 'New' AND s.adate BETWEEN cfy_start AND cfy_end), 0) AS tp_cfy_value,
      count(*) FILTER (WHERE s.atype = 'New' AND s.adate BETWEEN lfy_start AND lfy_end)::int AS tp_lfy_count,
      count(*) FILTER (WHERE s.atype = 'New' AND s.adate BETWEEN cfy_start AND cfy_end)::int AS tp_cfy_count,
      COALESCE(sum(s.rev) FILTER (WHERE s.adate BETWEEN lfy_start AND lfy_end), 0) AS rev_lfy,
      COALESCE(sum(s.rev) FILTER (WHERE s.adate BETWEEN cfy_start AND cfy_end), 0) AS rev_cfy,
      count(*) FILTER (WHERE s.adate BETWEEN cfy_start AND cfy_end)::int AS any_cfy_count
    FROM sales s GROUP BY s.acct_id
  ),
  visit AS (
    SELECT rr.account_id AS acct_id,
           crm_report_event_date(rr.data->>'Visited Date') AS vdate
    FROM crm_report_rows rr
    JOIN crm_report_imports i ON i.id = rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids())
      AND i.name ILIKE '%visit%'
      AND rr.account_id IS NOT NULL
    UNION ALL
    SELECT v.account_id, v.visited_at::date
    FROM crm_visits v
    WHERE v.org_id IN (SELECT auth_user_org_ids()) AND v.account_id IS NOT NULL
  ),
  vagg AS (
    SELECT vv.acct_id,
      count(*)::int AS visits_total,
      count(*) FILTER (WHERE vv.vdate >= current_date - 90)::int AS visits_last_90d,
      count(*) FILTER (WHERE vv.vdate >= cfy_start)::int AS visits_since_lapse,
      max(vv.vdate) AS last_visit_date
    FROM visit vv WHERE vv.vdate IS NOT NULL GROUP BY vv.acct_id
  ),
  call AS (
    SELECT rr.account_id AS acct_id,
           crm_report_event_date(rr.data->>'Called Date') AS cdate
    FROM crm_report_rows rr
    JOIN crm_report_imports i ON i.id = rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids())
      AND (i.name ILIKE '%telecall%' OR i.name ILIKE '%followup%'
           OR i.columns @> ARRAY['Call Status'])
      AND rr.account_id IS NOT NULL
    UNION ALL
    SELECT c.account_id, c.called_at::date
    FROM crm_calls c
    WHERE c.org_id IN (SELECT auth_user_org_ids()) AND c.account_id IS NOT NULL
  ),
  cagg AS (
    SELECT cc.acct_id,
      count(*)::int AS calls_total,
      count(*) FILTER (WHERE cc.cdate >= cfy_start)::int AS calls_this_cycle,
      max(cc.cdate) AS last_call_date
    FROM call cc WHERE cc.cdate IS NOT NULL GROUP BY cc.acct_id
  )
  SELECT
    a.id, a.name, a.external_id, a.hub, a.district_new, a.region, a.owner_id, a.telecaller,
    a.customer_count, a.customer_base_active_3y,
    COALESCE(g.tss_lfy_value, 0), COALESCE(g.tss_cfy_count, 0), COALESCE(g.tss_cfy_value, 0),
    COALESCE(g.tp_lfy_value, 0), COALESCE(g.tp_cfy_value, 0),
    COALESCE(g.tp_lfy_count, 0), COALESCE(g.tp_cfy_count, 0),
    COALESCE(g.rev_lfy, 0), COALESCE(g.rev_cfy, 0), COALESCE(g.any_cfy_count, 0),
    COALESCE(v.visits_total, 0), COALESCE(v.visits_last_90d, 0), COALESCE(v.visits_since_lapse, 0),
    v.last_visit_date,
    CASE WHEN v.last_visit_date IS NOT NULL
         THEN (current_date - v.last_visit_date)::int END,
    COALESCE(c.calls_total, 0), COALESCE(c.calls_this_cycle, 0), c.last_call_date,
    COALESCE(c.calls_this_cycle, 0) > 0,
    CASE WHEN COALESCE(v.visits_since_lapse, 0) > 0
         THEN round(COALESCE(g.any_cfy_count, 0)::numeric / v.visits_since_lapse, 3) END
  FROM acct a
  LEFT JOIN sagg g ON g.acct_id = a.id
  LEFT JOIN vagg v ON v.acct_id = a.id
  LEFT JOIN cagg c ON c.acct_id = a.id;
END $function$;

COMMENT ON FUNCTION crm_opportunity_features() IS
  'Per-partner inputs for the opportunity engine (Kerala excluded). Swap point if this ever needs materialising.';

GRANT EXECUTE ON FUNCTION crm_opportunity_features() TO authenticated;