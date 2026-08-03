-- ============================================================
-- CRM REPORT STAGING — PERSON DIMENSION
-- ============================================================
-- Some reports key on a staff member (BDE/TL/CM/Telecaller) rather than
-- (or in addition to) a partner Site ID — e.g. visits and telecalling.
-- Add a person link alongside the existing account link so those reports
-- roll up the CM -> TL -> BDE / Telecaller hierarchy.
-- ============================================================

ALTER TABLE crm_report_rows
  ADD COLUMN IF NOT EXISTS person_name text,
  ADD COLUMN IF NOT EXISTS person_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE crm_report_imports
  ADD COLUMN IF NOT EXISTS person_column text;

CREATE INDEX IF NOT EXISTS idx_crm_report_rows_person_user ON crm_report_rows (org_id, person_user_id);
CREATE INDEX IF NOT EXISTS idx_crm_report_rows_person_name ON crm_report_rows (org_id, person_name);
