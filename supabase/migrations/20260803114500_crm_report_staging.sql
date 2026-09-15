CREATE TABLE IF NOT EXISTS crm_report_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  report_type text,
  source_filename text,
  columns text[] NOT NULL DEFAULT '{}',
  site_id_column text,
  row_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_report_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES crm_report_imports(id) ON DELETE CASCADE,
  report_type text,
  site_id text,
  account_id uuid REFERENCES crm_accounts(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_report_imports_org ON crm_report_imports (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_report_rows_site ON crm_report_rows (org_id, site_id);
CREATE INDEX IF NOT EXISTS idx_crm_report_rows_import ON crm_report_rows (import_id);
CREATE INDEX IF NOT EXISTS idx_crm_report_rows_type ON crm_report_rows (org_id, report_type);
CREATE INDEX IF NOT EXISTS idx_crm_report_rows_account ON crm_report_rows (account_id);

ALTER TABLE crm_report_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_report_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_report_imports_select ON crm_report_imports;
CREATE POLICY crm_report_imports_select ON crm_report_imports FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin() OR imported_by = auth.uid()));

DROP POLICY IF EXISTS crm_report_imports_insert ON crm_report_imports;
CREATE POLICY crm_report_imports_insert ON crm_report_imports FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()));

DROP POLICY IF EXISTS crm_report_imports_update ON crm_report_imports;
CREATE POLICY crm_report_imports_update ON crm_report_imports FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin() OR imported_by = auth.uid()));

DROP POLICY IF EXISTS crm_report_imports_delete ON crm_report_imports;
CREATE POLICY crm_report_imports_delete ON crm_report_imports FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin() OR imported_by = auth.uid()));

DROP POLICY IF EXISTS crm_report_rows_select ON crm_report_rows;
CREATE POLICY crm_report_rows_select ON crm_report_rows FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin()
              OR EXISTS (SELECT 1 FROM crm_report_imports i
                         WHERE i.id = crm_report_rows.import_id
                           AND i.imported_by = auth.uid())));

DROP POLICY IF EXISTS crm_report_rows_insert ON crm_report_rows;
CREATE POLICY crm_report_rows_insert ON crm_report_rows FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()));

DROP POLICY IF EXISTS crm_report_rows_update ON crm_report_rows;
CREATE POLICY crm_report_rows_update ON crm_report_rows FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND crm_user_is_org_admin());

DROP POLICY IF EXISTS crm_report_rows_delete ON crm_report_rows;
CREATE POLICY crm_report_rows_delete ON crm_report_rows FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (crm_user_is_org_admin()
              OR EXISTS (SELECT 1 FROM crm_report_imports i
                         WHERE i.id = crm_report_rows.import_id
                           AND i.imported_by = auth.uid())));