-- ============================================================
-- OPPORTUNITY ENGINE + PJP (permanent journey plan)
-- ============================================================
-- Turns the raw report dumps into (a) five named, scored reasons to go see a
-- partner, and (b) a day-level monthly journey plan a BDE fills in ahead of
-- the month, colour-coded by how much opportunity sits in each territory.
--
-- SHAPE: materialised cache + live scoping.
-- This was first built as pure live functions on the theory that the existing
-- crm_partner_activity() already scans the same rows cheaply. Measurement
-- killed that: one call cost 5.7s, almost all of it TOAST-decompressing
-- crm_report_rows.data for ~88k rows, with the aggregate spilling a 25MB
-- external sort to disk because it carried the whole JSONB through the sort.
-- So the expensive org-wide computation is materialised
-- (crm_opportunity_features_mv, refreshed nightly) and only the cheap
-- per-user scoping stays live. Same numbers, 223ms instead of 5.7s.
--
-- There is no pg_cron on this project, so the refresh is driven by the
-- existing nightly Vercel cron (/api/event-processor) and by an admin-only
-- "Recompute" action in the UI.
--
-- SCOPING. The MV holds no auth.uid() logic — it is one row per partner
-- across all orgs, and cannot carry RLS. Access to it is revoked from the API
-- roles; every caller goes through SECURITY DEFINER functions that re-apply
-- the same level-based visibility as crm_partner_activity(): admins see the
-- org, a manager sees their reporting line, a rep sees their own partners.
-- Kerala is excluded once, in the MV, rather than per view.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Date parsing for report rows
-- ------------------------------------------------------------
-- The three imports each date their rows differently, all as free text:
--   Activation Report   '2026-07-10'          ISO
--   TL/BDE Visits       'Apr 1 2026 1:03PM'   month-first, has a year
--   Telecalling Report  '01 Apr 01:16PM'      day-first, NO YEAR
-- The telecalling format is the awkward one: with no year, the only sound
-- reading is the most recent occurrence of that day/month that is not in the
-- future, which is correct for a rolling operational report. Verified against
-- all 49,470 dated rows: zero parse failures, range 2026-04-01..2026-08-28.
--
-- Written as a plain SQL expression so the planner can INLINE it. As plpgsql
-- with exception blocks this was called ~88k times per refresh and cost 6.1s
-- on its own. Deliberately carries no SET search_path: a SET clause blocks
-- inlining, and this function reads no tables and is not SECURITY DEFINER, so
-- it gains no privilege a search_path could be used to abuse. Regex guards
-- replace the exception handling (which is what forced plpgsql).
CREATE OR REPLACE FUNCTION crm_report_event_date(txt text)
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN left(txt, 10) ~ '^\d{4}-\d{2}-\d{2}$'
      THEN left(txt, 10)::date
    WHEN txt ~ '^[A-Za-z]{3,9} +\d{1,2} +\d{4}'
      THEN to_date(regexp_replace(txt, '^([A-Za-z]{3,9} +\d{1,2} +\d{4}).*$', '\1'),
                   'Mon FMDD YYYY')
    WHEN txt ~ '^\d{1,2} +[A-Za-z]{3,9}'
      THEN CASE
        WHEN to_date(regexp_replace(txt, '^(\d{1,2} +[A-Za-z]{3,9}).*$', '\1') || ' ' ||
                     EXTRACT(year FROM current_date)::int::text, 'FMDD Mon YYYY') > current_date
        THEN (to_date(regexp_replace(txt, '^(\d{1,2} +[A-Za-z]{3,9}).*$', '\1') || ' ' ||
                     EXTRACT(year FROM current_date)::int::text, 'FMDD Mon YYYY')
              - interval '1 year')::date
        ELSE to_date(regexp_replace(txt, '^(\d{1,2} +[A-Za-z]{3,9}).*$', '\1') || ' ' ||
                     EXTRACT(year FROM current_date)::int::text, 'FMDD Mon YYYY')
      END
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION crm_report_event_date(text) IS
  'Parse the three date formats used across CRM report imports. Year-less dates resolve to the most recent non-future occurrence. Written as inlinable SQL - do not add a SET clause or exception handling, both force per-row function calls.';

GRANT EXECUTE ON FUNCTION crm_report_event_date(text) TO authenticated;


