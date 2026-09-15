-- CRM VISITS — BDE/TL field-visit capture (with selfie)
CREATE TABLE IF NOT EXISTS crm_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id uuid REFERENCES crm_accounts(id) ON DELETE SET NULL,
  site_id text,
  firm_name text,
  visited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  visited_by_name text,
  visited_at timestamptz NOT NULL DEFAULT now(),
  visit_status text,
  call_outcome text,
  remarks text,
  lat numeric(10,7),
  lng numeric(10,7),
  location_text text,
  selfie_path text,
  source text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_visits_org_date   ON crm_visits (org_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_visits_account    ON crm_visits (account_id);
CREATE INDEX IF NOT EXISTS idx_crm_visits_visited_by ON crm_visits (visited_by, visited_at DESC);

ALTER TABLE crm_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_visits_select ON crm_visits;
CREATE POLICY crm_visits_select ON crm_visits FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin()
              OR visited_by = auth.uid()
              OR visited_by IN (SELECT crm_report_ids())));

DROP POLICY IF EXISTS crm_visits_insert ON crm_visits;
CREATE POLICY crm_visits_insert ON crm_visits FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids())
             AND visited_by = auth.uid());

DROP POLICY IF EXISTS crm_visits_update ON crm_visits;
CREATE POLICY crm_visits_update ON crm_visits FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin() OR visited_by = auth.uid()));

DROP POLICY IF EXISTS crm_visits_delete ON crm_visits;
CREATE POLICY crm_visits_delete ON crm_visits FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin() OR visited_by = auth.uid()));

-- Selfie storage — private bucket, one folder per org.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('visit-selfies', 'visit-selfies', false, 5242880, ARRAY['image/jpeg','image/webp','image/png'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS visit_selfies_read ON storage.objects;
CREATE POLICY visit_selfies_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'visit-selfies'
         AND (NULLIF(split_part(name, '/', 1), ''))::uuid IN (SELECT auth_user_org_ids()));

DROP POLICY IF EXISTS visit_selfies_insert ON storage.objects;
CREATE POLICY visit_selfies_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'visit-selfies'
             AND (NULLIF(split_part(name, '/', 1), ''))::uuid IN (SELECT auth_user_org_ids()));

DROP POLICY IF EXISTS visit_selfies_update ON storage.objects;
CREATE POLICY visit_selfies_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'visit-selfies'
         AND (NULLIF(split_part(name, '/', 1), ''))::uuid IN (SELECT auth_user_org_ids()));

DROP POLICY IF EXISTS visit_selfies_delete ON storage.objects;
CREATE POLICY visit_selfies_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'visit-selfies'
         AND (NULLIF(split_part(name, '/', 1), ''))::uuid IN (SELECT auth_user_org_ids()));

-- Fold app-logged visits into crm_partner_activity.
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
    SELECT av.acct_id,
      bool_or(av.is_mine) AS mine,
      count(*) FILTER (WHERE av.is_mine)::int AS my_count
    FROM (
      SELECT rr.account_id AS acct_id, (rr.person_user_id = auth.uid()) AS is_mine
      FROM crm_report_rows rr JOIN crm_report_imports i ON i.id=rr.import_id
      WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.name ILIKE '%visit%' AND rr.account_id IS NOT NULL
      UNION ALL
      SELECT v.account_id AS acct_id, (v.visited_by = auth.uid()) AS is_mine
      FROM crm_visits v
      WHERE v.org_id IN (SELECT auth_user_org_ids()) AND v.account_id IS NOT NULL
    ) av
    GROUP BY av.acct_id
  ),
  cal AS (
    SELECT rr.account_id AS acct_id,
      bool_or(rr.person_user_id = auth.uid()) AS mine,
      count(*)::int AS total
    FROM crm_report_rows rr JOIN crm_report_imports i ON i.id=rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids())
      AND (i.name ILIKE '%telecall%' OR i.name ILIKE '%followup%' OR i.columns @> ARRAY['Call Status'])
      AND rr.account_id IS NOT NULL
    GROUP BY rr.account_id
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