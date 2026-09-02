-- ============================================================
-- PJP gap prediction + month lock
-- ============================================================
-- Two additions to the journey planner, both requested by RT after the
-- fact-only worklist shipped:
--
--   1. A month lock. The plan is a month-start commitment; once a BDE has
--      named an area for each day, the month is locked. A locked month can no
--      longer be edited (the whole point of committing), and a locked day
--      opens the gap-led "who to visit first" prediction instead of the
--      editable planner.
--
--   2. The gap prediction itself. The fact worklist ranks by rupees actually
--      billed. This ranks by the rupees a partner is NOT billing but its
--      peers of the same size in the same place are: the opportunity, not the
--      turnover. It is the "Gap-Led Visit Planning" model:
--
--        per-user       = business / user base
--        peer benchmark = median per-user among same-place peers with a real base
--        expected       = user base x peer benchmark
--        gap            = expected - actual        (rank biggest gap first)
--
--      This is the one place in the CRM that estimates rather than states, so
--      it is deliberately fenced: only partners with a real base are scored,
--      the benchmark needs enough peers to mean anything, and the peer group
--      is the finest geography that clears that bar (pincode, then city, then
--      district, then region). Everything the number rests on is returned
--      alongside it so the screen can show the working, never a bare score.

-- ------------------------------------------------------------
-- 1. Pincode on the partner
-- ------------------------------------------------------------
-- The truest peer group is the pincode - same neighbourhood, comparable
-- catchment. RT holds a partner-wise pincode list to load; until it lands the
-- benchmark falls back to billing_city and coarser. Additive and nullable so
-- nothing breaks before the data arrives.
ALTER TABLE crm_accounts ADD COLUMN IF NOT EXISTS pincode text;
CREATE INDEX IF NOT EXISTS idx_crm_accounts_pincode ON crm_accounts (org_id, pincode);

-- ------------------------------------------------------------
-- 2. Month lock
-- ------------------------------------------------------------
-- One row per person per month means "this month's plan is committed". Its
-- presence is the lock; deleting it (admin or the plan's TL) reopens the month.
CREATE TABLE IF NOT EXISTS crm_pjp_month_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bde_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_start date NOT NULL,            -- always the first of the month
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (org_id, bde_id, month_start)
);

CREATE INDEX IF NOT EXISTS idx_crm_pjp_lock_bde ON crm_pjp_month_locks (bde_id, month_start);

ALTER TABLE crm_pjp_month_locks ENABLE ROW LEVEL SECURITY;

-- Same visibility rule as the plan itself: your own, your reports', or all if
-- you administer the org.
DROP POLICY IF EXISTS crm_pjp_lock_select ON crm_pjp_month_locks;
CREATE POLICY crm_pjp_lock_select ON crm_pjp_month_locks FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin()
              OR bde_id = auth.uid()
              OR bde_id IN (SELECT crm_report_ids())));

-- Locking and unlocking are the same authority as editing the plan.
DROP POLICY IF EXISTS crm_pjp_lock_insert ON crm_pjp_month_locks;
CREATE POLICY crm_pjp_lock_insert ON crm_pjp_month_locks FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids())
              AND (crm_user_is_org_admin() OR bde_id IN (SELECT crm_report_ids())));

DROP POLICY IF EXISTS crm_pjp_lock_delete ON crm_pjp_month_locks;
CREATE POLICY crm_pjp_lock_delete ON crm_pjp_month_locks FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin() OR bde_id IN (SELECT crm_report_ids())));

-- Enforce the lock where it matters: a day in a locked month cannot be
-- inserted, changed or cleared until the month is unlocked. This replaces the
-- day-plan write policies from the previous migration, adding the lock guard;
-- the visibility (SELECT) policy is unchanged and stays as it was.
DROP POLICY IF EXISTS crm_pjp_insert ON crm_pjp_day_plans;
CREATE POLICY crm_pjp_insert ON crm_pjp_day_plans FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids())
              AND (crm_user_is_org_admin() OR bde_id IN (SELECT crm_report_ids()))
              AND NOT EXISTS (
                SELECT 1 FROM crm_pjp_month_locks l
                 WHERE l.bde_id = crm_pjp_day_plans.bde_id
                   AND l.month_start = date_trunc('month', crm_pjp_day_plans.plan_date)::date));

