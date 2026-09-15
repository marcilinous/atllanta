-- NA tier means the partner is inactive and is not to be visited.
-- Verified on live data: tier='NA' and partner_status='Inactive' are the same
-- 451 partners, an exact 1:1 with no overlap into AP or Star AP, so either
-- column expresses the rule unambiguously.
--
-- Excluded HERE, in the visit list, rather than in the feature cache (where
-- Kerala is dropped). The distinction matters: Kerala is out of scope for the
-- engine entirely, whereas an inactive partner still has facts worth keeping
-- — 5 of the 451 bought during this financial year (4 in the last 90 days,
-- Rs 323,738 in total), which means their status flag is stale rather than
-- their business being dead. Keeping them in the cache lets that be reported
-- and corrected; excluding them here keeps them off the BDE's route.
--
-- `tier` is also surfaced on the row so the UI can badge Star AP / AP and so
-- tier can become a scoring input later without another signature change.
DROP FUNCTION IF EXISTS crm_partner_actions();

CREATE FUNCTION crm_partner_actions()
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
    -- inactive partners are not visited
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
  ORDER BY GREATEST(f.value_12m, f.value_last_fy) DESC, f.customer_count DESC NULLS LAST;
$function$;

COMMENT ON FUNCTION crm_partner_actions() IS
  'One row per partner worth visiting, with the reason keys it matched. Inactive (tier NA) partners are excluded. Ordered by rupees actually billed.';

-- Inactive on paper, still buying: the status flag needs correcting, these are
-- not visit candidates. Kept as its own report so the exclusion above stays clean.
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

REVOKE ALL ON FUNCTION crm_partner_actions()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_inactive_but_buying()  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_partner_actions()     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_inactive_but_buying() TO authenticated, service_role;