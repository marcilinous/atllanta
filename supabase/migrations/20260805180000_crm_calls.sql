-- ============================================================
-- CRM CALLS — telecaller call logging + book
-- ============================================================
-- RT drives TSS renewals with telecallers. Each partner carries a telecaller
-- name (crm_accounts.telecaller). This adds:
--   • crm_calls — a first-class log of calls (status, outcome, follow-up)
--   • crm_telecaller_book() — the caller's assigned partners with TSS signals
--     and last-call info (a SECURITY DEFINER RPC, because crm_accounts RLS is
--     scoped to the BDE owner, not the telecaller)
--   • app-logged calls folded into crm_partner_activity's call counts
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id uuid REFERENCES crm_accounts(id) ON DELETE SET NULL,
  site_id text,
  firm_name text,
  called_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  called_by_name text,
  telecaller_name text,               -- the partner's assigned telecaller at call time
  called_at timestamptz NOT NULL DEFAULT now(),
  call_status text,                   -- Connected / No answer / Busy / Switched off / ...
  outcome text,                       -- Renewed / Will renew / Not interested / Callback / ...
  remarks text,
  follow_up_date date,
  source text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_calls_org_date  ON crm_calls (org_id, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_calls_account   ON crm_calls (account_id);
CREATE INDEX IF NOT EXISTS idx_crm_calls_by        ON crm_calls (called_by, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_calls_followup  ON crm_calls (org_id, follow_up_date) WHERE follow_up_date IS NOT NULL;

ALTER TABLE crm_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_calls_select ON crm_calls;
CREATE POLICY crm_calls_select ON crm_calls FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin() OR called_by = auth.uid() OR called_by IN (SELECT crm_report_ids())));

DROP POLICY IF EXISTS crm_calls_insert ON crm_calls;
CREATE POLICY crm_calls_insert ON crm_calls FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND called_by = auth.uid());

DROP POLICY IF EXISTS crm_calls_update ON crm_calls;
CREATE POLICY crm_calls_update ON crm_calls FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (crm_user_is_org_admin() OR called_by = auth.uid()));

DROP POLICY IF EXISTS crm_calls_delete ON crm_calls;
CREATE POLICY crm_calls_delete ON crm_calls FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (crm_user_is_org_admin() OR called_by = auth.uid()));

