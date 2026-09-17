CREATE TABLE IF NOT EXISTS api_keys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  prefix         TEXT NOT NULL,
  key_hash       TEXT NOT NULL UNIQUE,
  acting_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes         TEXT[] NOT NULL DEFAULT '{read}',
  active         BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash) WHERE active;
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys (org_id);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_select ON api_keys FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY api_keys_insert ON api_keys FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin()
             AND created_by = auth.uid() AND acting_user_id = auth.uid());
CREATE POLICY api_keys_update ON api_keys FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY api_keys_delete ON api_keys FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());