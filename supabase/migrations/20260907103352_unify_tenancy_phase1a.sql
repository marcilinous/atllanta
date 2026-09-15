-- Phase 1a: Unify tenancy on a single org_id (additive, non-destructive)

create or replace function auth_org_id()
returns uuid language sql security definer stable
as $$ select org_id from users where id = auth.uid() $$;

create or replace function auth_user_org_ids()
returns setof uuid language sql security definer stable
as $$ select org_id from users where id = auth.uid() $$;

update jobs j set org_id = c.organization_id from clients c
  where j.org_id is null and j.client_id = c.id;
update candidates cd set org_id = c.organization_id from clients c
  where cd.org_id is null and cd.client_id = c.id;
update job_applications ja set org_id = j.org_id from jobs j
  where ja.org_id is null and ja.job_id = j.id;
update interview_slots s set organization_id = j.org_id from jobs j
  where s.organization_id is null and s.job_id = j.id;

drop policy if exists "jobs_org" on jobs;
create policy "jobs_org" on jobs
  for all using (org_id = auth_org_id()) with check (org_id = auth_org_id());

drop policy if exists "candidates_org" on candidates;
create policy "candidates_org" on candidates
  for all using (org_id = auth_org_id()) with check (org_id = auth_org_id());

drop policy if exists "interview_slots_org" on interview_slots;
create policy "interview_slots_org" on interview_slots
  for all using (organization_id = auth_org_id()) with check (organization_id = auth_org_id());

create index if not exists idx_jobs_org on jobs(org_id);
create index if not exists idx_candidates_org on candidates(org_id);
create index if not exists idx_job_applications_org on job_applications(org_id);
create index if not exists idx_interview_slots_org on interview_slots(organization_id);