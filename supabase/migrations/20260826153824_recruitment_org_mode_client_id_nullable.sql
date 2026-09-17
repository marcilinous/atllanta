-- Generic (org-scoped) recruitment writes org_id and no client_id, but
-- client_id was NOT NULL — a leftover from the RT client-only model — which
-- blocked org-mode job/candidate creation. Make it nullable. RT rows always
-- set client_id, so they are unaffected.
ALTER TABLE public.jobs        ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.candidates  ALTER COLUMN client_id DROP NOT NULL;

-- Existing jobs were client-keyed with org_id NULL, so org-mode reads (which
-- filter by org_id) never saw them. Backfill org_id from each job's client org
-- for data consistency and visibility.
UPDATE public.jobs j
   SET org_id = c.organization_id
  FROM public.clients c
 WHERE j.client_id = c.id
   AND j.org_id IS NULL;