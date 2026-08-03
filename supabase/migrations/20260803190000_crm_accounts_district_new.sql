-- ============================================================
-- CRM ACCOUNTS — DISTRICT NEW
-- ============================================================
-- The distribution analysis is done on Region, Role, District New and
-- Hub. The original partner import kept "District" but not "District New"
-- (the current, re-districted name). Add it as a separate indexed column;
-- the original "district" is preserved alongside.
-- Values were backfilled from the mapping keyed on District + City so the
-- district splits (e.g. Bangalore -> Bengaluru / Bangalore (Urban+Rural),
-- Krishna -> Eluru / NTR) resolve correctly.
-- ============================================================

ALTER TABLE crm_accounts ADD COLUMN IF NOT EXISTS district_new text;
CREATE INDEX IF NOT EXISTS idx_crm_accounts_district_new ON crm_accounts (org_id, district_new);
