CREATE OR REPLACE FUNCTION crm_customer_value_per_head()
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH cfy AS (
    SELECT make_date(
      EXTRACT(year FROM current_date)::int
        - CASE WHEN EXTRACT(month FROM current_date) >= 4 THEN 0 ELSE 1 END, 4, 1) AS s
  ),
  rev AS (
    SELECT rr.account_id AS acct_id,
      sum(CASE WHEN rr.data->>'sum of activation value' ~ '^-?[0-9]+(\.[0-9]+)?$'
                AND crm_report_event_date(rr.data->>'activation date')
                    BETWEEN (SELECT s FROM cfy)
                        AND ((SELECT s FROM cfy) + interval '1 year - 1 day')::date
               THEN (rr.data->>'sum of activation value')::numeric ELSE 0 END) AS rev_cfy
    FROM crm_report_rows rr
    JOIN crm_report_imports i ON i.id = rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids())
      AND i.report_type ILIKE 'Sales'
      AND rr.account_id IS NOT NULL
    GROUP BY rr.account_id
  )
  SELECT COALESCE(
    NULLIF(percentile_cont(0.75) WITHIN GROUP (
      ORDER BY COALESCE(r.rev_cfy, 0) / a.customer_count), 0),
    856)
  FROM crm_accounts a
  LEFT JOIN rev r ON r.acct_id = a.id
  WHERE a.org_id IN (SELECT auth_user_org_ids())
    AND COALESCE(a.region, '') <> 'Kerala'
    AND a.customer_count > 0;
$function$;

COMMENT ON FUNCTION crm_customer_value_per_head() IS
  'Peer benchmark: rupees a strong partner bills per end customer per year (75th percentile of actual, current FY). The single swap point for when the Customer Base report gains a real value column.';

GRANT EXECUTE ON FUNCTION crm_customer_value_per_head() TO authenticated;