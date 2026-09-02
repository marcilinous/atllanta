-- ============================================================
-- WHO TO VISIT + PJP (day-level journey planning)
-- ============================================================
-- A BDE worklist built strictly from what the imported reports contain, and
-- a month calendar to plan against it.
--
-- WHAT THE DATA ACTUALLY HAS. Per purchase: an activation date, a type and a
-- value. There is NO expiry, renewal or due date anywhere. So nothing here
-- claims one. A partner is flagged "no TSS for 12+ months" because 365 days
-- have passed since a real activation date - not because a subscription is
-- known to have run out. An earlier draft inferred an expiry by treating the
-- financial-year boundary as a renewal boundary ("TSS lapsed this year"),
-- which flagged 865 partners when only 269 are genuinely 12+ months past
-- their last TSS: a partner who bought in March 2026 is not due until March
-- 2027. That inference is gone.
--
-- Likewise there is no estimated money. An earlier draft turned the Customer
-- Base head count into rupees via a benchmark and ranked on it; that number
-- was never measured by anyone, so it is gone too. Every rupee figure below
-- is a sum of 'sum of activation value' - what RT actually billed.
--
-- WINDOWS. Activations run from 2025-04-01; visits and calls only from
-- 2026-04-01. "No visit this year" therefore does not mean "never visited",
-- and crm_report_windows() exposes the bounds so the UI can date its claims.
--
-- SHAPE. The org-wide computation is materialised (refreshed nightly by the
-- existing Vercel cron; this project has no pg_cron) and only the per-user
-- scoping stays live. Computing it live cost 5.7s a call, almost all of it
-- TOAST-decompressing crm_report_rows.data.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Date parsing for report rows
-- ------------------------------------------------------------
-- The imports each date their rows differently, all as free text:
--   Activation Report   '2026-07-10'          ISO
--   TL/BDE Visits       'Apr 1 2026 1:03PM'   month-first, has a year
--   Telecalling Report  '01 Apr 01:16PM'      day-first, NO YEAR
-- The telecalling format is the awkward one: with no year, the only sound
-- reading is the most recent occurrence of that day/month that is not in the
-- future, which is right for a rolling operational report. Verified against
-- all 49,470 dated rows: zero parse failures.
--
-- Written as a plain SQL expression so the planner can INLINE it. As plpgsql
-- with exception blocks this was called ~88k times per refresh and cost 6.1s
-- on its own. Deliberately carries no SET search_path: a SET clause blocks
-- inlining, and this function reads no tables and is not SECURITY DEFINER, so
-- it gains no privilege a search_path could be used to abuse.
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
  'Parse the date formats used across CRM report imports. Year-less dates resolve to the most recent non-future occurrence. Written as inlinable SQL - do not add a SET clause or exception handling, both force per-row function calls.';

GRANT EXECUTE ON FUNCTION crm_report_event_date(text) TO authenticated;


