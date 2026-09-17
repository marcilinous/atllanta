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

GRANT EXECUTE ON FUNCTION crm_pjp_visit_adherence(date, date) TO authenticated;

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

GRANT EXECUTE ON FUNCTION crm_pjp_adherence(date, date) TO authenticated;