ALTER TABLE crm_accounts ADD COLUMN IF NOT EXISTS district_new text;
CREATE INDEX IF NOT EXISTS idx_crm_accounts_district_new ON crm_accounts (org_id, district_new);