-- ------------------------------------------------------------
-- 2. Per-partner fact cache
-- ------------------------------------------------------------
-- Dates, counts and billed rupees. Nothing derived beyond summing and taking
-- a maximum date.
--
-- Money comes from 'sum of activation value', NOT 'activation value'. The
-- latter is 0.0 on all but 5 of the 38,346 sales rows on file.
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
  -- Kerala is out of scope for this feature, once, here.
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
    -- The most recent purchase of each kind. This is the only renewal-shaped
    -- fact the data supports: a date something was bought, never a due date.
    max(s.adate) FILTER (WHERE s.atype = 'TSS') AS last_tss_date,
    max(s.adate) FILTER (WHERE s.atype = 'New') AS last_tp_date,
    max(s.adate)                                AS last_activation_date,
    COALESCE(sum(s.rev) FILTER (WHERE s.adate >= b.cfy_start), 0)                    AS value_this_fy,
    COALESCE(sum(s.rev) FILTER (WHERE s.adate BETWEEN b.lfy_start AND b.lfy_end), 0) AS value_last_fy,
    COALESCE(sum(s.rev) FILTER (WHERE s.adate >= current_date - 365), 0)             AS value_12m,
    COALESCE(sum(s.rev) FILTER (WHERE s.atype = 'TSS'), 0)                           AS tss_value_all,
    COALESCE(sum(s.rev) FILTER (WHERE s.atype = 'New'), 0)                           AS tp_value_all,
    count(*) FILTER (WHERE s.adate >= b.cfy_start)::int                              AS purchases_this_fy
  FROM sales s CROSS JOIN b GROUP BY s.acct_id
),
lastact AS (
  SELECT DISTINCT ON (s.acct_id) s.acct_id, s.atype AS last_activation_type, s.rev AS last_activation_value
  FROM sales s WHERE s.adate IS NOT NULL ORDER BY s.acct_id, s.adate DESC, s.rev DESC
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
  COALESCE(g.value_12m, 0)     AS value_12m,
  COALESCE(g.tss_value_all, 0) AS tss_value_all,
  COALESCE(g.tp_value_all, 0)  AS tp_value_all,
  COALESCE(g.purchases_this_fy, 0) AS purchases_this_fy,
  COALESCE(v.visits_this_fy, 0) AS visits_this_fy, v.last_visit_date,
  COALESCE(c.calls_this_fy, 0)  AS calls_this_fy,  c.last_call_date,
  now() AS computed_at
FROM acct a
LEFT JOIN sagg g     ON g.acct_id  = a.id
LEFT JOIN lastact la ON la.acct_id = a.id
LEFT JOIN vagg v     ON v.acct_id  = a.id
LEFT JOIN cagg c     ON c.acct_id  = a.id;

-- Unique index enables REFRESH ... CONCURRENTLY (no read blocking).
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_opp_mv_account ON crm_opportunity_features_mv (account_id);
CREATE INDEX IF NOT EXISTS idx_crm_opp_mv_org   ON crm_opportunity_features_mv (org_id);
CREATE INDEX IF NOT EXISTS idx_crm_opp_mv_owner ON crm_opportunity_features_mv (org_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_opp_mv_hub   ON crm_opportunity_features_mv (org_id, hub);

-- A materialised view cannot carry RLS, so the API roles must not read it
-- directly. Every caller goes through the SECURITY DEFINER functions below,
-- which re-apply the same level-based scoping as crm_partner_activity().
REVOKE ALL ON crm_opportunity_features_mv FROM anon, authenticated;


-- How far back each report actually goes, so the UI can date its own claims
-- instead of saying "never".
CREATE OR REPLACE FUNCTION crm_report_windows()
RETURNS TABLE(activations_from date, visits_from date, calls_from date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    (SELECT min(crm_report_event_date(rr.data->>'activation date'))
       FROM crm_report_rows rr JOIN crm_report_imports i ON i.id = rr.import_id
      WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.report_type ILIKE 'Sales'),
    (SELECT min(crm_report_event_date(rr.data->>'Visited Date'))
       FROM crm_report_rows rr JOIN crm_report_imports i ON i.id = rr.import_id
      WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.name ILIKE '%visit%'),
    (SELECT min(crm_report_event_date(rr.data->>'Called Date'))
       FROM crm_report_rows rr JOIN crm_report_imports i ON i.id = rr.import_id
      WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.name ILIKE '%telecall%');
$function$;


-- ------------------------------------------------------------
-- 3. Refresh + readers
-- ------------------------------------------------------------
-- Two legitimate callers: an org admin pressing "Refresh now", and the
-- nightly Vercel cron using the service key. The cron has no auth.uid(), so
-- crm_user_is_org_admin() is false for it - admit it on its JWT role claim,
-- otherwise the scheduled refresh can never run.
CREATE OR REPLACE FUNCTION crm_refresh_opportunity_features()
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION crm_opportunity_computed_at()
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT max(computed_at) FROM crm_opportunity_features_mv; $function$;

-- Scoped reader. Day counts derive here so they stay exact between refreshes.
CREATE OR REPLACE FUNCTION crm_opportunity_features()
RETURNS TABLE(
  account_id uuid, name text, external_id text, hub text, district_new text,
  region text, owner_id uuid, telecaller text,
  customer_count integer, customer_base_active_3y boolean,
  last_tss_date date, days_since_tss integer,
  last_tp_date date, days_since_tp integer,
  last_activation_date date, last_activation_type text, last_activation_value numeric,
  days_since_purchase integer,
  value_this_fy numeric, value_last_fy numeric, value_12m numeric,
  tss_value_all numeric, tp_value_all numeric, purchases_this_fy integer,
  visits_this_fy integer, last_visit_date date, days_since_visit integer,
  calls_this_fy integer, last_call_date date, days_since_call integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT m.account_id, m.name, m.external_id, m.hub, m.district_new,
         m.region, m.owner_id, m.telecaller,
         m.customer_count, m.customer_base_active_3y,
         m.last_tss_date, (current_date - m.last_tss_date)::int,
         m.last_tp_date,  (current_date - m.last_tp_date)::int,
         m.last_activation_date, m.last_activation_type, m.last_activation_value,
         (current_date - m.last_activation_date)::int,
         m.value_this_fy, m.value_last_fy, m.value_12m,
         m.tss_value_all, m.tp_value_all, m.purchases_this_fy,
         m.visits_this_fy, m.last_visit_date, (current_date - m.last_visit_date)::int,
         m.calls_this_fy, m.last_call_date, (current_date - m.last_call_date)::int
  FROM crm_opportunity_features_mv m
  WHERE m.org_id IN (SELECT auth_user_org_ids())
    AND (crm_user_is_org_admin()
         OR m.owner_id = auth.uid()
         OR m.owner_id IN (SELECT crm_report_ids()));
$function$;

COMMENT ON FUNCTION crm_opportunity_features() IS
  'Per-partner observed facts, scoped to the caller. Dates, counts and billed rupees only - no inferred expiry, no estimated potential.';


-- ------------------------------------------------------------
-- 4. The worklist: one row per partner, with why it qualified
-- ------------------------------------------------------------
-- A BDE reads a partner, not four separate signal rows, so the partner is the
-- unit and the reasons are an array on it.
--
-- Reason keys, each a statement of something on file:
--   tss_overdue     365+ days since the last TSS purchase. Counted from a
--                   real activation date; assumes no term length and no
--                   renewal date, because the data has neither.
--   stopped_buying  billed last FY, nothing at all this FY.
--   base_no_buy     10+ customers on the Customer Base report AND nothing
--                   billed this FY. Both halves are on file. (An earlier
--                   "low share" version fired on the head count alone, which
--                   put partners billing 25-30 lakh who bought TSS two days
--                   ago at the top of the list.)
--   not_visited     billed in the last 12 months, no visit logged this FY.
--
-- Ordering is by value_12m - rupees actually billed. There is no weighted
-- score: every number a BDE sees is one RT really invoiced.
CREATE OR REPLACE FUNCTION crm_partner_actions()
RETURNS TABLE(
  account_id uuid, name text, external_id text, hub text, district_new text,
  region text, owner_id uuid, telecaller text, tier text,
  reasons text[],
  customer_count integer,
  last_activation_date date, last_activation_type text, days_since_purchase integer,
  last_tss_date date, days_since_tss integer,
  value_this_fy numeric, value_last_fy numeric, value_12m numeric,
  visits_this_fy integer, last_visit_date date, days_since_visit integer,
  last_call_date date, days_since_call integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH f AS (
    SELECT f.*, ca.tier
    FROM crm_opportunity_features() f
    JOIN crm_accounts ca ON ca.id = f.account_id
    -- NA tier means inactive: not visited. Verified on live data that
    -- tier='NA' and partner_status='Inactive' are the same 451 partners,
    -- an exact 1:1 with no overlap into AP or Star AP.
    WHERE COALESCE(ca.tier, '') <> 'NA'
  ),
  r AS (
    SELECT f.account_id AS aid, 'tss_overdue' AS k FROM f
     WHERE f.last_tss_date IS NOT NULL AND f.days_since_tss > 365
    UNION ALL
    SELECT f.account_id, 'stopped_buying' FROM f
     WHERE f.value_last_fy > 0 AND f.purchases_this_fy = 0
    UNION ALL
    SELECT f.account_id, 'base_no_buy' FROM f
     WHERE COALESCE(f.customer_count, 0) >= 10 AND f.value_this_fy = 0
    UNION ALL
    SELECT f.account_id, 'not_visited' FROM f
     WHERE f.visits_this_fy = 0 AND f.value_12m > 0
  ),
  agg AS (SELECT r.aid, array_agg(r.k ORDER BY r.k) AS ks FROM r GROUP BY r.aid)
  SELECT f.account_id, f.name, f.external_id, f.hub, f.district_new,
         f.region, f.owner_id, f.telecaller, f.tier,
         agg.ks,
         f.customer_count,
         f.last_activation_date, f.last_activation_type, f.days_since_purchase,
         f.last_tss_date, f.days_since_tss,
         f.value_this_fy, f.value_last_fy, f.value_12m,
         f.visits_this_fy, f.last_visit_date, f.days_since_visit,
         f.last_call_date, f.days_since_call
  FROM f JOIN agg ON agg.aid = f.account_id
  ORDER BY f.value_12m DESC, f.customer_count DESC NULLS LAST;
$function$;

COMMENT ON FUNCTION crm_partner_actions() IS
  'One row per partner worth visiting, with the reason keys it matched. Inactive (tier NA) partners are excluded. Ordered by rupees actually billed.';


-- Inactive on paper, still buying. Excluding NA from the visit list is right
-- for 446 of the 451, but 5 billed during this financial year (4 of them in
-- the last 90 days, Rs 323,738 in total) - their status flag is stale, not
-- their business. Kept as its own report so the exclusion above stays clean:
-- these need a status correction, not a visit.
CREATE OR REPLACE FUNCTION crm_inactive_but_buying()
RETURNS TABLE(
  account_id uuid, name text, external_id text, hub text,
  last_activation_date date, last_activation_type text, days_since_purchase integer,
  value_this_fy numeric, value_12m numeric, last_visit_date date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT f.account_id, f.name, f.external_id, f.hub,
         f.last_activation_date, f.last_activation_type, f.days_since_purchase,
         f.value_this_fy, f.value_12m, f.last_visit_date
  FROM crm_opportunity_features() f
  JOIN crm_accounts ca ON ca.id = f.account_id
  WHERE COALESCE(ca.tier, '') = 'NA' AND f.value_this_fy > 0
  ORDER BY f.value_this_fy DESC;
$function$;

COMMENT ON FUNCTION crm_inactive_but_buying() IS
  'Partners marked inactive (tier NA) that still billed this financial year - a data-hygiene report, not a visit list.';


-- ============================================================
-- PJP - day-level monthly journey planning
-- ============================================================
-- A BDE plans a specific area for a specific calendar date, ahead of the
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
  UNIQUE (org_id, bde_id, plan_date)    -- one area per person per day
);

CREATE INDEX IF NOT EXISTS idx_crm_pjp_bde_date  ON crm_pjp_day_plans (bde_id, plan_date);
CREATE INDEX IF NOT EXISTS idx_crm_pjp_org_date  ON crm_pjp_day_plans (org_id, plan_date);
CREATE INDEX IF NOT EXISTS idx_crm_pjp_territory ON crm_pjp_day_plans (org_id, territory, plan_date);

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


-- Area totals for the calendar. Counts each partner once (a partner with
-- three reasons is still one partner) and totals real billed rupees. Both the
-- shading and the number shown are this same figure - nothing is weighted.
CREATE OR REPLACE FUNCTION crm_territory_potential()
RETURNS TABLE(
  territory text, partners integer, open_value numeric,
  tss_overdue integer, stopped_buying integer, base_no_buy integer, not_visited integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(a.hub, '(no hub)'),
         count(*)::int,
         COALESCE(sum(a.value_12m), 0),
         count(*) FILTER (WHERE 'tss_overdue'    = ANY(a.reasons))::int,
         count(*) FILTER (WHERE 'stopped_buying' = ANY(a.reasons))::int,
         count(*) FILTER (WHERE 'base_no_buy'    = ANY(a.reasons))::int,
         count(*) FILTER (WHERE 'not_visited'    = ANY(a.reasons))::int
  FROM crm_partner_actions() a
  GROUP BY COALESCE(a.hub, '(no hub)')
  ORDER BY 3 DESC;
$function$;


-- Day drill-down: clicking a planned day lists that area's partners, biggest
-- business first, with the facts a BDE needs before knocking on the door.
CREATE OR REPLACE FUNCTION crm_pjp_day_accounts(p_territory text)
RETURNS TABLE(
  account_id uuid, name text, external_id text, district_new text,
  reasons text[], customer_count integer,
  last_activation_date date, last_activation_type text,
  value_last_fy numeric, value_12m numeric,
  last_visit_date date, days_since_visit integer, last_call_date date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT a.account_id, a.name, a.external_id, a.district_new,
         a.reasons, a.customer_count,
         a.last_activation_date, a.last_activation_type,
         a.value_last_fy, a.value_12m,
         a.last_visit_date, a.days_since_visit, a.last_call_date
  FROM crm_partner_actions() a
  WHERE COALESCE(a.hub, '(no hub)') = p_territory
  ORDER BY a.value_12m DESC;
$function$;


-- ------------------------------------------------------------
-- Adherence - did the visit happen where the plan said it would
-- ------------------------------------------------------------
-- Per-visit tagging, derived rather than stored: nothing is copied onto the
-- visit row, so editing a plan re-tags its visits automatically. A visit is
--   on plan  = a plan existed for that person that day AND the partner
--              visited sits in the planned area
--   off plan = anything else (including a visit on an unplanned day)
-- Deliberately an RPC and not a view: a view would run with the owner's
-- rights and quietly bypass the RLS on crm_report_rows and crm_pjp_day_plans,
-- where these functions re-apply the same scoping.
CREATE OR REPLACE FUNCTION crm_pjp_visit_adherence(p_from date, p_to date)
RETURNS TABLE(
  person_id uuid, person_name text, visit_date date,
  account_id uuid, account_name text, hub text,
  planned_territory text, day_planned boolean, on_territory boolean,
  on_plan boolean, value_12m numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH v AS (
    SELECT rr.person_user_id AS person_id, rr.person_name,
           crm_report_event_date(rr.data->>'Visited Date') AS vdate,
           rr.account_id
    FROM crm_report_rows rr
    JOIN crm_report_imports i ON i.id = rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids())
      AND i.name ILIKE '%visit%' AND rr.account_id IS NOT NULL
    UNION ALL
    SELECT vi.visited_by, vi.visited_by_name, vi.visited_at::date, vi.account_id
    FROM crm_visits vi
    WHERE vi.org_id IN (SELECT auth_user_org_ids()) AND vi.account_id IS NOT NULL
  ),
  scoped AS (
    SELECT v.*, a.name AS account_name, a.hub
    FROM v JOIN crm_accounts a ON a.id = v.account_id
    WHERE v.vdate BETWEEN p_from AND p_to
      AND v.person_id IS NOT NULL
      AND a.org_id IN (SELECT auth_user_org_ids())
      AND (crm_user_is_org_admin()
           OR v.person_id = auth.uid()
           OR v.person_id IN (SELECT crm_report_ids()))
  ),
  val AS (SELECT f.account_id, f.value_12m FROM crm_opportunity_features() f)
  SELECT sc.person_id, sc.person_name, sc.vdate,
         sc.account_id, sc.account_name, sc.hub,
         p.territory,
         (p.id IS NOT NULL),
         (p.id IS NOT NULL AND p.territory IS NOT DISTINCT FROM sc.hub),
         (p.id IS NOT NULL AND p.territory IS NOT DISTINCT FROM sc.hub),
         COALESCE(val.value_12m, 0)
  FROM scoped sc
  LEFT JOIN crm_pjp_day_plans p
         ON p.bde_id = sc.person_id AND p.plan_date = sc.vdate
  LEFT JOIN val ON val.account_id = sc.account_id;
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH va AS (SELECT * FROM crm_pjp_visit_adherence(p_from, p_to)),
  vw AS (
    SELECT va.person_id, va.person_name,
           date_trunc('week', va.visit_date)::date AS week_start,
           count(*)::int AS visits_total,
           count(*) FILTER (WHERE va.on_plan)::int AS visits_on_plan,
           count(*) FILTER (WHERE NOT va.on_plan)::int AS visits_off_plan,
           COALESCE(sum(va.value_12m) FILTER (WHERE va.on_plan), 0) AS value_on_plan,
           COALESCE(sum(va.value_12m) FILTER (WHERE NOT va.on_plan), 0) AS value_off_plan
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
  SELECT COALESCE(vw.person_id, pw.person_id), vw.person_name,
         COALESCE(vw.week_start, pw.week_start),
         COALESCE(pw.planned_days, 0),
         COALESCE(vw.visits_total, 0),
         COALESCE(vw.visits_on_plan, 0),
         COALESCE(vw.visits_off_plan, 0),
         CASE WHEN COALESCE(vw.visits_total, 0) > 0
              THEN round(100.0 * vw.visits_on_plan / vw.visits_total, 1) END,
         COALESCE(vw.value_on_plan, 0),
         COALESCE(vw.value_off_plan, 0)
  FROM vw FULL OUTER JOIN pw
    ON pw.person_id = vw.person_id AND pw.week_start = vw.week_start
  ORDER BY 3 DESC, 4 DESC;
$function$;

COMMENT ON FUNCTION crm_pjp_adherence(date, date) IS
  'Weekly PJP adherence per person: planned days, on/off-plan visits and the billed business either side.';


-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
-- Functions get EXECUTE for PUBLIC by default, which hands the anon role a
-- callable /rest/v1/rpc/... endpoint. These all resolve to zero rows for an
-- unauthenticated caller (auth_user_org_ids() is empty) and the refresh
-- raises, so nothing leaks - but an unauthenticated endpoint that runs this
-- much work is a free denial-of-service lever, so take the grant away.
REVOKE ALL ON FUNCTION crm_opportunity_features()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_partner_actions()                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_inactive_but_buying()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_territory_potential()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_pjp_day_accounts(text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_pjp_visit_adherence(date, date)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_pjp_adherence(date, date)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_refresh_opportunity_features()    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_opportunity_computed_at()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_report_windows()                  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION crm_opportunity_features()          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_partner_actions()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_inactive_but_buying()           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_territory_potential()           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_pjp_day_accounts(text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_pjp_visit_adherence(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_pjp_adherence(date, date)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_refresh_opportunity_features()  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_opportunity_computed_at()       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_report_windows()                TO authenticated, service_role;
