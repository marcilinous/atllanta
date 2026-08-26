-- Fix generic (org-scoped) recruitment, which was broken because jobs/candidates
-- still assumed the RT client-only model.
--
-- Symptom: a super_admin (and any user) in org-mode got "new row violates
-- row-level security policy" / not-null errors when using recruitment.
--
-- Root causes & fixes:
--   1. jobs/candidates RLS gated only on client_id; the generic product scopes
--      by org_id. Add the org_id path (as job_applications already has), still
--      limited to the user's own organizations — no cross-org access.
--   2. jobs.client_id / candidates.client_id were NOT NULL (RT leftover), so
--      org-mode inserts (org_id only) failed. Make them nullable; RT rows still
--      set client_id and are unaffected.
--   3. Existing jobs were client-keyed with org_id NULL, so org-mode reads never
--      saw them. Backfill org_id from each job's client org.
--   4. candidates.name is a legacy duplicate of full_name (the app writes
--      full_name and reads full_name || name) but was NOT NULL, blocking UI
--      candidate creation. Make it nullable.

-- 1. org_id access path -------------------------------------------------------
DROP POLICY IF EXISTS jobs_access ON public.jobs;
CREATE POLICY jobs_access ON public.jobs
  FOR ALL
  USING (
    (client_id IN (SELECT auth_accessible_client_ids()))
    OR (org_id IN (SELECT auth_user_org_ids()))
  )
  WITH CHECK (
    (client_id IN (SELECT auth_accessible_client_ids()))
    OR (org_id IN (SELECT auth_user_org_ids()))
  );

DROP POLICY IF EXISTS candidates_access ON public.candidates;
CREATE POLICY candidates_access ON public.candidates
  FOR ALL
  USING (
    (client_id IN (SELECT auth_accessible_client_ids()))
    OR (org_id IN (SELECT auth_user_org_ids()))
  )
  WITH CHECK (
    (client_id IN (SELECT auth_accessible_client_ids()))
    OR (org_id IN (SELECT auth_user_org_ids()))
  );

-- 2. client_id nullable for the generic org model -----------------------------
ALTER TABLE public.jobs        ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.candidates  ALTER COLUMN client_id DROP NOT NULL;

-- 3. backfill org_id on existing client-keyed jobs ----------------------------
UPDATE public.jobs j
   SET org_id = c.organization_id
  FROM public.clients c
 WHERE j.client_id = c.id
   AND j.org_id IS NULL;

-- 4. candidates.name nullable (legacy duplicate of full_name) -----------------
ALTER TABLE public.candidates ALTER COLUMN name DROP NOT NULL;