-- ------------------------------------------------------------
-- 2. Per-partner feature cache
-- ------------------------------------------------------------
-- Money comes from 'sum of activation value', NOT 'activation value'. The
-- latter is 0.0 on all but 5 of the 38,346 sales rows on file; scoring on it
-- would value every opportunity at zero. crm_partner_activity() already made
-- this choice - this keeps the two consistent.
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
-- MATERIALIZED on each source CTE forces a narrow projection into the
-- aggregate instead of carrying the full JSONB row through a sort.
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
-- Imported visits and app-logged visits are one dataset, as elsewhere.
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
    -- "since lapse": the lapse point for a partner that stopped buying is the
    -- start of this financial year, so visits since then are the ones already
    -- spent trying to win them back.
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
  -- Activations won per visit made this year: the honest read on whether
  -- visiting this partner converts into business.
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
-- it directly. Every caller goes through the SECURITY DEFINER functions.
REVOKE ALL ON crm_opportunity_features_mv FROM anon, authenticated;


-- ------------------------------------------------------------
-- 3. Refresh + readers
-- ------------------------------------------------------------
-- Two legitimate callers: an org admin pressing "Recompute" in the app, and
-- the nightly Vercel cron using the service key. The cron has no auth.uid(),
-- so crm_user_is_org_admin() is false for it - admit it on its JWT role claim
-- instead, otherwise the scheduled refresh can never run.
CREATE OR REPLACE FUNCTION crm_refresh_opportunity_features()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  jwt_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::json->>'role', '');
BEGIN
  IF NOT (crm_user_is_org_admin() OR jwt_role = 'service_role') THEN
    RAISE EXCEPTION 'Only an org admin may refresh the opportunity engine';
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY crm_opportunity_features_mv;
  RETURN now();
END $function$;

COMMENT ON FUNCTION crm_refresh_opportunity_features() IS
  'Recompute the opportunity feature cache. Org admins and the service-role cron only; run nightly and after any report import.';

-- When the engine last recomputed - surfaced in the UI so a stale score is
-- visible rather than silently trusted.
CREATE OR REPLACE FUNCTION crm_opportunity_computed_at()
RETURNS timestamptz
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT max(computed_at) FROM crm_opportunity_features_mv;
$function$;

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


-- ------------------------------------------------------------
-- 4. THE RUPEE HOOK
-- ------------------------------------------------------------
-- The Customer Base report gives a head count and no money. Growth scoring
-- therefore has to convert "serves N customers" into "should be worth about
-- X". This function is the ONLY place that conversion happens - when a real
-- rupee column lands, change this body (or read the new column here) and all
-- five signal definitions keep working untouched.
--
-- The rate is a self-calibrating peer benchmark rather than a hardcoded
-- figure: the 75th percentile of what partners actually bill per end customer
-- this year, i.e. proven strong-partner performance. On current data that is
-- about Rs 856. An earlier attempt used the median TSS ticket (Rs 4,500),
-- which assumed RT could capture 100% of every customer a partner serves and
-- made growth outscore every evidenced signal by 12x.
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


