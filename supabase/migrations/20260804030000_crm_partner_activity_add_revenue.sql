-- ============================================================
-- crm_partner_activity(): add activation revenue per partner
-- ============================================================
-- So the territory view can be a business scorecard (revenue + TP/TSS +
-- opportunity) rather than an activity/reach tree. rev_cfy / rev_lfy sum
-- "sum of activation value" per partner within the current / last fiscal year.
-- ============================================================

DROP FUNCTION IF EXISTS crm_partner_activity();

CREATE OR REPLACE FUNCTION crm_partner_activity()
RETURNS TABLE(
  account_id uuid, name text, external_id text, district_new text, region text, owner_id uuid,
  tp_cfy int, tp_lfy int, tss_cfy int, tss_lfy int, any_cfy int, any_lfy int,
  rev_cfy numeric, rev_lfy numeric,
  visited boolean, called boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  cfy_start date := make_date(EXTRACT(year FROM current_date)::int - CASE WHEN EXTRACT(month FROM current_date) >= 4 THEN 0 ELSE 1 END, 4, 1);
  cfy_end date; lfy_start date; lfy_end date;
BEGIN
  cfy_end   := (cfy_start + interval '1 year - 1 day')::date;
  lfy_start := (cfy_start - interval '1 year')::date;
  lfy_end   := (cfy_start - interval '1 day')::date;
  RETURN QUERY
  WITH acct AS (
    SELECT a.id, a.name, a.external_id, a.district_new, a.region, a.owner_id
    FROM crm_accounts a
    WHERE a.org_id IN (SELECT auth_user_org_ids())
      AND (crm_user_is_org_admin() OR a.owner_id = auth.uid() OR a.owner_id IN (SELECT crm_report_ids()))
  ),
  sales AS (
    SELECT rr.account_id AS acct_id,
      rr.data->>'activation type' AS atype,
      CASE WHEN rr.data->>'sum of activation value' ~ '^-?[0-9]+(\.[0-9]+)?$'
           THEN (rr.data->>'sum of activation value')::numeric ELSE 0 END AS rev,
      CASE WHEN left(rr.data->>'activation date',10) ~ '^\d{4}-\d{2}-\d{2}$'
           THEN left(rr.data->>'activation date',10)::date END AS adate
    FROM crm_report_rows rr JOIN crm_report_imports i ON i.id = rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.report_type ILIKE 'Sales' AND rr.account_id IS NOT NULL
  ),
  agg AS (
    SELECT s.acct_id,
      count(*) FILTER (WHERE s.atype='New' AND s.adate BETWEEN cfy_start AND cfy_end)::int AS tp_cfy,
      count(*) FILTER (WHERE s.atype='New' AND s.adate BETWEEN lfy_start AND lfy_end)::int AS tp_lfy,
      count(*) FILTER (WHERE s.atype='TSS' AND s.adate BETWEEN cfy_start AND cfy_end)::int AS tss_cfy,
      count(*) FILTER (WHERE s.atype='TSS' AND s.adate BETWEEN lfy_start AND lfy_end)::int AS tss_lfy,
      count(*) FILTER (WHERE s.adate BETWEEN cfy_start AND cfy_end)::int AS any_cfy,
      count(*) FILTER (WHERE s.adate BETWEEN lfy_start AND lfy_end)::int AS any_lfy,
      COALESCE(sum(s.rev) FILTER (WHERE s.adate BETWEEN cfy_start AND cfy_end),0) AS rev_cfy,
      COALESCE(sum(s.rev) FILTER (WHERE s.adate BETWEEN lfy_start AND lfy_end),0) AS rev_lfy
    FROM sales s GROUP BY s.acct_id
  ),
  vis AS (
    SELECT DISTINCT rr.account_id AS acct_id FROM crm_report_rows rr JOIN crm_report_imports i ON i.id=rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.name ILIKE '%visit%' AND rr.account_id IS NOT NULL
  ),
  cal AS (
    SELECT DISTINCT rr.account_id AS acct_id FROM crm_report_rows rr JOIN crm_report_imports i ON i.id=rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids())
      AND (i.name ILIKE '%telecall%' OR i.name ILIKE '%followup%' OR i.columns @> ARRAY['Call Status'])
      AND rr.account_id IS NOT NULL
  )
  SELECT ac.id, ac.name, ac.external_id, ac.district_new, ac.region, ac.owner_id,
    COALESCE(g.tp_cfy,0), COALESCE(g.tp_lfy,0), COALESCE(g.tss_cfy,0), COALESCE(g.tss_lfy,0),
    COALESCE(g.any_cfy,0), COALESCE(g.any_lfy,0), COALESCE(g.rev_cfy,0), COALESCE(g.rev_lfy,0),
    (v.acct_id IS NOT NULL), (c.acct_id IS NOT NULL)
  FROM acct ac
  LEFT JOIN agg g ON g.acct_id = ac.id
  LEFT JOIN vis v ON v.acct_id = ac.id
  LEFT JOIN cal c ON c.acct_id = ac.id;
END $$;

REVOKE ALL ON FUNCTION crm_partner_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_partner_activity() TO authenticated;