DROP POLICY IF EXISTS crm_pjp_update ON crm_pjp_day_plans;
CREATE POLICY crm_pjp_update ON crm_pjp_day_plans FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin() OR bde_id IN (SELECT crm_report_ids()))
         AND NOT EXISTS (
           SELECT 1 FROM crm_pjp_month_locks l
            WHERE l.bde_id = crm_pjp_day_plans.bde_id
              AND l.month_start = date_trunc('month', crm_pjp_day_plans.plan_date)::date));

DROP POLICY IF EXISTS crm_pjp_delete ON crm_pjp_day_plans;
CREATE POLICY crm_pjp_delete ON crm_pjp_day_plans FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin() OR bde_id IN (SELECT crm_report_ids()))
         AND NOT EXISTS (
           SELECT 1 FROM crm_pjp_month_locks l
            WHERE l.bde_id = crm_pjp_day_plans.bde_id
              AND l.month_start = date_trunc('month', crm_pjp_day_plans.plan_date)::date));

-- ------------------------------------------------------------
-- 3. Gap prediction - who to visit first in an area
-- ------------------------------------------------------------
-- Returned rows are scoped to the caller exactly like crm_opportunity_features
-- (own / reports / all-if-admin). The BENCHMARK, however, is computed org-wide:
-- a BDE with eight partners in a city must still be measured against the whole
-- city, not against their own handful. That is why this reads the org-wide
-- materialised view directly (inside SECURITY DEFINER) rather than the scoped
-- reader - and why the caller scope is re-applied only to the rows returned.
--
-- expected/gap are null, not zero, for a partner the model can't score (no
-- base, or no peer group big enough). The UI shows those as "-", and they sort
-- below every scored partner, falling back to real billed rupees.
CREATE OR REPLACE FUNCTION crm_pjp_gap_accounts(p_territory text)
RETURNS TABLE(
  account_id uuid, name text, external_id text, district_new text, tier text,
  reasons text[], customer_count integer,
  actual numeric, per_user numeric, peer_per_user numeric, peer_scope text,
  expected numeric, gap numeric,
  value_this_fy numeric, value_last_fy numeric, value_12m numeric,
  last_activation_date date, last_activation_type text,
  last_visit_date date, days_since_visit integer, last_call_date date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT m.account_id, m.org_id, m.name, m.external_id, m.hub, m.district_new,
           m.region, m.owner_id, ca.tier, ca.pincode, ca.billing_city,
           m.customer_count,
           m.customer_count::numeric AS users,
           GREATEST(COALESCE(m.value_last_fy, 0), COALESCE(m.value_12m, 0)) AS actual,
           m.value_this_fy, m.value_last_fy, m.value_12m,
           m.purchases_this_fy, m.visits_this_fy,
           m.last_tss_date, (current_date - m.last_tss_date)::int AS days_since_tss,
           m.last_activation_date, m.last_activation_type,
           m.last_visit_date, (current_date - m.last_visit_date)::int AS days_since_visit,
           m.last_call_date
    FROM crm_opportunity_features_mv m
    JOIN crm_accounts ca ON ca.id = m.account_id
    WHERE m.org_id IN (SELECT auth_user_org_ids())
      -- Inactive (NA tier) partners are not visited, same rule as the worklist.
      AND COALESCE(ca.tier, '') <> 'NA'
  ),
  -- Org-wide qualifying partners for the benchmark: a real base (>= 25 users,
  -- below which per-user is noise) and some billing to divide.
  q AS (
    SELECT * FROM base WHERE users >= 25 AND actual > 0
  ),
  b_pin  AS (SELECT pincode      AS k, percentile_cont(0.5) WITHIN GROUP (ORDER BY actual / users) AS med, count(*) AS peers
               FROM q WHERE pincode      IS NOT NULL AND pincode      <> '' GROUP BY pincode),
  b_city AS (SELECT billing_city AS k, percentile_cont(0.5) WITHIN GROUP (ORDER BY actual / users) AS med, count(*) AS peers
               FROM q WHERE billing_city IS NOT NULL AND billing_city <> '' GROUP BY billing_city),
  b_dist AS (SELECT district_new AS k, percentile_cont(0.5) WITHIN GROUP (ORDER BY actual / users) AS med, count(*) AS peers
               FROM q WHERE district_new IS NOT NULL AND district_new <> '' GROUP BY district_new),
  b_reg  AS (SELECT region       AS k, percentile_cont(0.5) WITHIN GROUP (ORDER BY actual / users) AS med, count(*) AS peers
               FROM q WHERE region       IS NOT NULL AND region       <> '' GROUP BY region),
  scored AS (
    SELECT base.*,
      -- Finest geography with at least 8 qualifying peers wins.
      COALESCE(
        (SELECT med FROM b_pin  WHERE k = base.pincode      AND peers >= 8),
        (SELECT med FROM b_city WHERE k = base.billing_city AND peers >= 8),
        (SELECT med FROM b_dist WHERE k = base.district_new AND peers >= 8),
        (SELECT med FROM b_reg  WHERE k = base.region       AND peers >= 8)
      ) AS bench,
      CASE
        WHEN (SELECT 1 FROM b_pin  WHERE k = base.pincode      AND peers >= 8) IS NOT NULL THEN 'pincode'
        WHEN (SELECT 1 FROM b_city WHERE k = base.billing_city AND peers >= 8) IS NOT NULL THEN 'city'
        WHEN (SELECT 1 FROM b_dist WHERE k = base.district_new AND peers >= 8) IS NOT NULL THEN 'district'
        WHEN (SELECT 1 FROM b_reg  WHERE k = base.region       AND peers >= 8) IS NOT NULL THEN 'region'
      END AS peer_scope
    FROM base
  )
  SELECT s.account_id, s.name, s.external_id, s.district_new, s.tier,
         -- Reasons, computed inline from the same facts as the worklist so the
         -- prediction tab can badge why a partner is worth the trip.
         ARRAY_REMOVE(ARRAY[
           CASE WHEN s.last_tss_date IS NOT NULL AND s.days_since_tss > 365 THEN 'tss_overdue' END,
           CASE WHEN s.value_last_fy > 0 AND s.purchases_this_fy = 0        THEN 'stopped_buying' END,
           CASE WHEN COALESCE(s.customer_count, 0) >= 10 AND s.value_this_fy = 0 THEN 'base_no_buy' END,
           CASE WHEN s.visits_this_fy = 0 AND s.value_12m > 0               THEN 'not_visited' END
         ], NULL) AS reasons,
         s.customer_count,
         s.actual,
         CASE WHEN s.users > 0 THEN round((s.actual / s.users)::numeric, 2) END AS per_user,
         round(s.bench::numeric, 2) AS peer_per_user,
         s.peer_scope,
         CASE WHEN s.users >= 25 AND s.bench IS NOT NULL THEN round((s.users * s.bench)::numeric) END AS expected,
         CASE WHEN s.users >= 25 AND s.bench IS NOT NULL THEN round((s.users * s.bench - s.actual)::numeric) END AS gap,
         s.value_this_fy, s.value_last_fy, s.value_12m,
         s.last_activation_date, s.last_activation_type,
         s.last_visit_date, s.days_since_visit, s.last_call_date
  FROM scored s
  WHERE COALESCE(s.hub, '(no hub)') = p_territory
    AND (crm_user_is_org_admin()
         OR s.owner_id = auth.uid()
         OR s.owner_id IN (SELECT crm_report_ids()))
  -- Biggest gap first; partners the model can't score fall to billed rupees.
  ORDER BY (CASE WHEN s.users >= 25 AND s.bench IS NOT NULL THEN s.users * s.bench - s.actual END) DESC NULLS LAST,
           s.actual DESC;
$function$;

COMMENT ON FUNCTION crm_pjp_gap_accounts(text) IS
  'Gap-led "who to visit first" for one area: expected business (users x same-place peer median per-user) minus actual, biggest gap first. Benchmark is org-wide; rows are caller-scoped.';

-- ------------------------------------------------------------
-- Grants - same fencing as the rest of the engine
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION crm_pjp_gap_accounts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_pjp_gap_accounts(text) TO authenticated, service_role;
