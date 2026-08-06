-- ============================================================
-- CRM PRODUCTISATION — generic baseline + partner vertical pack
-- ============================================================
-- Two levers:
--   crm_enabled          — generic CRM (Accounts/Contacts/Leads/Pipeline),
--                          part of the standard OS, on for every org.
--   partner_crm_enabled  — the RT partner vertical pack (Visits, Telecalling,
--                          Coverage, Sales, Targets, Opportunities-coverage,
--                          Site-ID report imports), enabled per organization.
-- Both are platform gates (not bypassed by an org's own admins).
-- ============================================================
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS partner_crm_enabled boolean NOT NULL DEFAULT false;
UPDATE organizations SET crm_enabled = true;
UPDATE organizations SET partner_crm_enabled = (id = 'e8845b88-b73d-4af1-8cce-3ca7a4b3cf6b');
