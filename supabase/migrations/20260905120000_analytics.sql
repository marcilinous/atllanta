-- ============================================================
-- ANALYTICS — a Metabase-inspired, self-serve analytics layer.
--
-- Two org-scoped tables hold the saved artefacts:
--   analytics_questions  — a saved "question": a query spec + chart choice.
--   analytics_dashboards — an ordered grid of question cards.
--
-- Both the visual query builder and the raw-SQL editor run entirely through
-- the caller's RLS: the builder aggregates RLS-scoped rows in the browser, and
-- the SQL editor goes through analytics_run_sql() below, which is SECURITY
-- INVOKER — so it runs as the calling user and every referenced table's RLS
-- still applies. There is NO service_role path: a member only ever sees their
-- own rows, a manager their team's, an admin the org's — exactly as in the UI.
-- ============================================================

-- ------------------------------------------------------------
-- Saved questions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  -- 'builder' (spec drives client-side aggregation) or 'sql' (spec.sql runs
  -- through analytics_run_sql).
  mode        TEXT NOT NULL DEFAULT 'builder' CHECK (mode IN ('builder', 'sql')),
  -- Full query definition. Builder: {model, dimensions, measures, filters,
  -- sort, limit}. SQL: {sql}. Both: {viz, vizOptions}.
  spec        JSONB NOT NULL DEFAULT '{}'::jsonb,
  viz         TEXT NOT NULL DEFAULT 'table',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_questions_org ON analytics_questions (org_id, updated_at DESC);

-- ------------------------------------------------------------
-- Dashboards
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  -- Ordered array of cards: [{ question_id, w }] where w is a 1-2 column span.
  cards       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_dashboards_org ON analytics_dashboards (org_id, updated_at DESC);

-- ------------------------------------------------------------
-- RLS — org isolation. Questions/dashboards are a shared org library
-- (everyone in the org can read them), but only the author or an org admin
-- may change or delete one.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Read-only SQL runner for the "native query" editor.
--
-- SECURITY INVOKER (the default): the function executes as the caller, so RLS
-- on every referenced table is enforced with the caller's identity — the SQL
-- editor cannot read a single row the user couldn't already see. Layered
-- guards make it read-only and bounded:
--   * the statement is wrapped as a subquery, so only a SELECT/WITH…SELECT
--     shape parses at all (an INSERT/UPDATE/DELETE is a syntax error there);
--   * the transaction is forced read-only, so a data-modifying CTE still errors;
--   * a statement timeout and a hard row cap bound cost and payload;
--   * catalog/system schemas are refused to avoid schema trawling.
-- The result is a JSON array of row objects (capped).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics_run_sql(query text, max_rows integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE                       -- may SET LOCAL; still cannot write (read-only tx)
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

  -- Drop a single trailing semicolon; forbid any other statement separator so
  -- only one statement can run.
  cleaned := regexp_replace(cleaned, ';\s*$', '');
  IF position(';' IN cleaned) > 0 THEN
    RAISE EXCEPTION 'Only a single statement is allowed';
  END IF;

  -- Must read like a query.
  IF left(lower(cleaned), 6) <> 'select' AND left(lower(cleaned), 4) <> 'with' THEN
    RAISE EXCEPTION 'Only SELECT / WITH queries are allowed';
  END IF;

  -- No poking at the catalogs (schema-qualified or bare pg_* relations).
  IF cleaned ~* '(pg_catalog|information_schema|\mpg_[a-z_]+\M)' THEN
    RAISE EXCEPTION 'Querying system catalogs is not allowed';
  END IF;

  -- Belt and braces: any write attempt (incl. data-modifying CTEs) errors.
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
