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
  GROWTH_CAPTURE_CEILING         constant numeric := 0.5;
  COVERAGE_STALE_DAYS            constant integer := 120;
  per_head numeric := crm_customer_value_per_head();
BEGIN
  RETURN QUERY
  WITH f AS (SELECT * FROM crm_opportunity_features()),
  scored AS (
    SELECT f.*,
      (COALESCE(f.customer_count, 0) * per_head) AS potential,
      (f.tp_lfy_value > 0 AND f.tp_cfy_count = 0) AS tp_lapsed,
      (f.tss_lfy_value > 0 AND f.tss_cfy_count = 0) AS tss_lapsed
    FROM f
  ),
  sig AS (
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
    SELECT s.*, 'different_approach', 4,
      s.visits_since_lapse || ' visits this year with no conversion - pricing/approach, not coverage',
      'TL',
      s.tp_lfy_value,
      0.15
    FROM scored s
    WHERE s.tp_lapsed AND s.visits_since_lapse >= 3

    UNION ALL
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

GRANT EXECUTE ON FUNCTION crm_opportunity_signals() TO authenticated;