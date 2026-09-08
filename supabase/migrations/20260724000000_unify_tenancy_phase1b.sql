-- ATLLANTA — Phase 1b: collapse the agency tier onto a single org_id. DESTRUCTIVE.
--
-- Prerequisite: Phase 1a already made users.org_id the canonical tenant key
-- (auth_org_id()/auth_user_org_ids() read users), backfilled org_id on the
-- recruitment tables, and added org-based RLS on jobs/candidates/interview_slots.
--
-- This drops the agency layer: clients, memberships, the agency RLS helper, and
-- the create_self_client trigger; drops the now-redundant client_id columns; and
-- re-homes pending invites onto the invitations table (org_id + name/phone).
--
-- KEEPS credits/trials: organizations.* billing columns + credit_ledger stay
-- (org-scoped). Apply only after review — dropping prod tables is irreversible.

begin;

-- 1. Replace the membership/client-based platform policies with org-based ones.
drop policy if exists "organizations_member" on organizations;
create policy "organizations_self" on organizations
  for select using (id = auth_org_id());

drop policy if exists "credit_ledger_member" on credit_ledger;
create policy "credit_ledger_org" on credit_ledger
  for select using (organization_id = auth_org_id());

-- Recruitment: drop the client_id-based policies (org policies from 1a remain).
drop policy if exists "clients_access" on clients;
drop policy if exists "jobs_access" on jobs;
drop policy if exists "candidates_access" on candidates;

-- job_applications: replace the dual client_id/org_id policy with org-only.
drop policy if exists "job_applications_access" on job_applications;
drop policy if exists "job_applications_org" on job_applications;
create policy "job_applications_org" on job_applications
  for all using (org_id = auth_org_id()) with check (org_id = auth_org_id());

-- 2. invitations: canonicalize to org_id, add name/phone, drop client_id, org-scope.
alter table invitations rename column organization_id to org_id;
alter table invitations drop column if exists client_id;
alter table invitations add column if not exists full_name text;
alter table invitations add column if not exists phone text;
alter table invitations alter column role set default 'member';
alter table invitations enable row level security;
drop policy if exists "invitations_org" on invitations;
create policy "invitations_org" on invitations
  for all using (org_id = auth_org_id()) with check (org_id = auth_org_id());

-- 3. Drop the self-client trigger + function.
drop trigger if exists trg_create_self_client on organizations;
drop function if exists create_self_client();

-- 4. Drop the redundant client_id columns (org_id backfilled in 1a).
alter table jobs drop column if exists client_id;
alter table candidates drop column if exists client_id;

-- 5. Drop the agency helper + tables (cascade removes any lingering policies
--    that referenced them).
drop function if exists auth_accessible_client_ids() cascade;
drop table if exists memberships cascade;
drop table if exists clients cascade;

commit;
