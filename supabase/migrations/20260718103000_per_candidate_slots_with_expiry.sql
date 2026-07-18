-- Per-candidate slots + 24hr link expiry

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS schedule_expires_at timestamptz;

ALTER TABLE interview_slots
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES applications(id) ON DELETE CASCADE;

ALTER TABLE interview_slots
  ALTER COLUMN job_id DROP NOT NULL;
