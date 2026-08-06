-- ============================================================
-- ORG CRM GATE — CRM suite is proprietary, enabled per organization
-- ============================================================
-- The CRM (Tally partner) suite is the operator's custom build, not part of
-- the generic OS every organization gets. This gates it at the platform level
-- (not bypassed by an org's own admins): only orgs with crm_enabled = true see
-- it. New orgs default to off; all existing orgs are enabled so none loses it.
-- ============================================================
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS crm_enabled boolean NOT NULL DEFAULT false;
UPDATE organizations SET crm_enabled = true WHERE crm_enabled = false;
