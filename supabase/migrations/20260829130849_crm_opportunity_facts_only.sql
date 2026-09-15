-- Rebuild on observed facts only.
--
-- WHAT THE DATA ACTUALLY CONTAINS: an activation date, type and value per
-- purchase. There is NO expiry or due date anywhere. The previous version
-- inferred one by treating the financial-year boundary as a renewal boundary
-- ("TSS lapsed this year"), which flagged 865 partners when only 269 are
-- genuinely 12+ months past their last TSS — a partner who bought in March
-- 2026 is not due until March 2027. Every reason is now a statement of
-- something on file.
--
-- WINDOWS. Activations run from 2025-04-01, visits and calls only from
-- 2026-04-01. So "no visit on record" is really "no visit since Apr 2026" and
-- must be said that way. crm_report_windows() exposes the bounds so the UI
-- can date its own claims instead of implying "never".

DROP MATERIALIZED VIEW IF EXISTS crm_opportunity_features_mv CASCADE;

CREATE MATERIALIZED VIEW crm_opportunity_features_mv AS
WITH b AS (
  SELECT s AS cfy_start,
         (s + interval '1 year - 1 day')::date AS cfy_end,
         (s - interval '1 year')::date         AS lfy_start,
         (s - interval '1 day')::date          AS lfy_end
  FROM (SELECT make_date(EXTRACT(year FROM current_date)::int
          - CASE WHEN EXTRACT(month FROM current_date) >= 4 THEN 0 ELSE 1 END, 4, 1)) q(s)
),
acct AS (
  SELECT a.id, a.org_id, a.name, a.external_id, a.hub, a.district_new, a.region,
         a.owner_id, a.telecaller, a.customer_count, a.customer_base_active_3y
  FROM crm_accounts a
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
    -- Dates of the most recent purchase of each kind: the only renewal-ish
    -- signal the data supports.
    max(s.adate) FILTER (WHERE s.atype = 'TSS') AS last_tss_date,
    max(s.adate) FILTER (WHERE s.atype = 'New') AS last_tp_date,
    max(s.adate)                                AS last_activation_date,
    -- Real rupees, from 'sum of activation value'.
    COALESCE(sum(s.rev) FILTER (WHERE s.adate >= b.cfy_start), 0)                        AS value_this_fy,
    COALESCE(sum(s.rev) FILTER (WHERE s.adate BETWEEN b.lfy_start AND b.lfy_end), 0)     AS value_last_fy,
    COALESCE(sum(s.rev) FILTER (WHERE s.adate >= current_date - 365), 0)                 AS value_12m,
    COALESCE(sum(s.rev) FILTER (WHERE s.atype = 'TSS'), 0)                               AS tss_value_all,
    COALESCE(sum(s.rev) FILTER (WHERE s.atype = 'New'), 0)                               AS tp_value_all,
    count(*) FILTER (WHERE s.adate >= b.cfy_start)::int                                  AS purchases_this_fy
  FROM sales s CROSS JOIN b GROUP BY s.acct_id
),
lastact AS (
  SELECT DISTINCT ON (s.acct_id) s.acct_id, s.atype AS last_activation_type, s.rev AS last_activation_value
  FROM sales s WHERE s.adate IS NOT NULL ORDER BY s.acct_id, s.adate DESC, s.rev DESC
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
  SELECT vv.acct_id, count(*)::int AS visits_this_fy, max(vv.vdate) AS last_visit_date
  FROM visit vv CROSS JOIN b WHERE vv.vdate IS NOT NULL AND vv.vdate >= b.cfy_start
  GROUP BY vv.acct_id
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
  SELECT cc.acct_id, count(*)::int AS calls_this_fy, max(cc.cdate) AS last_call_date
  FROM call cc CROSS JOIN b WHERE cc.cdate IS NOT NULL AND cc.cdate >= b.cfy_start
  GROUP BY cc.acct_id
)
SELECT
  a.id AS account_id, a.org_id, a.name, a.external_id, a.hub, a.district_new,
  a.region, a.owner_id, a.telecaller, a.customer_count, a.customer_base_active_3y,
  g.last_tss_date, g.last_tp_date, g.last_activation_date,
  la.last_activation_type, COALESCE(la.last_activation_value, 0) AS last_activation_value,
  COALESCE(g.value_this_fy, 0) AS value_this_fy,
  COALESCE(g.value_last_fy, 0) AS value_last_fy,
  COALESCE(g.value_12m, 0) AS value_12m,
  COALESCE(g.tss_value_all, 0) AS tss_value_all,
  COALESCE(g.tp_value_all, 0) AS tp_value_all,
  COALESCE(g.purchases_this_fy, 0) AS purchases_this_fy,
  COALESCE(v.visits_this_fy, 0) AS visits_this_fy, v.last_visit_date,
  COALESCE(c.calls_this_fy, 0) AS calls_this_fy, c.last_call_date,
  now() AS computed_at
FROM acct a
LEFT JOIN sagg g   ON g.acct_id = a.id
LEFT JOIN lastact la ON la.acct_id = a.id
LEFT JOIN vagg v   ON v.acct_id = a.id
LEFT JOIN cagg c   ON c.acct_id = a.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_opp_mv_account ON crm_opportunity_features_mv (account_id);
CREATE INDEX IF NOT EXISTS idx_crm_opp_mv_org   ON crm_opportunity_features_mv (org_id);
CREATE INDEX IF NOT EXISTS idx_crm_opp_mv_owner ON crm_opportunity_features_mv (org_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_opp_mv_hub   ON crm_opportunity_features_mv (org_id, hub);

REVOKE ALL ON crm_opportunity_features_mv FROM anon, authenticated;


-- How far back each report actually goes. The UI dates its own claims from
-- this instead of saying "never".
CREATE OR REPLACE FUNCTION crm_report_windows()
RETURNS TABLE(activations_from date, visits_from date, calls_from date)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    (SELECT min(crm_report_event_date(rr.data->>'activation date'))
       FROM crm_report_rows rr
       JOIN crm_report_imports i ON i.id = rr.import_id
      WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.report_type ILIKE 'Sales'),
    (SELECT min(crm_report_event_date(rr.data->>'Visited Date'))
       FROM crm_report_rows rr
       JOIN crm_report_imports i ON i.id = rr.import_id
      WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.name ILIKE '%visit%'),
    (SELECT min(crm_report_event_date(rr.data->>'Called Date'))
       FROM crm_report_rows rr
       JOIN crm_report_imports i ON i.id = rr.import_id
      WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.name ILIKE '%telecall%');
$function$;

REVOKE ALL ON FUNCTION crm_report_windows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_report_windows() TO authenticated, service_role;