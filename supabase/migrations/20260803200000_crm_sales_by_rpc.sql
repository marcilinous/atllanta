-- ============================================================
-- CRM SALES ANALYSIS
-- ============================================================
-- Aggregates the Activation report, pivotable by a chosen partner
-- dimension (region / role / district_new / hub).
--   Channel: distribution-partner-billed ex-Kerala = RTcompu;
--            distribution-partner-billed in Kerala = separate distributor;
--            everything else = Online.
--   Category: TSS (renewals) / TP (new licence) / TPCA (TPCloud New only)
--             / WABA (WhatsApp New) / Other.
-- Revenue = "sum of activation value"; sale count = "count".
-- Scoped to the caller's visibility (admin all / manager subtree / rep own).
-- ============================================================

CREATE OR REPLACE FUNCTION crm_sales_by(p_dim text)
RETURNS TABLE(bucket text, channel text, category text, sales_count numeric, revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
      CASE WHEN rr.data->>'billing party type'='Tally Distribution Partner' AND a.region='Kerala' THEN 'Kerala'
           WHEN rr.data->>'billing party type'='Tally Distribution Partner' THEN 'RTcompu'
           ELSE 'Online' END AS channel,
      CASE WHEN rr.data->>'activation type'='TSS' THEN 'TSS'
           WHEN rr.data->>'activation type'='New' THEN 'TP'
           WHEN rr.data->>'vas service type'='TPCloud'  AND rr.data->>'vas service transaction type'='New' THEN 'TPCA'
           WHEN rr.data->>'vas service type'='WhatsApp' AND rr.data->>'vas service transaction type'='New' THEN 'WABA'
           ELSE 'Other' END AS category,
      sum((rr.data->>'count')::numeric) AS sales_count,
      sum((rr.data->>'sum of activation value')::numeric) AS revenue
    FROM crm_report_rows rr
    JOIN crm_report_imports i ON i.id=rr.import_id
    LEFT JOIN crm_accounts a ON a.id=rr.account_id
    WHERE i.org_id IN (SELECT auth_user_org_ids())
      AND i.report_type ILIKE 'Sales'
      AND (crm_user_is_org_admin() OR a.owner_id = auth.uid() OR a.owner_id IN (SELECT crm_report_ids()))
    GROUP BY 1,2,3
  $q$, col);
END $$;

REVOKE ALL ON FUNCTION crm_sales_by(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_sales_by(text) TO authenticated;
