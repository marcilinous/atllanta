-- Tally serial number captured on a field visit.
--
-- The BDE reads the partner's Tally serial off the licence at the shop. When
-- the partner won't share it, or hasn't bought a licence at all, the reason is
-- recorded instead of a blank, so "no serial" always carries its why.
--   status = 'shared'      -> tally_serial holds the digits
--   status = 'not_shared'  -> partner declined to share it
--   status = 'no_licence'  -> partner has not purchased a licence
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