-- ------------------------------------------------------------
-- 5. The five opportunity signals
-- ------------------------------------------------------------
-- One row per (partner, live signal) - a partner with both a lapsed TSS and
-- an untapped customer base legitimately appears twice, because those are two
-- different conversations with two different owners.
--
-- opportunity_value is the rupees genuinely at stake. score is that value
-- weighted by how winnable the signal is, and is what ranking and the PJP
-- heat map use. Keeping them separate stops a pile of low-probability
-- check-ins from outranking a real renewal.
--
--   reactivation       1.00  tapering to 0.50 as visits are spent
--   renewal_risk       1.00  x1.85 when no telecaller has called this cycle
--   growth             0.60  estimated from head count, so discounted
--   different_approach 0.15  visits are not the blocker; pricing/approach is
--   coverage_checkin   0.05  safety net, never meant to outrank real work
--
-- The 1.85x renewal multiplier comes from RT's own Aug 2026 report (contacted
-- partners renew at 65% vs 35%). It is a stated business input, not something
-- derived here; RENEWAL_UNCONTACTED_MULTIPLIER below is where to retune it
-- once there is enough live crm_calls history to measure it directly.
CREATE OR REPLACE FUNCTION crm_opportunity_signals()
RETURNS TABLE(
  account_id uuid, name text, external_id text, hub text, district_new text,
  region text, owner_id uuid, telecaller text,
  opportunity_type text, priority integer, reason text, route_to text,
  opportunity_value numeric, weight numeric, score numeric,
  customer_count integer, tss_lfy_value numeric, tp_lfy_value numeric,
  rev_lfy numeric, rev_cfy numeric,
  visits_since_lapse integer, visits_last_90d integer,
  last_visit_date date, days_since_visit integer,
  last_call_date date, telecaller_contacted_this_cycle boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  RENEWAL_UNCONTACTED_MULTIPLIER constant numeric := 1.85;
  GROWTH_MIN_CUSTOMERS           constant numeric := 10;
  GROWTH_CAPTURE_CEILING         constant numeric := 0.5;   -- fires below half of potential
  COVERAGE_STALE_DAYS            constant integer := 120;
  per_head numeric := crm_customer_value_per_head();
BEGIN
  RETURN QUERY
  WITH f AS (SELECT * FROM crm_opportunity_features()),
  scored AS (
    SELECT f.*,
      (COALESCE(f.customer_count, 0) * per_head) AS potential,
      -- lapsed = bought Tally Prime last year, nothing this year
      (f.tp_lfy_value > 0 AND f.tp_cfy_count = 0) AS tp_lapsed,
      (f.tss_lfy_value > 0 AND f.tss_cfy_count = 0) AS tss_lapsed
    FROM f
  ),
  sig AS (
    -- 1. Reactivation - bought TP last year, nothing this year, and nobody
    --    has been out to see them. The cheapest win on the board, so it
    --    carries full value. Partners with 1-2 visits already spent stay in
    --    the same bucket on a taper rather than vanishing between this signal
    --    and "different approach", which only starts at 3.
    SELECT s.*, 'reactivation'::text AS otype, 1 AS prio,
      CASE WHEN s.visits_since_lapse = 0
           THEN 'Bought TP last year, nothing this year, never visited'
           ELSE 'Bought TP last year, nothing this year, ' || s.visits_since_lapse || ' visit(s) so far' END AS rsn,
      'BDE'::text AS route,
      s.tp_lfy_value AS oval,
      CASE s.visits_since_lapse WHEN 0 THEN 1.00 WHEN 1 THEN 0.70 ELSE 0.50 END AS wt
    FROM scored s
    WHERE s.tp_lapsed AND s.visits_since_lapse <= 2

    UNION ALL
    -- 2. Renewal risk - had TSS last year, none yet this year.
    SELECT s.*, 'renewal_risk', 2,
      CASE WHEN s.telecaller_contacted_this_cycle
           THEN 'TSS lapsed this year - called, not yet renewed'
           ELSE 'TSS lapsed this year - no telecaller contact this cycle' END,
      'Telecaller',
      s.tss_lfy_value,
      CASE WHEN s.telecaller_contacted_this_cycle
           THEN 1.00 ELSE RENEWAL_UNCONTACTED_MULTIPLIER END
    FROM scored s
    WHERE s.tss_lapsed

    UNION ALL
    -- 3. Different approach - the visits have been made and made again, and
    --    still no sale. Coverage is not the problem, so sending the same BDE
    --    back a fourth time is not the answer. Goes to the TL.
    SELECT s.*, 'different_approach', 4,
      s.visits_since_lapse || ' visits this year with no conversion - pricing/approach, not coverage',
      'TL',
      s.tp_lfy_value,
      0.15
    FROM scored s
    WHERE s.tp_lapsed AND s.visits_since_lapse >= 3

    UNION ALL
    -- 4. Growth - they serve a real customer base but buy little from RT.
    --    Untapped business rather than retention, so the value is the
    --    headroom, discounted because it is estimated from a head count.
    SELECT s.*, 'growth', 3,
      'Serves ' || s.customer_count || ' customers but bills only ' ||
        to_char(round(s.rev_cfy), 'FM999,999,999') || ' this year',
      'BDE',
      round(s.potential - s.rev_cfy),
      0.60
    FROM scored s
    WHERE COALESCE(s.customer_count, 0) >= GROWTH_MIN_CUSTOMERS
      AND s.potential > 0
      AND s.rev_cfy < s.potential * GROWTH_CAPTURE_CEILING

    UNION ALL
    -- 5. Coverage check-in - nothing else fired, but there is real business
    --    behind them and nobody has been near them in four months.
    --    Deliberately last and deliberately cheap: it exists so no live
    --    partner goes fully unattended, not to compete with the four above.
    SELECT s.*, 'coverage_checkin', 5,
      CASE WHEN s.last_visit_date IS NULL
           THEN 'Serves ' || s.customer_count || ' customers - no visit on record'
           ELSE 'Serves ' || s.customer_count || ' customers - not visited in ' ||
                (current_date - s.last_visit_date) || ' days' END,
      'BDE',
      round(s.potential),
      0.05
    FROM scored s
    WHERE COALESCE(s.customer_count, 0) > 0
      AND (s.last_visit_date IS NULL
           OR s.last_visit_date < current_date - COVERAGE_STALE_DAYS)
      -- only when no other signal fired for this partner
      AND NOT (s.tp_lapsed AND s.visits_since_lapse <= 2)
      AND NOT s.tss_lapsed
      AND NOT (s.tp_lapsed AND s.visits_since_lapse >= 3)
      AND NOT (COALESCE(s.customer_count, 0) >= GROWTH_MIN_CUSTOMERS
               AND s.potential > 0
               AND s.rev_cfy < s.potential * GROWTH_CAPTURE_CEILING)
  )
  SELECT
    sig.account_id, sig.name, sig.external_id, sig.hub, sig.district_new,
    sig.region, sig.owner_id, sig.telecaller,
    sig.otype, sig.prio, sig.rsn, sig.route,
    GREATEST(sig.oval, 0), sig.wt, round(GREATEST(sig.oval, 0) * sig.wt),
    sig.customer_count, sig.tss_lfy_value, sig.tp_lfy_value,
    sig.rev_lfy, sig.rev_cfy,
    sig.visits_since_lapse, sig.visits_last_90d,
    sig.last_visit_date, sig.days_since_visit,
    sig.last_call_date, sig.telecaller_contacted_this_cycle
  FROM sig
  WHERE sig.oval > 0
  ORDER BY round(GREATEST(sig.oval, 0) * sig.wt) DESC, sig.prio;
END $function$;

COMMENT ON FUNCTION crm_opportunity_signals() IS
  'One row per live opportunity signal per partner. score = value x winnability weight; rank and heat-map on score, report value.';


-- ============================================================
-- PJP - day-level monthly journey planning
-- ============================================================
-- A BDE plans a specific territory for a specific calendar date, ahead of the
-- month. Deliberately not a repeating weekly pattern: the month calendar is
-- the plan, one row per planned day.
CREATE TABLE IF NOT EXISTS crm_pjp_day_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bde_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_date date NOT NULL,
  territory text NOT NULL,              -- matches crm_accounts.hub
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, bde_id, plan_date)    -- one territory per person per day
);

