-- The live-function design did not survive measurement: reading ~88k wide
-- JSONB report rows per call cost 5.7s, most of it TOAST decompression of
-- crm_report_rows.data. Split instead into the expensive org-wide part
-- (materialised, refreshed daily) and the cheap per-user scoping (live).
--
-- The MV deliberately contains NO auth.uid() logic — it is one row per
-- partner across all orgs. Per-user visibility is applied on read by
-- crm_opportunity_features(). Because a materialised view cannot carry RLS,
-- access is revoked from the API roles below: only the SECURITY DEFINER
-- functions may read it.

DROP MATERIALIZED VIEW IF EXISTS crm_opportunity_features_mv CASCADE;

CREATE MATERIALIZED VIEW crm_opportunity_features_mv AS
WITH bounds AS (
  SELECT make_date(
    EXTRACT(year FROM current_date)::int
      - CASE WHEN EXTRACT(month FROM current_date) >= 4 THEN 0 ELSE 1 END, 4, 1) AS cfy_start
),
b AS (
  SELECT cfy_start,
         (cfy_start + interval '1 year - 1 day')::date AS cfy_end,
         (cfy_start - interval '1 year')::date         AS lfy_start,
         (cfy_start - interval '1 day')::date          AS lfy_end
  FROM bounds
),
acct AS (
  SELECT a.id, a.org_id, a.name, a.external_id, a.hub, a.district_new, a.region,
         a.owner_id, a.telecaller, a.customer_count, a.customer_base_active_3y
  FROM crm_accounts a
  -- Kerala is out of scope for the opportunity engine, once, here.
  WHERE COALESCE(a.region, '') <> 'Kerala'
),
sales AS MATERIALIZED (
  SELECT rr.account_id AS acct_id,
    rr.data->>'activation type' AS atype,
    CASE WHEN rr.data->>'sum of activation value' ~ '^-?[0-9]+(\.[0-9]+)?$'
         THEN (rr.data->>'sum of activation value')::numeric ELSE 0 END AS rev,
    crm_report_event_date(rr.data->>'activation date') AS adate
  FROM crm_report_rows rr
  WHERE rr.account_id IS NOT NULL
    AND rr.import_id IN (SELECT id FROM crm_report_imports WHERE report_type ILIKE 'Sales')
),
sagg AS (
  SELECT s.acct_id,
    COALESCE(sum(s.rev) FILTER (WHERE s.atype='TSS' AND s.adate BETWEEN b.lfy_start AND b.lfy_end),0) AS tss_lfy_value,
    count(*) FILTER (WHERE s.atype='TSS' AND s.adate BETWEEN b.cfy_start AND b.cfy_end)::int AS tss_cfy_count,
    COALESCE(sum(s.rev) FILTER (WHERE s.atype='TSS' AND s.adate BETWEEN b.cfy_start AND b.cfy_end),0) AS tss_cfy_value,
    COALESCE(sum(s.rev) FILTER (WHERE s.atype='New' AND s.adate BETWEEN b.lfy_start AND b.lfy_end),0) AS tp_lfy_value,
    COALESCE(sum(s.rev) FILTER (WHERE s.atype='New' AND s.adate BETWEEN b.cfy_start AND b.cfy_end),0) AS tp_cfy_value,
    count(*) FILTER (WHERE s.atype='New' AND s.adate BETWEEN b.lfy_start AND b.lfy_end)::int AS tp_lfy_count,
    count(*) FILTER (WHERE s.atype='New' AND s.adate BETWEEN b.cfy_start AND b.cfy_end)::int AS tp_cfy_count,
    COALESCE(sum(s.rev) FILTER (WHERE s.adate BETWEEN b.lfy_start AND b.lfy_end),0) AS rev_lfy,
    COALESCE(sum(s.rev) FILTER (WHERE s.adate BETWEEN b.cfy_start AND b.cfy_end),0) AS rev_cfy,
    count(*) FILTER (WHERE s.adate BETWEEN b.cfy_start AND b.cfy_end)::int AS any_cfy_count
  FROM sales s CROSS JOIN b GROUP BY s.acct_id
),
visit AS MATERIALIZED (
  SELECT rr.account_id AS acct_id, crm_report_event_date(rr.data->>'Visited Date') AS vdate
  FROM crm_report_rows rr
  WHERE rr.account_id IS NOT NULL
    AND rr.import_id IN (SELECT id FROM crm_report_imports WHERE name ILIKE '%visit%')
  UNION ALL
  SELECT v.account_id, v.visited_at::date FROM crm_visits v WHERE v.account_id IS NOT NULL
),
vagg AS (
  SELECT vv.acct_id,
    count(*)::int AS visits_total,
    count(*) FILTER (WHERE vv.vdate >= current_date - 90)::int AS visits_last_90d,
    count(*) FILTER (WHERE vv.vdate >= b.cfy_start)::int AS visits_since_lapse,
    max(vv.vdate) AS last_visit_date
  FROM visit vv CROSS JOIN b WHERE vv.vdate IS NOT NULL GROUP BY vv.acct_id
),
call AS MATERIALIZED (
  SELECT rr.account_id AS acct_id, crm_report_event_date(rr.data->>'Called Date') AS cdate
  FROM crm_report_rows rr
  WHERE rr.account_id IS NOT NULL
    AND rr.import_id IN (SELECT id FROM crm_report_imports
                         WHERE name ILIKE '%telecall%' OR name ILIKE '%followup%'
                            OR columns @> ARRAY['Call Status'])
  UNION ALL
  SELECT c.account_id, c.called_at::date FROM crm_calls c WHERE c.account_id IS NOT NULL
),
cagg AS (
  SELECT cc.acct_id,
    count(*)::int AS calls_total,
    count(*) FILTER (WHERE cc.cdate >= b.cfy_start)::int AS calls_this_cycle,
    max(cc.cdate) AS last_call_date
  FROM call cc CROSS JOIN b WHERE cc.cdate IS NOT NULL GROUP BY cc.acct_id
)
SELECT
  a.id AS account_id, a.org_id, a.name, a.external_id, a.hub, a.district_new,
  a.region, a.owner_id, a.telecaller, a.customer_count, a.customer_base_active_3y,
  COALESCE(g.tss_lfy_value,0) AS tss_lfy_value,
  COALESCE(g.tss_cfy_count,0) AS tss_cfy_count,
  COALESCE(g.tss_cfy_value,0) AS tss_cfy_value,
  COALESCE(g.tp_lfy_value,0)  AS tp_lfy_value,
  COALESCE(g.tp_cfy_value,0)  AS tp_cfy_value,
  COALESCE(g.tp_lfy_count,0)  AS tp_lfy_count,
  COALESCE(g.tp_cfy_count,0)  AS tp_cfy_count,
  COALESCE(g.rev_lfy,0) AS rev_lfy,
  COALESCE(g.rev_cfy,0) AS rev_cfy,
  COALESCE(g.any_cfy_count,0) AS any_cfy_count,
  COALESCE(v.visits_total,0) AS visits_total,
  COALESCE(v.visits_last_90d,0) AS visits_last_90d,
  COALESCE(v.visits_since_lapse,0) AS visits_since_lapse,
  v.last_visit_date,
  COALESCE(c.calls_total,0) AS calls_total,
  COALESCE(c.calls_this_cycle,0) AS calls_this_cycle,
  c.last_call_date,
  CASE WHEN COALESCE(v.visits_since_lapse,0) > 0
       THEN round(COALESCE(g.any_cfy_count,0)::numeric / v.visits_since_lapse, 3) END AS visit_conversion_rate,
  now() AS computed_at
FROM acct a
LEFT JOIN sagg g ON g.acct_id = a.id
LEFT JOIN vagg v ON v.acct_id = a.id
LEFT JOIN cagg c ON c.acct_id = a.id;

-- Unique index enables REFRESH ... CONCURRENTLY (no read blocking).
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_opp_mv_account ON crm_opportunity_features_mv (account_id);
CREATE INDEX IF NOT EXISTS idx_crm_opp_mv_org   ON crm_opportunity_features_mv (org_id);
CREATE INDEX IF NOT EXISTS idx_crm_opp_mv_owner ON crm_opportunity_features_mv (org_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_opp_mv_hub   ON crm_opportunity_features_mv (org_id, hub);

-- No RLS is possible on a materialised view, so the API roles must not read
-- it directly. Every caller goes through the SECURITY DEFINER functions,
-- which re-apply the same level-based scoping as crm_partner_activity().
REVOKE ALL ON crm_opportunity_features_mv FROM anon, authenticated;