-- Ordering by value_12m alone buried the partners who most need a visit: one
-- who billed 5 lakh last year and nothing since has value_12m = 0, so
-- "stopped buying" sank to the bottom of the list. Order by the larger of the
-- two real figures instead - the most recent evidence of what the partner is
-- worth. Both are sums of money actually billed; nothing is estimated.
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
         f.region, f.owner_id, f.telecaller,
         agg.ks,
         f.customer_count,
         f.last_activation_date, f.last_activation_type, f.days_since_purchase,
         f.last_tss_date, f.days_since_tss,
         f.value_this_fy, f.value_last_fy, f.value_12m,
         f.visits_this_fy, f.last_visit_date, f.days_since_visit,
         f.last_call_date, f.days_since_call
  FROM f JOIN agg ON agg.aid = f.account_id
  ORDER BY GREATEST(f.value_12m, f.value_last_fy) DESC, f.customer_count DESC NULLS LAST;
$function$;

-- Area totals follow the same figure, so the calendar and the list agree.
CREATE OR REPLACE FUNCTION crm_territory_potential()
RETURNS TABLE(
  territory text, partners integer, open_value numeric,
  tss_overdue integer, stopped_buying integer, base_no_buy integer, not_visited integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(a.hub, '(no hub)'),
         count(*)::int,
         COALESCE(sum(GREATEST(a.value_12m, a.value_last_fy)), 0),
         count(*) FILTER (WHERE 'tss_overdue'    = ANY(a.reasons))::int,
         count(*) FILTER (WHERE 'stopped_buying' = ANY(a.reasons))::int,
         count(*) FILTER (WHERE 'base_no_buy'    = ANY(a.reasons))::int,
         count(*) FILTER (WHERE 'not_visited'    = ANY(a.reasons))::int
  FROM crm_partner_actions() a
  GROUP BY COALESCE(a.hub, '(no hub)')
  ORDER BY 3 DESC;
$function$;

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
  ORDER BY GREATEST(a.value_12m, a.value_last_fy) DESC;
$function$;