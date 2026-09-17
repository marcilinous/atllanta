-- Site ID (external_id) is the key that Tally reports map to.
-- Enforce one-to-one per org, and index for fast lookups on report import.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_accounts_org_external_id
  ON crm_accounts (org_id, external_id)
  WHERE external_id IS NOT NULL AND external_id <> '';