CREATE INDEX IF NOT EXISTS idx_crm_pjp_bde_date   ON crm_pjp_day_plans (bde_id, plan_date);
CREATE INDEX IF NOT EXISTS idx_crm_pjp_org_date   ON crm_pjp_day_plans (org_id, plan_date);
CREATE INDEX IF NOT EXISTS idx_crm_pjp_territory  ON crm_pjp_day_plans (org_id, territory, plan_date);

ALTER TABLE crm_pjp_day_plans ENABLE ROW LEVEL SECURITY;

-- Visibility mirrors crm_visits, keyed on whose plan it is.
DROP POLICY IF EXISTS crm_pjp_select ON crm_pjp_day_plans;
CREATE POLICY crm_pjp_select ON crm_pjp_day_plans FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin()
              OR bde_id = auth.uid()
              OR bde_id IN (SELECT crm_report_ids())));

-- No approval workflow by default: a BDE sets their own plan, and a TL can
-- adjust their reporting line's (crm_report_ids() includes the caller). If RT
-- later wants sign-off before a plan goes live, add a status column here
-- rather than restricting these policies.
DROP POLICY IF EXISTS crm_pjp_insert ON crm_pjp_day_plans;
CREATE POLICY crm_pjp_insert ON crm_pjp_day_plans FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids())
              AND (crm_user_is_org_admin() OR bde_id IN (SELECT crm_report_ids())));

DROP POLICY IF EXISTS crm_pjp_update ON crm_pjp_day_plans;
CREATE POLICY crm_pjp_update ON crm_pjp_day_plans FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin() OR bde_id IN (SELECT crm_report_ids())));

DROP POLICY IF EXISTS crm_pjp_delete ON crm_pjp_day_plans;
CREATE POLICY crm_pjp_delete ON crm_pjp_day_plans FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin() OR bde_id IN (SELECT crm_report_ids())));


