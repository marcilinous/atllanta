-- Add hiring_manager_id to jobs so HR can assign a manager per job posting
-- The hiring manager is the one who schedules interviews and their Google OAuth
-- tokens are used for creating Meet events.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'hiring_manager_id') THEN
    ALTER TABLE jobs ADD COLUMN hiring_manager_id UUID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_hiring_manager ON jobs(hiring_manager_id);
