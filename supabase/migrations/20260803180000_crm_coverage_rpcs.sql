-- ============================================================
-- CRM COVERAGE
-- ============================================================
-- Rolls the loaded reports up against the partner base: which partners
-- are being called / visited / sold to, and which are untouched — scoped
-- to what the caller can see (admin: all; manager: reporting subtree;
-- rep: own). Activity is classified from the report import it came from.
-- ============================================================

CREATE OR REPLACE FUNCTION crm_coverage()
RETURNS TABLE(owner_id uuid, total bigint, called bigint, visited bigint, sold bigint, touched bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH va AS (
    SELECT a.id, a.owner_id FROM crm_accounts a
    WHERE a.org_id IN (SELECT auth_user_org_ids())
      AND (crm_user_is_org_admin() OR a.owner_id = auth.uid() OR a.owner_id IN (SELECT crm_report_ids()))
  ),
  act AS (
    SELECT r.account_id,
      bool_or(i.name ILIKE '%telecall%' OR i.name ILIKE '%followup%' OR i.columns @> ARRAY['Call Status']) AS called,
      bool_or(i.name ILIKE '%visit%') AS visited,
      bool_or(i.report_type ILIKE 'Sales' OR i.name ILIKE '%activation%') AS sold
    FROM crm_report_rows r JOIN crm_report_imports i ON i.id = r.import_id
    WHERE r.account_id IS NOT NULL AND r.org_id IN (SELECT auth_user_org_ids())
    GROUP BY r.account_id
  )
  SELECT va.owner_id,
    count(*) AS total,
    count(*) FILTER (WHERE act.called) AS called,
    count(*) FILTER (WHERE act.visited) AS visited,
    count(*) FILTER (WHERE act.sold) AS sold,
    count(*) FILTER (WHERE act.called OR act.visited OR act.sold) AS touched
  FROM va LEFT JOIN act ON act.account_id = va.id
  GROUP BY va.owner_id;
$$;

CREATE OR REPLACE FUNCTION crm_uncovered_partners(p_owner uuid)
RETURNS TABLE(id uuid, name text, external_id text, billing_city text, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.name, a.external_id, a.billing_city, a.state
  FROM crm_accounts a
  WHERE a.org_id IN (SELECT auth_user_org_ids())
    AND a.owner_id = p_owner
    AND (crm_user_is_org_admin() OR a.owner_id = auth.uid() OR a.owner_id IN (SELECT crm_report_ids()))
    AND NOT EXISTS (SELECT 1 FROM crm_report_rows r WHERE r.account_id = a.id)
  ORDER BY a.name;
$$;

REVOKE ALL ON FUNCTION crm_coverage() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_uncovered_partners(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_coverage() TO authenticated;
GRANT EXECUTE ON FUNCTION crm_uncovered_partners(uuid) TO authenticated;
