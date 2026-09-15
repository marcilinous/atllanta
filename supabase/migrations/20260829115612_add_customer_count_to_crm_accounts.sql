ALTER TABLE crm_accounts ADD COLUMN IF NOT EXISTS customer_count INTEGER;
ALTER TABLE crm_accounts ADD COLUMN IF NOT EXISTS customer_base_active_3y BOOLEAN;
COMMENT ON COLUMN crm_accounts.customer_count IS 'Loaded from Customer Base report (Total column), import 9795e58f-3530-451b-a6ea-00c14c58708f, 2026-08-29';