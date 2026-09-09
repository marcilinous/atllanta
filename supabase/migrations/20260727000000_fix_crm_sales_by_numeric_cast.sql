-- ATLLANTA — repair crm_sales_by numeric-cast crash.
--
-- crm_sales_by aggregates Tally activation report rows (crm_report_rows.data,
-- jsonb) into sales_count + revenue, sliced by region/tier/district/hub and
-- product category. The aggregates cast the jsonb text straight to numeric:
--   sum((rr.data->>'count')::numeric)
--   sum((rr.data->>'sum of activation value')::numeric)
-- but `rr.data->>'key'` yields an empty string '' for a blank value, and
-- ''::numeric throws `invalid input syntax for type numeric: ""`. A single
-- blank row (1 of 32,485 Sales rows) aborts the whole call, so the RTcompu
-- Sales view can never render.
--
-- Fix: coalesce empty strings to 0 before the cast —
--   sum(COALESCE(NULLIF(rr.data->>'…','')::numeric, 0))
-- Also drop the dead `region='Kerala' -> 'Kerala'` channel branch: Kerala was
-- fully removed from RTcompu, so it can only ever be RTcompu or Online now.
--
-- Non-destructive (CREATE OR REPLACE); signature, return type, security, and
-- the RLS WHERE clause are unchanged.

CREATE OR REPLACE FUNCTION public.crm_sales_by(p_dim text, p_from text DEFAULT ''::text, p_to text DEFAULT ''::text)
 RETURNS TABLE(bucket text, channel text, category text, sales_count numeric, revenue numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE col text;
BEGIN
  col := CASE p_dim
    WHEN 'region'   THEN 'a.region'
    WHEN 'role'     THEN 'a.tier'
    WHEN 'district' THEN 'a.district_new'
    WHEN 'hub'      THEN 'a.hub'
    ELSE 'a.region' END;
  RETURN QUERY EXECUTE format($q$
    SELECT COALESCE(NULLIF(TRIM(%s),''),'(none)') AS bucket,
      CASE WHEN rr.data->>'billing party type'='Tally Distribution Partner' THEN 'RTcompu'
           ELSE 'Online' END AS channel,
      CASE WHEN rr.data->>'activation type'='TSS' THEN 'TSS'
           WHEN rr.data->>'activation type'='New' THEN 'TP'
           WHEN rr.data->>'vas service type'='TPCloud'  AND rr.data->>'vas service transaction type'='New' THEN 'TPCA'
           WHEN rr.data->>'vas service type'='WhatsApp' AND rr.data->>'vas service transaction type'='New' THEN 'WABA'
           ELSE 'Other' END AS category,
      sum(COALESCE(NULLIF(rr.data->>'count','')::numeric, 0)) AS sales_count,
      sum(COALESCE(NULLIF(rr.data->>'sum of activation value','')::numeric, 0)) AS revenue
    FROM crm_report_rows rr
    JOIN crm_report_imports i ON i.id=rr.import_id
    LEFT JOIN crm_accounts a ON a.id=rr.account_id
    WHERE i.org_id IN (SELECT auth_user_org_ids())
      AND i.report_type ILIKE 'Sales'
      AND (crm_user_is_org_admin() OR a.owner_id = auth.uid() OR a.owner_id IN (SELECT crm_report_ids()))
      AND ($1 = '' OR left(rr.data->>'activation date',10) >= $1)
      AND ($2 = '' OR left(rr.data->>'activation date',10) <= $2)
    GROUP BY 1,2,3
  $q$, col) USING p_from, p_to;
END $function$;