-- ------------------------------------------------------------
-- The telecaller's book: their assigned partners with TSS renewal signals
-- and last-call info. A telecaller (member) sees only their own name-matched
-- book; managers/admins may pass a telecaller name, or NULL for the whole org.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_telecaller_book(text);
CREATE OR REPLACE FUNCTION crm_telecaller_book(p_telecaller text DEFAULT NULL)
RETURNS TABLE(
  account_id uuid, name text, external_id text, district_new text, region text, hub text, telecaller text,
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
    SELECT a.id, a.name, a.external_id, a.district_new, a.region, a.hub, a.telecaller
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
  SELECT ac.id, ac.name, ac.external_id, ac.district_new, ac.region, ac.hub, ac.telecaller,
    COALESCE(g.tss_cfy,0), COALESCE(g.tss_lfy,0), COALESCE(g.any_cfy,0), COALESCE(g.tp_cfy,0),
    cl.last_call_at, COALESCE(cl.total,0), COALESCE(cl.mine,false)
  FROM acct ac
  LEFT JOIN agg g ON g.acct_id = ac.id
  LEFT JOIN calls cl ON cl.acct_id = ac.id;
END $$;

REVOKE ALL ON FUNCTION crm_telecaller_book(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_telecaller_book(text) TO authenticated;

-- Distinct telecaller names (+ partner counts) for the manager/admin picker.
-- Returns nothing for non-managers (they only ever see their own book).
CREATE OR REPLACE FUNCTION crm_telecaller_names()
RETURNS TABLE(telecaller text, partners int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.telecaller, count(*)::int
  FROM crm_accounts a
  WHERE a.org_id IN (SELECT auth_user_org_ids())
    AND a.telecaller IS NOT NULL AND a.telecaller <> ''
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = auth.uid()
                AND m.role IN ('owner','admin','super_admin','agency_admin','client_admin','manager'))
  GROUP BY a.telecaller ORDER BY a.telecaller;
$$;
REVOKE ALL ON FUNCTION crm_telecaller_names() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_telecaller_names() TO authenticated;

-- ------------------------------------------------------------
-- Fold app-logged calls into crm_partner_activity's call counts (only the
-- `cal` CTE changes vs 20260804120000; everything else reproduced verbatim).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_partner_activity();
CREATE OR REPLACE FUNCTION crm_partner_activity()
RETURNS TABLE(
  account_id uuid, name text, external_id text, district_new text, region text, owner_id uuid,
  tp_cfy int, tp_lfy int, tss_cfy int, tss_lfy int, any_cfy int, any_lfy int,
  rev_cfy numeric, rev_lfy numeric,
  visited boolean, called boolean, visited_by_me boolean, called_by_me boolean,
  visits_me int, calls_total int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  cfy_start date := make_date(EXTRACT(year FROM current_date)::int - CASE WHEN EXTRACT(month FROM current_date) >= 4 THEN 0 ELSE 1 END, 4, 1);
  cfy_end date; lfy_start date; lfy_end date;
BEGIN
  cfy_end   := (cfy_start + interval '1 year - 1 day')::date;
  lfy_start := (cfy_start - interval '1 year')::date;
  lfy_end   := (cfy_start - interval '1 day')::date;
  RETURN QUERY
  WITH acct AS (
    SELECT a.id, a.name, a.external_id, a.district_new, a.region, a.owner_id
    FROM crm_accounts a
    WHERE a.org_id IN (SELECT auth_user_org_ids())
      AND (crm_user_is_org_admin() OR a.owner_id = auth.uid() OR a.owner_id IN (SELECT crm_report_ids()))
  ),
  sales AS (
    SELECT rr.account_id AS acct_id,
      rr.data->>'activation type' AS atype,
      CASE WHEN rr.data->>'sum of activation value' ~ '^-?[0-9]+(\.[0-9]+)?$'
           THEN (rr.data->>'sum of activation value')::numeric ELSE 0 END AS rev,
      CASE WHEN left(rr.data->>'activation date',10) ~ '^\d{4}-\d{2}-\d{2}$'
           THEN left(rr.data->>'activation date',10)::date END AS adate
    FROM crm_report_rows rr JOIN crm_report_imports i ON i.id = rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.report_type ILIKE 'Sales' AND rr.account_id IS NOT NULL
  ),
  agg AS (
    SELECT s.acct_id,
      count(*) FILTER (WHERE s.atype='New' AND s.adate BETWEEN cfy_start AND cfy_end)::int AS tp_cfy,
      count(*) FILTER (WHERE s.atype='New' AND s.adate BETWEEN lfy_start AND lfy_end)::int AS tp_lfy,
      count(*) FILTER (WHERE s.atype='TSS' AND s.adate BETWEEN cfy_start AND cfy_end)::int AS tss_cfy,
      count(*) FILTER (WHERE s.atype='TSS' AND s.adate BETWEEN lfy_start AND lfy_end)::int AS tss_lfy,
      count(*) FILTER (WHERE s.adate BETWEEN cfy_start AND cfy_end)::int AS any_cfy,
      count(*) FILTER (WHERE s.adate BETWEEN lfy_start AND lfy_end)::int AS any_lfy,
      COALESCE(sum(s.rev) FILTER (WHERE s.adate BETWEEN cfy_start AND cfy_end),0) AS rev_cfy,
      COALESCE(sum(s.rev) FILTER (WHERE s.adate BETWEEN lfy_start AND lfy_end),0) AS rev_lfy
    FROM sales s GROUP BY s.acct_id
  ),
  vis AS (
    SELECT av.acct_id, bool_or(av.is_mine) AS mine, count(*) FILTER (WHERE av.is_mine)::int AS my_count
    FROM (
      SELECT rr.account_id AS acct_id, (rr.person_user_id = auth.uid()) AS is_mine
      FROM crm_report_rows rr JOIN crm_report_imports i ON i.id=rr.import_id
      WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.name ILIKE '%visit%' AND rr.account_id IS NOT NULL
      UNION ALL
      SELECT v.account_id AS acct_id, (v.visited_by = auth.uid()) AS is_mine
      FROM crm_visits v WHERE v.org_id IN (SELECT auth_user_org_ids()) AND v.account_id IS NOT NULL
    ) av GROUP BY av.acct_id
  ),
  cal AS (
    SELECT ac2.acct_id, bool_or(ac2.is_mine) AS mine, count(*)::int AS total
    FROM (
      SELECT rr.account_id AS acct_id, (rr.person_user_id = auth.uid()) AS is_mine
      FROM crm_report_rows rr JOIN crm_report_imports i ON i.id=rr.import_id
      WHERE i.org_id IN (SELECT auth_user_org_ids())
        AND (i.name ILIKE '%telecall%' OR i.name ILIKE '%followup%' OR i.columns @> ARRAY['Call Status'])
        AND rr.account_id IS NOT NULL
      UNION ALL
      SELECT c.account_id AS acct_id, (c.called_by = auth.uid()) AS is_mine
      FROM crm_calls c WHERE c.org_id IN (SELECT auth_user_org_ids()) AND c.account_id IS NOT NULL
    ) ac2 GROUP BY ac2.acct_id
  )
  SELECT ac.id, ac.name, ac.external_id, ac.district_new, ac.region, ac.owner_id,
    COALESCE(g.tp_cfy,0), COALESCE(g.tp_lfy,0), COALESCE(g.tss_cfy,0), COALESCE(g.tss_lfy,0),
    COALESCE(g.any_cfy,0), COALESCE(g.any_lfy,0), COALESCE(g.rev_cfy,0), COALESCE(g.rev_lfy,0),
    (v.acct_id IS NOT NULL), (c.acct_id IS NOT NULL),
    COALESCE(v.mine, false), COALESCE(c.mine, false),
    COALESCE(v.my_count,0), COALESCE(c.total,0)
  FROM acct ac
  LEFT JOIN agg g ON g.acct_id = ac.id
  LEFT JOIN vis v ON v.acct_id = ac.id
  LEFT JOIN cal c ON c.acct_id = ac.id;
END $$;

REVOKE ALL ON FUNCTION crm_partner_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_partner_activity() TO authenticated;
