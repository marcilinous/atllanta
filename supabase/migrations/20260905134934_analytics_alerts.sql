CREATE TABLE IF NOT EXISTS analytics_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question_id  UUID NOT NULL REFERENCES analytics_questions(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('schedule', 'alert')),
  schedule     TEXT NOT NULL DEFAULT 'daily' CHECK (schedule IN ('daily', 'weekly', 'monthly')),
  alert_column TEXT,
  alert_op     TEXT CHECK (alert_op IN ('gt', 'gte', 'lt', 'lte', 'eq', 'neq')),
  alert_value  NUMERIC,
  active       BOOLEAN NOT NULL DEFAULT true,
  last_run_at  TIMESTAMPTZ,
  last_value   NUMERIC,
  last_triggered BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_org ON analytics_alerts (org_id);
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_due ON analytics_alerts (active, last_run_at);

ALTER TABLE analytics_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY analytics_alerts_select ON analytics_alerts FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY analytics_alerts_insert ON analytics_alerts FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND created_by = auth.uid());
CREATE POLICY analytics_alerts_update ON analytics_alerts FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (created_by = auth.uid() OR crm_user_is_org_admin()));
CREATE POLICY analytics_alerts_delete ON analytics_alerts FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (created_by = auth.uid() OR crm_user_is_org_admin()));

CREATE OR REPLACE FUNCTION analytics_run_as(owner uuid, query text, max_rows integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cleaned text := btrim(query);
  cap     integer := least(greatest(coalesce(max_rows, 1000), 1), 5000);
  result  jsonb;
BEGIN
  IF owner IS NULL THEN RAISE EXCEPTION 'owner is required'; END IF;
  IF cleaned IS NULL OR cleaned = '' THEN RAISE EXCEPTION 'Empty query'; END IF;

  cleaned := regexp_replace(cleaned, ';\s*$', '');
  IF position(';' IN cleaned) > 0 THEN RAISE EXCEPTION 'Only a single statement is allowed'; END IF;
  IF left(lower(cleaned), 6) <> 'select' AND left(lower(cleaned), 4) <> 'with' THEN
    RAISE EXCEPTION 'Only SELECT / WITH queries are allowed';
  END IF;
  IF cleaned ~* '(pg_catalog|information_schema|\mpg_[a-z_]+\M)' THEN
    RAISE EXCEPTION 'Querying system catalogs is not allowed';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SET LOCAL transaction_read_only = on;
  SET LOCAL statement_timeout = '8000';

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) _uq LIMIT %s) t',
    cleaned, cap
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION analytics_run_as(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION analytics_run_as(uuid, text, integer) TO service_role;