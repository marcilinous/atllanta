-- ============================================================
-- CRM PARTNER ACTIVITY (coverage opportunities)
-- ============================================================
-- Per-partner activity used to derive the Opportunities lists:
--   TP / TSS activation counts split by fiscal year (Apr–Mar): CFY current,
--   LFY prior. LFY populates once last year's Activation report is uploaded
--   (rows classified by activation date). visited / called flags come from
--   the visit / telecalling reports. Scoped to the caller's visibility.
-- ============================================================

CREATE OR REPLACE FUNCTION crm_partner_activity()
RETURNS TABLE(
  account_id uuid, name text, external_id text, district_new text, region text, owner_id uuid,
  tp_cfy int, tp_lfy int, tss_cfy int, tss_lfy int, any_cfy int, any_lfy int,
  visited boolean, called boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    SELECT rr.account_id,
      rr.data->>'activation type' AS atype,
      CASE WHEN left(rr.data->>'activation date',10) ~ '^\d{4}-\d{2}-\d{2}$'
           THEN left(rr.data->>'activation date',10)::date END AS adate
    FROM crm_report_rows rr JOIN crm_report_imports i ON i.id = rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.report_type ILIKE 'Sales' AND rr.account_id IS NOT NULL
  ),
  agg AS (
    SELECT account_id,
      count(*) FILTER (WHERE atype='New' AND adate BETWEEN cfy_start AND cfy_end) AS tp_cfy,
      count(*) FILTER (WHERE atype='New' AND adate BETWEEN lfy_start AND lfy_end) AS tp_lfy,
      count(*) FILTER (WHERE atype='TSS' AND adate BETWEEN cfy_start AND cfy_end) AS tss_cfy,
      count(*) FILTER (WHERE atype='TSS' AND adate BETWEEN lfy_start AND lfy_end) AS tss_lfy,
      count(*) FILTER (WHERE adate BETWEEN cfy_start AND cfy_end) AS any_cfy,
      count(*) FILTER (WHERE adate BETWEEN lfy_start AND lfy_end) AS any_lfy
    FROM sales GROUP BY account_id
  ),
  vis AS (
    SELECT DISTINCT rr.account_id FROM crm_report_rows rr JOIN crm_report_imports i ON i.id=rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.name ILIKE '%visit%' AND rr.account_id IS NOT NULL
  ),
  cal AS (
    SELECT DISTINCT rr.account_id FROM crm_report_rows rr JOIN crm_report_imports i ON i.id=rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids())
      AND (i.name ILIKE '%telecall%' OR i.name ILIKE '%followup%' OR i.columns @> ARRAY['Call Status'])
      AND rr.account_id IS NOT NULL
  )
  SELECT ac.id, ac.name, ac.external_id, ac.district_new, ac.region, ac.owner_id,
    COALESCE(g.tp_cfy,0), COALESCE(g.tp_lfy,0), COALESCE(g.tss_cfy,0), COALESCE(g.tss_lfy,0),
    COALESCE(g.any_cfy,0), COALESCE(g.any_lfy,0),
    (v.account_id IS NOT NULL), (c.account_id IS NOT NULL)
  FROM acct ac
  LEFT JOIN agg g ON g.account_id = ac.id
  LEFT JOIN vis v ON v.account_id = ac.id
  LEFT JOIN cal c ON c.account_id = ac.id;
END $$;

REVOKE ALL ON FUNCTION crm_partner_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_partner_activity() TO authenticated;
