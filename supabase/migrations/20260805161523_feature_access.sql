CREATE TABLE IF NOT EXISTS feature_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('role','user')),
  subject_key text NOT NULL,
  feature_key text NOT NULL,
  allowed boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, subject_type, subject_key, feature_key)
);
CREATE INDEX IF NOT EXISTS idx_feature_access_org ON feature_access (org_id);

ALTER TABLE feature_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_access_select ON feature_access;
CREATE POLICY feature_access_select ON feature_access FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids())
         AND (is_org_admin() OR hr_can_configure()
              OR subject_type = 'role'
              OR (subject_type = 'user' AND subject_key = auth.uid()::text)));

DROP POLICY IF EXISTS feature_access_insert ON feature_access;
CREATE POLICY feature_access_insert ON feature_access FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND (is_org_admin() OR hr_can_configure()));

DROP POLICY IF EXISTS feature_access_update ON feature_access;
CREATE POLICY feature_access_update ON feature_access FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (is_org_admin() OR hr_can_configure()));

DROP POLICY IF EXISTS feature_access_delete ON feature_access;
CREATE POLICY feature_access_delete ON feature_access FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (is_org_admin() OR hr_can_configure()));