-- jobs and candidates gate only on client_id, but the generic (org-mode)
-- recruitment product writes org_id (client_id null), so org-scoped inserts
-- fail RLS. job_applications already has an org_id fallback; add the same
-- org path to jobs and candidates. Access is still limited to the user's own
-- organizations (auth_user_org_ids) — no cross-org access is granted.

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