-- 'low_share' was 'has 10+ customers', which is not a reason to visit anyone:
-- it put partners billing 25-30 lakh who bought TSS two days ago and were
-- visited last week at the top of the list. Without the rupee-per-customer
-- benchmark (removed as invented) there is no honest way to call a share
-- "low". Replaced with a claim the data does support: a real customer base
-- and nothing billed at all this financial year.
DROP FUNCTION IF EXISTS crm_territory_potential();

CREATE OR REPLACE FUNCTION crm_partner_actions()
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
    -- 365+ days since the last TSS purchase. Counted from a real activation
    -- date; assumes no term length and no renewal date, because the data has
    -- neither.
    SELECT f.account_id AS aid, 'tss_overdue' AS k FROM f
     WHERE f.last_tss_date IS NOT NULL AND f.days_since_tss > 365
    UNION ALL
    -- Billed last FY, nothing at all this FY.
    SELECT f.account_id, 'stopped_buying' FROM f
     WHERE f.value_last_fy > 0 AND f.purchases_this_fy = 0
    UNION ALL
    -- A real customer base and no purchase this FY. Both halves are on file.
    SELECT f.account_id, 'base_no_buy' FROM f
     WHERE COALESCE(f.customer_count, 0) >= 10 AND f.value_this_fy = 0
    UNION ALL
    -- Has billed in the last 12 months but no visit logged this FY.
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

CREATE FUNCTION crm_territory_potential()
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

REVOKE ALL ON FUNCTION crm_partner_actions()     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_territory_potential() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_partner_actions()     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_territory_potential() TO authenticated, service_role;