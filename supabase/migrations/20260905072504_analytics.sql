-- ============================================================
-- ANALYTICS — a Metabase-inspired, self-serve analytics layer.
-- ============================================================

CREATE TABLE IF NOT EXISTS analytics_questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  mode        TEXT NOT NULL DEFAULT 'builder' CHECK (mode IN ('builder', 'sql')),
  spec        JSONB NOT NULL DEFAULT '{}'::jsonb,
  viz         TEXT NOT NULL DEFAULT 'table',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_questions_org ON analytics_questions (org_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  cards       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_dashboards_org ON analytics_dashboards (org_id, updated_at DESC);

ALTER TABLE analytics_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_dashboards ENABLE ROW LEVEL SECURITY;

CREATE POLICY analytics_questions_select ON analytics_questions FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY analytics_questions_insert ON analytics_questions FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND created_by = auth.uid());
CREATE POLICY analytics_questions_update ON analytics_questions FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (created_by = auth.uid() OR crm_user_is_org_admin()));
CREATE POLICY analytics_questions_delete ON analytics_questions FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (created_by = auth.uid() OR crm_user_is_org_admin()));

CREATE POLICY analytics_dashboards_select ON analytics_dashboards FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY analytics_dashboards_insert ON analytics_dashboards FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND created_by = auth.uid());
CREATE POLICY analytics_dashboards_update ON analytics_dashboards FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (created_by = auth.uid() OR crm_user_is_org_admin()));
CREATE POLICY analytics_dashboards_delete ON analytics_dashboards FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (created_by = auth.uid() OR crm_user_is_org_admin()));

-- Read-only SQL runner (SECURITY INVOKER — RLS stays enforced for the caller).
CREATE OR REPLACE FUNCTION analytics_run_sql(query text, max_rows integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  cleaned text := btrim(query);
  cap     integer := least(greatest(coalesce(max_rows, 1000), 1), 5000);
  result  jsonb;
BEGIN
  IF cleaned IS NULL OR cleaned = '' THEN
    RAISE EXCEPTION 'Empty query';
  END IF;

  cleaned := regexp_replace(cleaned, ';\s*$', '');
  IF position(';' IN cleaned) > 0 THEN
    RAISE EXCEPTION 'Only a single statement is allowed';
  END IF;

  IF left(lower(cleaned), 6) <> 'select' AND left(lower(cleaned), 4) <> 'with' THEN
    RAISE EXCEPTION 'Only SELECT / WITH queries are allowed';
  END IF;

  IF cleaned ~* '(pg_catalog|information_schema|\mpg_[a-z_]+\M)' THEN
    RAISE EXCEPTION 'Querying system catalogs is not allowed';
  END IF;

  SET LOCAL transaction_read_only = on;
  SET LOCAL statement_timeout = '8000';

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) _uq LIMIT %s) t',
    cleaned, cap
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION analytics_run_sql(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION analytics_run_sql(text, integer) TO authenticated;
