-- Two-level CRM productisation:
--   crm_enabled          -> generic CRM (Accounts/Contacts/Leads/Pipeline) — all orgs
--   partner_crm_enabled  -> RT partner vertical pack (Visits/Telecalling/Coverage/
--                           Sales/Targets/Opportunities/Site-ID reports) — per org
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS partner_crm_enabled boolean NOT NULL DEFAULT false;
UPDATE organizations SET crm_enabled = true;                                   -- generic CRM for everyone
UPDATE organizations SET partner_crm_enabled = (id = 'e8845b88-b73d-4af1-8cce-3ca7a4b3cf6b');
