-- ============================================================
-- CRM ACCOUNTS — customer base size
-- ============================================================
-- The "Customer Base" report (report_type 'Other') carries, per Site ID, how
-- many end customers a partner serves and whether any of them transacted in
-- the last three years. Both are partner attributes rather than events, so
-- they are flattened onto crm_accounts instead of being read from the raw
-- rows on every query.
--
-- Loaded once from the import with the documented pattern:
--   UPDATE crm_accounts a
--   SET customer_count = (r.data->>'Total')::int
--   FROM crm_report_rows r
--   WHERE r.import_id = '<import>' AND r.account_id = a.id;
--
-- NOTE: the report has no rupee figure — only a head count. Anything that
-- needs a value must go through crm_customer_value_per_head() (see the
-- opportunity-engine migration), which is the single place that turns a
-- customer count into money.
-- ============================================================

ALTER TABLE crm_accounts ADD COLUMN IF NOT EXISTS customer_count integer;
ALTER TABLE crm_accounts ADD COLUMN IF NOT EXISTS customer_base_active_3y boolean;

CREATE INDEX IF NOT EXISTS idx_crm_accounts_customer_count
  ON crm_accounts (org_id, customer_count DESC)
  WHERE customer_count IS NOT NULL;
