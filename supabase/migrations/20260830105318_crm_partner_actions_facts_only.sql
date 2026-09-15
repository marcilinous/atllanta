-- Return types change, so the old signatures must go first.
DROP FUNCTION IF EXISTS crm_pjp_adherence(date, date);
DROP FUNCTION IF EXISTS crm_pjp_visit_adherence(date, date);
DROP FUNCTION IF EXISTS crm_pjp_day_accounts(text);
DROP FUNCTION IF EXISTS crm_territory_potential();
DROP FUNCTION IF EXISTS crm_opportunity_signals();
DROP FUNCTION IF EXISTS crm_opportunity_features();
-- The rupees-per-customer benchmark is gone: it turned a head count into a
-- money figure nobody measured, and that estimate then drove ranking.
DROP FUNCTION IF EXISTS crm_customer_value_per_head();

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

-- Scoped reader over the cache. Day counts derive here so they stay exact
-- between refreshes. Every column is something on file: a date, a count, or
-- rupees actually billed.
CREATE FUNCTION crm_opportunity_features()
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


-- ONE ROW PER PARTNER worth going to, with the reasons it qualified as a
-- small array of keys. A BDE reads a partner, not four separate signal rows,
-- so the row is the unit and the reasons are chips on it.
--
-- Reason keys, each a statement of something on file:
--   tss_overdue     365+ days since the last TSS purchase. Counted from a
--                   real activation date; it does NOT assume a term length
--                   or a renewal date, because neither is in the data.
--   stopped_buying  billed last FY, nothing at all this FY.
--   low_share       10+ customers on the Customer Base report. The count and
--                   the billing are both shown as they are; no rupee
--                   "potential" is invented from the head count.
--   not_visited     has billed in the last 12 months, no visit this FY.
--
-- Ordering is by value_12m - rupees actually billed. There is no weighted
-- score: every number a BDE sees is one RT really invoiced.
CREATE FUNCTION crm_partner_actions()
RETURNS TABLE(
  account_id uuid, name text, external_id text, hub text, district_new text,
  region text, owner_id uuid, telecaller text,
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
  WITH f AS (SELECT * FROM crm_opportunity_features()),
  r AS (
    SELECT f.account_id AS aid, 'tss_overdue' AS k FROM f
     WHERE f.last_tss_date IS NOT NULL AND f.days_since_tss > 365
    UNION ALL
    SELECT f.account_id, 'stopped_buying' FROM f
     WHERE f.value_last_fy > 0 AND f.purchases_this_fy = 0
    UNION ALL
    SELECT f.account_id, 'low_share' FROM f
     WHERE COALESCE(f.customer_count, 0) >= 10
    UNION ALL
    SELECT f.account_id, 'not_visited' FROM f
     WHERE f.visits_this_fy = 0 AND f.value_12m > 0
  ),
  agg AS (SELECT r.aid, array_agg(r.k ORDER BY r.k) AS ks FROM r GROUP BY r.aid)
  SELECT f.account_id, f.name, f.external_id, f.hub, f.district_new,
         f.region, f.owner_id, f.telecaller,
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
  'One row per partner worth visiting, with the reason keys it matched. Ordered by rupees actually billed in the last 12 months.';


-- Territory totals for the PJP calendar. Sums each partner once (a partner
-- with three reasons is still one partner) and totals real billed rupees.
CREATE FUNCTION crm_territory_potential()
RETURNS TABLE(
  territory text, partners integer, open_value numeric,
  tss_overdue integer, stopped_buying integer, low_share integer, not_visited integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(a.hub, '(no hub)'),
         count(*)::int,
         COALESCE(sum(a.value_12m), 0),
         count(*) FILTER (WHERE 'tss_overdue'    = ANY(a.reasons))::int,
         count(*) FILTER (WHERE 'stopped_buying' = ANY(a.reasons))::int,
         count(*) FILTER (WHERE 'low_share'      = ANY(a.reasons))::int,
         count(*) FILTER (WHERE 'not_visited'    = ANY(a.reasons))::int
  FROM crm_partner_actions() a
  GROUP BY COALESCE(a.hub, '(no hub)')
  ORDER BY 3 DESC;
$function$;

CREATE FUNCTION crm_pjp_day_accounts(p_territory text)
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

REVOKE ALL ON FUNCTION crm_opportunity_features()  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_partner_actions()       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_territory_potential()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_pjp_day_accounts(text)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_opportunity_features() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_partner_actions()      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_territory_potential()  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_pjp_day_accounts(text) TO authenticated, service_role;