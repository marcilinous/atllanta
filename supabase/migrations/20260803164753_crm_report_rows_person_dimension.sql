-- Second join dimension for reports: person (BDE/TL/CM/Telecaller) by name.
ALTER TABLE crm_report_rows
  ADD COLUMN IF NOT EXISTS person_name text,
  ADD COLUMN IF NOT EXISTS person_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE crm_report_imports
  ADD COLUMN IF NOT EXISTS person_column text;

CREATE INDEX IF NOT EXISTS idx_crm_report_rows_person_user ON crm_report_rows (org_id, person_user_id);
CREATE INDEX IF NOT EXISTS idx_crm_report_rows_person_name ON crm_report_rows (org_id, person_name);