-- ============================================================
-- ANALYTICS — scheduled reports & threshold alerts.
--
-- analytics_alerts stores, per saved question, either a schedule (email the
-- creator the result daily/weekly/monthly) or a threshold alert (email when a
-- metric crosses a value). The daily cron (api/event-processor) evaluates the
-- due ones.
--
-- Running a report on a schedule must reflect ONLY what its creator may see. A
-- cron has no session, so it mints a short-lived JWT for the creator (signed
-- with the project JWT secret, server-side only) and runs the query through the
-- existing analytics_run_sql RPC — which is SECURITY INVOKER, so the creator's
-- RLS applies exactly as in the app. No service_role-bypasses-RLS path, and no
-- impersonation function that could be abused.
-- ============================================================

CREATE TABLE IF NOT EXISTS analytics_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question_id  UUID NOT NULL REFERENCES analytics_questions(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('schedule', 'alert')),
  schedule     TEXT NOT NULL DEFAULT 'daily' CHECK (schedule IN ('daily', 'weekly', 'monthly')),
  -- threshold-alert config (kind='alert')
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
