CREATE TABLE IF NOT EXISTS crm_pjp_day_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bde_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_date date NOT NULL,
  territory text NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, bde_id, plan_date)
);

CREATE INDEX IF NOT EXISTS idx_crm_pjp_bde_date   ON crm_pjp_day_plans (bde_id, plan_date);
CREATE INDEX IF NOT EXISTS idx_crm_pjp_org_date   ON crm_pjp_day_plans (org_id, plan_date);
CREATE INDEX IF NOT EXISTS idx_crm_pjp_territory  ON crm_pjp_day_plans (org_id, territory, plan_date);

ALTER TABLE crm_pjp_day_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_pjp_select ON crm_pjp_day_plans;
CREATE POLICY crm_pjp_select ON crm_pjp_day_plans FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin()
              OR bde_id = auth.uid()
              OR bde_id IN (SELECT crm_report_ids())));

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

GRANT EXECUTE ON FUNCTION crm_territory_potential() TO authenticated;

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

GRANT EXECUTE ON FUNCTION crm_pjp_day_accounts(text) TO authenticated;