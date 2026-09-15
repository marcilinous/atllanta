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