ALTER TABLE crm_visits ADD COLUMN IF NOT EXISTS tally_serial text;
ALTER TABLE crm_visits ADD COLUMN IF NOT EXISTS tally_serial_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_visits_tally_serial_status_chk'
  ) THEN
    ALTER TABLE crm_visits
      ADD CONSTRAINT crm_visits_tally_serial_status_chk
      CHECK (tally_serial_status IS NULL OR tally_serial_status IN ('shared', 'not_shared', 'no_licence'));
  END IF;
END $$;