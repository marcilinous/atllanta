-- Platform-level gate: the CRM (Tally partner) suite is proprietary to
-- organizations it's explicitly enabled for. New orgs default to off; enable
-- all existing orgs so none loses access now.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS crm_enabled boolean NOT NULL DEFAULT false;
UPDATE organizations SET crm_enabled = true WHERE crm_enabled = false;