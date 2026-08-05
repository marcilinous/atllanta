-- ============================================================
-- CRM CALLS — align with the Telecalling Report for daily updates
-- ============================================================
-- The imported "Telecalling Report" captures a primary AND secondary call
-- outcome, plus a reminder date. crm_calls already has call_status, outcome
-- (= primary) and follow_up_date (= reminder); add the secondary outcome and
-- expose the partner phone in the book so telecallers can dial from the list.
-- ============================================================

ALTER TABLE crm_calls
  ADD COLUMN IF NOT EXISTS secondary_outcome text;

DROP FUNCTION IF EXISTS crm_telecaller_book(text);
CREATE OR REPLACE FUNCTION crm_telecaller_book(p_telecaller text DEFAULT NULL)
RETURNS TABLE(
  account_id uuid, name text, external_id text, district_new text, region text, hub text, telecaller text, phone text,
  tss_cfy int, tss_lfy int, any_cfy int, tp_cfy int,
  last_call_at timestamptz, calls_total int, called_by_me boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  cfy_start date := make_date(EXTRACT(year FROM current_date)::int - CASE WHEN EXTRACT(month FROM current_date) >= 4 THEN 0 ELSE 1 END, 4, 1);
  cfy_end date; lfy_start date; lfy_end date;
  my_name text; is_mgr boolean; eff text;
BEGIN
  cfy_end   := (cfy_start + interval '1 year - 1 day')::date;
  lfy_start := (cfy_start - interval '1 year')::date;
  lfy_end   := (cfy_start - interval '1 day')::date;
  SELECT u.full_name INTO my_name FROM users u WHERE u.id = auth.uid();
  is_mgr := EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = auth.uid()
                    AND m.role IN ('owner','admin','super_admin','agency_admin','client_admin','manager'));
  eff := CASE WHEN is_mgr THEN p_telecaller ELSE my_name END;

  RETURN QUERY
  WITH acct AS (
    SELECT a.id, a.name, a.external_id, a.district_new, a.region, a.hub, a.telecaller, a.phone
    FROM crm_accounts a
    WHERE a.org_id IN (SELECT auth_user_org_ids())
      AND ( (is_mgr AND eff IS NULL) OR (eff IS NOT NULL AND a.telecaller ILIKE eff) )
  ),
  sales AS (
    SELECT rr.account_id AS acct_id, rr.data->>'activation type' AS atype,
      CASE WHEN left(rr.data->>'activation date',10) ~ '^\d{4}-\d{2}-\d{2}$'
           THEN left(rr.data->>'activation date',10)::date END AS adate
    FROM crm_report_rows rr JOIN crm_report_imports i ON i.id = rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.report_type ILIKE 'Sales'
      AND rr.account_id IN (SELECT id FROM acct)
  ),
  agg AS (
    SELECT s.acct_id,
      count(*) FILTER (WHERE s.atype='TSS' AND s.adate BETWEEN cfy_start AND cfy_end)::int AS tss_cfy,
      count(*) FILTER (WHERE s.atype='TSS' AND s.adate BETWEEN lfy_start AND lfy_end)::int AS tss_lfy,
      count(*) FILTER (WHERE s.adate BETWEEN cfy_start AND cfy_end)::int AS any_cfy,
      count(*) FILTER (WHERE s.atype='New' AND s.adate BETWEEN cfy_start AND cfy_end)::int AS tp_cfy
    FROM sales s GROUP BY s.acct_id
  ),
  calls AS (
    SELECT c.account_id AS acct_id, max(c.called_at) AS last_call_at,
      count(*)::int AS total, bool_or(c.called_by = auth.uid()) AS mine
    FROM crm_calls c
    WHERE c.org_id IN (SELECT auth_user_org_ids()) AND c.account_id IN (SELECT id FROM acct)
    GROUP BY c.account_id
  )
  SELECT ac.id, ac.name, ac.external_id, ac.district_new, ac.region, ac.hub, ac.telecaller, ac.phone,
    COALESCE(g.tss_cfy,0), COALESCE(g.tss_lfy,0), COALESCE(g.any_cfy,0), COALESCE(g.tp_cfy,0),
    cl.last_call_at, COALESCE(cl.total,0), COALESCE(cl.mine,false)
  FROM acct ac
  LEFT JOIN agg g ON g.acct_id = ac.id
  LEFT JOIN calls cl ON cl.acct_id = ac.id;
END $$;

REVOKE ALL ON FUNCTION crm_telecaller_book(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_telecaller_book(text) TO authenticated;
