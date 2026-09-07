-- ATLLANTA — Phase 1a: Unify tenancy on a single org_id (additive, non-destructive)
--
-- Goal: make users.org_id the single canonical tenant key and unhook RLS from the
-- memberships table, WITHOUT dropping clients/memberships or changing any app code.
-- Everything here is additive and idempotent. No table or column is dropped.
-- The destructive cutover (drop clients/memberships, rewrite create-org.js, read
-- org/role from users) is Phase 1b, done after this is verified live.
--
-- Verified against the live `atllanta` DB before writing (read-only):
--   - all users rows have org_id + a canonical role (owner/admin/manager/member)
--   - 0 membership↔user org mismatches, 0 multi-org users
--   - jobs/candidates/job_applications/interview_slots org already backfilled
--   - no org has >1 non-self client, so collapsing the agency tier leaks nothing
-- The backfills below are therefore defensive no-ops on this DB, but make the
-- migration correct on any DB where those columns are not yet populated.

-- ============================================================
-- 1. Canonical tenant-key helpers
-- ============================================================

-- The single source of truth: the caller's one org.
create or replace function auth_org_id()
returns uuid
language sql
security definer
stable
as $$
  select org_id from users where id = auth.uid()
$$;

-- Re-point the existing HR/People helper at users.org_id instead of memberships.
-- Keeps the ~100 existing "org_id IN (SELECT auth_user_org_ids())" policies working
-- verbatim, while removing their dependency on the memberships table. Returns the
-- caller's single org as a one-row set.
create or replace function auth_user_org_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select org_id from users where id = auth.uid()
$$;

-- ============================================================
-- 2. Defensive backfill of org_id on recruitment tables
--    (already 0-null on the live DB; guarded so re-running is safe)
-- ============================================================
update jobs j
  set org_id = c.organization_id
  from clients c
  where j.org_id is null and j.client_id = c.id;

update candidates cd
  set org_id = c.organization_id
  from clients c
  where cd.org_id is null and cd.client_id = c.id;

update job_applications ja
  set org_id = j.org_id
  from jobs j
  where ja.org_id is null and ja.job_id = j.id;

update interview_slots s
  set organization_id = j.org_id
  from jobs j
  where s.organization_id is null and s.job_id = j.id;

-- ============================================================
-- 3. Add org_id-based RLS alongside the existing client_id policies
--    (permissive policies are OR'd, so this only GRANTS the org path;
--     nothing that worked before stops working)
-- ============================================================

-- jobs: had only jobs_access (client_id). Add the org path.
drop policy if exists "jobs_org" on jobs;
create policy "jobs_org" on jobs
  for all using (org_id = auth_org_id()) with check (org_id = auth_org_id());

-- candidates: had only candidates_access (client_id). Add the org path.
drop policy if exists "candidates_org" on candidates;
create policy "candidates_org" on candidates
  for all using (org_id = auth_org_id()) with check (org_id = auth_org_id());

-- interview_slots: scoped by organization_id column.
drop policy if exists "interview_slots_org" on interview_slots;
create policy "interview_slots_org" on interview_slots
  for all using (organization_id = auth_org_id()) with check (organization_id = auth_org_id());

-- job_applications already dual-paths (client_id OR org_id) via schema_alignment.
-- interviews already org-scoped. organizations/credit_ledger read policies via
-- memberships still work (memberships not dropped yet); Phase 1b replaces them.

-- ============================================================
-- 4. Indexes for the org path on recruitment tables
-- ============================================================
create index if not exists idx_jobs_org on jobs(org_id);
create index if not exists idx_candidates_org on candidates(org_id);
create index if not exists idx_job_applications_org on job_applications(org_id);
create index if not exists idx_interview_slots_org on interview_slots(organization_id);