-- Territory heat - what a planned day is actually worth. Sums score, not raw
-- value: a hub full of 0.05-weighted check-ins should not shade the same as
-- one holding live renewals.
CREATE OR REPLACE FUNCTION crm_territory_potential()
RETURNS TABLE(
  territory text, partners integer, signals integer,
  open_value numeric, heat_score numeric,
  reactivation integer, renewal_risk integer, growth integer,
  different_approach integer, coverage_checkin integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(s.hub, '(no hub)') AS territory,
    count(DISTINCT s.account_id)::int,
    count(*)::int,
    COALESCE(sum(s.opportunity_value), 0),
    COALESCE(sum(s.score), 0),
    count(*) FILTER (WHERE s.opportunity_type = 'reactivation')::int,
    count(*) FILTER (WHERE s.opportunity_type = 'renewal_risk')::int,
    count(*) FILTER (WHERE s.opportunity_type = 'growth')::int,
    count(*) FILTER (WHERE s.opportunity_type = 'different_approach')::int,
    count(*) FILTER (WHERE s.opportunity_type = 'coverage_checkin')::int
  FROM crm_opportunity_signals() s
  GROUP BY COALESCE(s.hub, '(no hub)')
  ORDER BY 5 DESC;
$function$;

COMMENT ON FUNCTION crm_territory_potential() IS
  'Open opportunity per hub for PJP colour-coding. heat_score sums weighted score; open_value sums rupees at stake.';


-- Day drill-down - clicking a planned day lists that hub's partners ranked by
-- opportunity, each with its reason and last-visit history, so the day can be
-- worked without navigating away.
CREATE OR REPLACE FUNCTION crm_pjp_day_accounts(p_territory text)
RETURNS TABLE(
  account_id uuid, name text, external_id text, district_new text,
  opportunity_type text, reason text, route_to text,
  opportunity_value numeric, score numeric,
  customer_count integer, rev_lfy numeric, rev_cfy numeric,
  last_visit_date date, days_since_visit integer,
  last_call_date date, visits_since_lapse integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.account_id, s.name, s.external_id, s.district_new,
         s.opportunity_type, s.reason, s.route_to,
         s.opportunity_value, s.score,
         s.customer_count, s.rev_lfy, s.rev_cfy,
         s.last_visit_date, s.days_since_visit,
         s.last_call_date, s.visits_since_lapse
  FROM crm_opportunity_signals() s
  WHERE COALESCE(s.hub, '(no hub)') = p_territory
  ORDER BY s.score DESC;
$function$;


-- ------------------------------------------------------------
-- Adherence - did the visit happen where the plan said it would
-- ------------------------------------------------------------
-- Per-visit tagging, derived rather than stored: nothing is copied onto the
-- visit row, so editing a plan re-tags its visits automatically. A visit is
--   on plan  = a plan existed for that person that day AND the partner
--              visited sits in the planned hub
--   off plan = anything else (including a visit on an unplanned day)
-- Deliberately an RPC and not a view: a view would run with the owner's
-- rights and quietly bypass the RLS on crm_report_rows and crm_pjp_day_plans,
-- where these functions re-apply the same scoping.
CREATE OR REPLACE FUNCTION crm_pjp_visit_adherence(p_from date, p_to date)
RETURNS TABLE(
  person_id uuid, person_name text, visit_date date,
  account_id uuid, account_name text, hub text,
  planned_territory text, day_planned boolean, on_territory boolean,
  on_plan boolean, score numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH v AS (
    SELECT rr.person_user_id AS person_id, rr.person_name,
           crm_report_event_date(rr.data->>'Visited Date') AS vdate,
           rr.account_id
    FROM crm_report_rows rr
    JOIN crm_report_imports i ON i.id = rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids())
      AND i.name ILIKE '%visit%'
      AND rr.account_id IS NOT NULL
    UNION ALL
    SELECT vi.visited_by, vi.visited_by_name, vi.visited_at::date, vi.account_id
    FROM crm_visits vi
    WHERE vi.org_id IN (SELECT auth_user_org_ids()) AND vi.account_id IS NOT NULL
  ),
  scoped AS (
    SELECT v.*, a.name AS account_name, a.hub
    FROM v
    JOIN crm_accounts a ON a.id = v.account_id
    WHERE v.vdate BETWEEN p_from AND p_to
      AND v.person_id IS NOT NULL
      AND a.org_id IN (SELECT auth_user_org_ids())
      AND (crm_user_is_org_admin()
           OR v.person_id = auth.uid()
           OR v.person_id IN (SELECT crm_report_ids()))
  ),
  agg AS (
    SELECT s.account_id, sum(s.score) AS score
    FROM crm_opportunity_signals() s GROUP BY s.account_id
  )
  SELECT sc.person_id, sc.person_name, sc.vdate,
         sc.account_id, sc.account_name, sc.hub,
         p.territory,
         (p.id IS NOT NULL),
         (p.id IS NOT NULL AND p.territory IS NOT DISTINCT FROM sc.hub),
         (p.id IS NOT NULL AND p.territory IS NOT DISTINCT FROM sc.hub),
         COALESCE(g.score, 0)
  FROM scoped sc
  LEFT JOIN crm_pjp_day_plans p
         ON p.bde_id = sc.person_id AND p.plan_date = sc.vdate
  LEFT JOIN agg g ON g.account_id = sc.account_id;
$function$;


-- Weekly rollup - the number performance review runs on. Not raw visit count:
-- a week of twelve unplanned drop-ins is not a week of work well planned.
CREATE OR REPLACE FUNCTION crm_pjp_adherence(p_from date, p_to date)
RETURNS TABLE(
  person_id uuid, person_name text, week_start date,
  planned_days integer, visits_total integer,
  visits_on_plan integer, visits_off_plan integer,
  adherence_rate numeric,
  value_on_plan numeric, value_off_plan numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH va AS (
    SELECT * FROM crm_pjp_visit_adherence(p_from, p_to)
  ),
  vw AS (
    SELECT va.person_id, va.person_name,
           date_trunc('week', va.visit_date)::date AS week_start,
           count(*)::int AS visits_total,
           count(*) FILTER (WHERE va.on_plan)::int AS visits_on_plan,
           count(*) FILTER (WHERE NOT va.on_plan)::int AS visits_off_plan,
           COALESCE(sum(va.score) FILTER (WHERE va.on_plan), 0) AS value_on_plan,
           COALESCE(sum(va.score) FILTER (WHERE NOT va.on_plan), 0) AS value_off_plan
    FROM va GROUP BY va.person_id, va.person_name, date_trunc('week', va.visit_date)
  ),
  pw AS (
    SELECT p.bde_id AS person_id,
           date_trunc('week', p.plan_date)::date AS week_start,
           count(*)::int AS planned_days
    FROM crm_pjp_day_plans p
    WHERE p.plan_date BETWEEN p_from AND p_to
    GROUP BY p.bde_id, date_trunc('week', p.plan_date)
  )
  SELECT COALESCE(vw.person_id, pw.person_id),
         vw.person_name,
         COALESCE(vw.week_start, pw.week_start),
         COALESCE(pw.planned_days, 0),
         COALESCE(vw.visits_total, 0),
         COALESCE(vw.visits_on_plan, 0),
         COALESCE(vw.visits_off_plan, 0),
         CASE WHEN COALESCE(vw.visits_total, 0) > 0
              THEN round(100.0 * vw.visits_on_plan / vw.visits_total, 1) END,
         COALESCE(vw.value_on_plan, 0),
         COALESCE(vw.value_off_plan, 0)
  FROM vw
  FULL OUTER JOIN pw
    ON pw.person_id = vw.person_id AND pw.week_start = vw.week_start
  ORDER BY 3 DESC, 4 DESC;
$function$;

COMMENT ON FUNCTION crm_pjp_adherence(date, date) IS
  'Weekly PJP adherence per person: planned days, on/off-plan visits and the opportunity score captured either side.';


-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
-- Functions get EXECUTE for PUBLIC by default, which hands the anon role a
-- callable /rest/v1/rpc/... endpoint. These all resolve to zero rows for an
-- unauthenticated caller (auth_user_org_ids() is empty) and the refresh
-- raises, so nothing leaks - but an unauthenticated endpoint that runs this
-- much work is a free denial-of-service lever, so take the grant away.
REVOKE ALL ON FUNCTION crm_opportunity_features()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_opportunity_signals()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_territory_potential()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_pjp_day_accounts(text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_pjp_visit_adherence(date, date)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_pjp_adherence(date, date)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_refresh_opportunity_features()    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_opportunity_computed_at()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_customer_value_per_head()         FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION crm_opportunity_features()          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_opportunity_signals()           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_territory_potential()           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_pjp_day_accounts(text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_pjp_visit_adherence(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_pjp_adherence(date, date)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_refresh_opportunity_features()  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_opportunity_computed_at()       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_customer_value_per_head()       TO authenticated, service_role;
