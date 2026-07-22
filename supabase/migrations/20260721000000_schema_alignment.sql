-- ATLLANTA — Schema Alignment Migration
-- Aligns old foundation tables with CLAUDE.md target schema
-- Renames: applications → job_applications, stage → status, name → full_name
-- Adds missing columns to jobs, candidates, memberships

-- ============================================================
-- 1. RENAME applications → job_applications
-- ============================================================
ALTER TABLE IF EXISTS applications RENAME TO job_applications;

-- Rename stage → status on job_applications
ALTER TABLE job_applications RENAME COLUMN stage TO status;

-- Update the check constraint for new values
ALTER TABLE job_applications DROP CONSTRAINT IF EXISTS applications_stage_check;
ALTER TABLE job_applications ADD CONSTRAINT job_applications_status_check
  CHECK (status IN ('applied', 'screening', 'shortlisted', 'interview_scheduled',
                    'interviewed', 'offered', 'hired', 'rejected',
                    'new', 'screened'));

-- Rename old indexes
DROP INDEX IF EXISTS idx_applications_job;
DROP INDEX IF EXISTS idx_applications_candidate;
CREATE INDEX IF NOT EXISTS idx_job_applications_job ON job_applications(job_id, status);
CREATE INDEX IF NOT EXISTS idx_job_applications_score ON job_applications(job_id, match_score DESC);
CREATE INDEX IF NOT EXISTS idx_job_applications_candidate ON job_applications(candidate_id);

-- Update RLS policy to reference new table name
DROP POLICY IF EXISTS "applications_access" ON job_applications;
CREATE POLICY "job_applications_access" ON job_applications
  FOR ALL USING (
    job_id IN (SELECT id FROM jobs WHERE client_id IN (SELECT auth_accessible_client_ids()))
    OR job_id IN (SELECT id FROM jobs WHERE org_id IN (SELECT auth_user_org_ids()))
  );

-- ============================================================
-- 2. ADD full_name TO candidates (copy from name)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'candidates' AND column_name = 'full_name') THEN
    ALTER TABLE candidates ADD COLUMN full_name TEXT;
    UPDATE candidates SET full_name = name WHERE full_name IS NULL;
  END IF;
END $$;

-- Add org_id to candidates
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'candidates' AND column_name = 'org_id') THEN
    ALTER TABLE candidates ADD COLUMN org_id UUID REFERENCES organizations(id);
    UPDATE candidates SET org_id = (SELECT c.organization_id FROM clients c WHERE c.id = candidates.client_id)
      WHERE org_id IS NULL AND client_id IS NOT NULL;
  END IF;
END $$;

-- Add resume_text alias column (old schema uses resume_raw_text)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'candidates' AND column_name = 'resume_text') THEN
    ALTER TABLE candidates ADD COLUMN resume_text TEXT;
    UPDATE candidates SET resume_text = resume_raw_text WHERE resume_text IS NULL AND resume_raw_text IS NOT NULL;
  END IF;
END $$;

-- Add parsed_skills to candidates
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'candidates' AND column_name = 'parsed_skills') THEN
    ALTER TABLE candidates ADD COLUMN parsed_skills JSONB;
  END IF;
END $$;

-- Add resume_url to candidates (alias for resume_file_url)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'candidates' AND column_name = 'resume_url') THEN
    ALTER TABLE candidates ADD COLUMN resume_url TEXT;
    UPDATE candidates SET resume_url = resume_file_url WHERE resume_url IS NULL AND resume_file_url IS NOT NULL;
  END IF;
END $$;

-- ============================================================
-- 3. ADD MISSING COLUMNS TO jobs
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'parsed_skills') THEN
    ALTER TABLE jobs ADD COLUMN parsed_skills JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'experience_min') THEN
    ALTER TABLE jobs ADD COLUMN experience_min INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'experience_max') THEN
    ALTER TABLE jobs ADD COLUMN experience_max INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'location') THEN
    ALTER TABLE jobs ADD COLUMN location TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'employment_type') THEN
    ALTER TABLE jobs ADD COLUMN employment_type TEXT DEFAULT 'full_time'
      CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'salary_min') THEN
    ALTER TABLE jobs ADD COLUMN salary_min INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'salary_max') THEN
    ALTER TABLE jobs ADD COLUMN salary_max INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'department_id') THEN
    ALTER TABLE jobs ADD COLUMN department_id UUID REFERENCES departments(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'created_by') THEN
    ALTER TABLE jobs ADD COLUMN created_by UUID;
  END IF;
