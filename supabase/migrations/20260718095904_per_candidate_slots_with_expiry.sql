-- Per-candidate slots + 24hr link expiry

-- Add expiry timestamp to applications
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS schedule_expires_at timestamptz;

-- Add application_id to interview_slots so slots are per-candidate
ALTER TABLE interview_slots
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES applications(id) ON DELETE CASCADE;

-- Make job_id nullable (slots are now per-application, job derived from app)
ALTER TABLE interview_slots
  ALTER COLUMN job_id DROP NOT NULL;
