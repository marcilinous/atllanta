-- ATLLANTA — Phase -1: Foundation schema
-- Multi-tenant hierarchy: organizations -> clients -> jobs -> candidates

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_type text not null check (org_type in ('direct', 'agency')),
  plan_tier text not null default 'starter'
    check (plan_tier in ('starter', 'growth', 'agency_partner', 'enterprise')),
  payment_status text not null default 'trial'
    check (payment_status in ('trial', 'active', 'past_due', 'cancelled')),
  trial_started_at timestamptz default now(),
  trial_ends_at timestamptz default (now() + interval '14 days'),
  trial_candidate_cap int default 25,
  max_trial_extension_days int default 30,
  credits_included_monthly int default 200,
  credits_balance int default 200,
  credit_overage_mode text default 'soft_bill'
    check (credit_overage_mode in ('soft_bill', 'hard_stop')),
  commission_percent numeric(5,2) default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  referred_by_agency_id uuid references organizations(id),
  name text not null,
  is_self boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  role text not null check (role in (
    'super_admin', 'agency_admin', 'client_admin', 'client_member'
  )),
  created_at timestamptz default now(),
  unique (user_id, organization_id, client_id)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  title text not null,
  description text,
  jd_raw_text text,
  status text default 'open' check (status in ('open', 'paused', 'closed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table candidates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  resume_raw_text text,
  resume_file_url text,
  source text default 'manual',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  match_score numeric(5,2),
  match_summary text,
  match_raw_response jsonb,
  stage text default 'new' check (stage in (
    'new', 'screened', 'shortlisted', 'interview_scheduled',
    'interviewed', 'offered', 'hired', 'rejected'
  )),
  credits_charged int default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (job_id, candidate_id)
);

create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  action_type text not null check (action_type in ('resume_match', 'whatsapp_message', 'topup', 'monthly_reset')),
  credits_delta int not null,
  reference_id uuid,
  created_at timestamptz default now()
);

create index idx_clients_org on clients(organization_id);
create index idx_memberships_user on memberships(user_id);
create index idx_memberships_org on memberships(organization_id);
create index idx_jobs_client on jobs(client_id);
create index idx_candidates_client on candidates(client_id);
create index idx_applications_job on applications(job_id);
create index idx_applications_candidate on applications(candidate_id);
create index idx_credit_ledger_org on credit_ledger(organization_id);

alter table organizations enable row level security;
alter table clients enable row level security;
alter table memberships enable row level security;
alter table jobs enable row level security;
alter table candidates enable row level security;
alter table applications enable row level security;
alter table credit_ledger enable row level security;

create or replace function auth_accessible_client_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select c.id
  from clients c
  join memberships m on m.organization_id = c.organization_id
  where m.user_id = auth.uid()
    and (
      m.client_id = c.id
      or m.role in ('agency_admin', 'super_admin')
    )
$$;

create policy "clients_access" on clients
  for all using (id in (select auth_accessible_client_ids()));

create policy "jobs_access" on jobs
  for all using (client_id in (select auth_accessible_client_ids()));

create policy "candidates_access" on candidates
  for all using (client_id in (select auth_accessible_client_ids()));

create policy "applications_access" on applications
  for all using (
    job_id in (select id from jobs where client_id in (select auth_accessible_client_ids()))
  );

create policy "memberships_self" on memberships
  for select using (user_id = auth.uid());

create policy "organizations_member" on organizations
  for select using (
    id in (select organization_id from memberships where user_id = auth.uid())
  );

create policy "credit_ledger_member" on credit_ledger
  for select using (
    organization_id in (select organization_id from memberships where user_id = auth.uid())
  );

create or replace function create_self_client()
returns trigger
language plpgsql
as $$
begin
  if new.org_type = 'direct' then
    insert into clients (organization_id, name, is_self)
    values (new.id, new.name, true);
  end if;
  return new;
end;
$$;

create trigger trg_create_self_client
  after insert on organizations
  for each row execute function create_self_client();