END $$;

-- Expand jobs status constraint to include CLAUDE.md values
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('draft', 'open', 'on_hold', 'closed', 'paused'));

-- ============================================================
-- 4. ADD COLUMNS TO job_applications FOR CLAUDE.md COMPAT
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'job_applications' AND column_name = 'match_method') THEN
    ALTER TABLE job_applications ADD COLUMN match_method TEXT DEFAULT 'tfidf'
      CHECK (match_method IN ('tfidf', 'llm', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'job_applications' AND column_name = 'match_breakdown') THEN
    ALTER TABLE job_applications ADD COLUMN match_breakdown JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'job_applications' AND column_name = 'shortlisted_at') THEN
    ALTER TABLE job_applications ADD COLUMN shortlisted_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'job_applications' AND column_name = 'shortlisted_by') THEN
    ALTER TABLE job_applications ADD COLUMN shortlisted_by UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'job_applications' AND column_name = 'rejection_reason') THEN
    ALTER TABLE job_applications ADD COLUMN rejection_reason TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'job_applications' AND column_name = 'notes') THEN
    ALTER TABLE job_applications ADD COLUMN notes TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'job_applications' AND column_name = 'org_id') THEN
    ALTER TABLE job_applications ADD COLUMN org_id UUID REFERENCES organizations(id);
  END IF;
END $$;

-- ============================================================
-- 5. ADD full_name AND email TO memberships
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memberships' AND column_name = 'full_name') THEN
    ALTER TABLE memberships ADD COLUMN full_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memberships' AND column_name = 'email') THEN
    ALTER TABLE memberships ADD COLUMN email TEXT;
  END IF;
END $$;

-- ============================================================
-- 6. ADD slug AND OTHER COLUMNS TO organizations
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'slug') THEN
    ALTER TABLE organizations ADD COLUMN slug TEXT UNIQUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'logo_url') THEN
    ALTER TABLE organizations ADD COLUMN logo_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'timezone') THEN
    ALTER TABLE organizations ADD COLUMN timezone TEXT DEFAULT 'Asia/Kolkata';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'currency') THEN
    ALTER TABLE organizations ADD COLUMN currency TEXT DEFAULT 'INR';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'date_format') THEN
    ALTER TABLE organizations ADD COLUMN date_format TEXT DEFAULT 'DD/MM/YYYY';
  END IF;
END $$;

-- ============================================================
-- 7. EXPAND memberships ROLE CONSTRAINT
-- ============================================================
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'member',
                  'super_admin', 'agency_admin', 'client_admin', 'client_member'));

-- Allow full CRUD on memberships for org members
CREATE POLICY IF NOT EXISTS "memberships_org_select" ON memberships
  FOR SELECT USING (organization_id IN (SELECT auth_user_org_ids()));
CREATE POLICY IF NOT EXISTS "memberships_org_insert" ON memberships
  FOR INSERT WITH CHECK (organization_id IN (SELECT auth_user_org_ids()));
CREATE POLICY IF NOT EXISTS "memberships_org_update" ON memberships
  FOR UPDATE USING (organization_id IN (SELECT auth_user_org_ids()));
CREATE POLICY IF NOT EXISTS "memberships_org_delete" ON memberships
  FOR DELETE USING (organization_id IN (SELECT auth_user_org_ids()));

-- ============================================================
-- 8. ADD INTERVIEWS TABLE (CLAUDE.md schema)
-- ============================================================
CREATE TABLE IF NOT EXISTS interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  job_application_id UUID NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  round_number INTEGER DEFAULT 1,
  round_name TEXT,
  interviewer_id UUID,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  location TEXT,
  meeting_link TEXT,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled')),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  feedback TEXT,
  decision TEXT CHECK (decision IN ('advance', 'reject', 'hold', 'hire')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "interviews_select" ON interviews
  FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY IF NOT EXISTS "interviews_insert" ON interviews
  FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY IF NOT EXISTS "interviews_update" ON interviews
  FOR UPDATE USING (org_id IN (SELECT auth_user_org_ids()));

CREATE INDEX IF NOT EXISTS idx_interviews_application ON interviews(job_application_id);
CREATE INDEX IF NOT EXISTS idx_interviews_interviewer ON interviews(interviewer_id, scheduled_at);
