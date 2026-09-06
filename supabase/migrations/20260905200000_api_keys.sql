-- ============================================================
-- ORG API KEYS — external tools read/write Atllanta via a revocable key.
--
-- The REST surface is Supabase PostgREST (already exposed, RLS-enforced). The
-- key layer is the `api-gateway` Supabase Edge Function: it validates a
-- revocable opaque key on every request, mints a short-lived JWT for the key's
-- acting user, and forwards to PostgREST — so all access runs under that user's
-- RLS (org-scoped). No Vercel function is used.
--
-- Only the SHA-256 HASH of a key is stored; the raw key (atl_live_…) is shown
-- once at creation and never persisted. Keys act as their creating admin, so
-- external access is bounded to what that admin can see.
-- ============================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  prefix         TEXT NOT NULL,                       -- shown in the UI to identify the key
  key_hash       TEXT NOT NULL UNIQUE,                -- sha256(raw key), hex
  acting_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- RLS identity the key runs as
  scopes         TEXT[] NOT NULL DEFAULT '{read}',    -- 'read' and/or 'write'
  active         BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash) WHERE active;
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys (org_id);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Org admins manage keys. The gateway reads keys via service_role (bypasses RLS).
CREATE POLICY api_keys_select ON api_keys FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY api_keys_insert ON api_keys FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin()
             AND created_by = auth.uid() AND acting_user_id = auth.uid());
CREATE POLICY api_keys_update ON api_keys FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY api_keys_delete ON api_keys FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
