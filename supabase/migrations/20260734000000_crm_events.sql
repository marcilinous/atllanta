-- ATLLANTA — CRM events (marketing / partner events) with attendance.
--
-- Events are digital, physical, or partner events. Digital events may be run for
-- everyone or scoped to a region or a district. Each event moves planned →
-- executed, and records which partners attended (with their details); the count
-- is derived from the attendee rows. Org-scoped + RLS like the crm_* family.

create table if not exists public.crm_events (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  title             text not null,
  event_type        text not null check (event_type in ('digital','physical','partner')),
  scope_type        text check (scope_type in ('all','region','district')),
  scope_value       text,
  venue             text,
  event_date        date,
  status            text not null default 'planned' check (status in ('planned','executed')),
  expected_partners integer,
  description       text,
  outcome           text,
  host_id           uuid,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.crm_event_attendees (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  event_id       uuid not null references public.crm_events(id) on delete cascade,
  partner_id     uuid references public.crm_partner_details(id) on delete set null,
  partner_name   text,
  contact_person text,
  phone          text,
  remarks        text,
  created_by     uuid,
  created_at     timestamptz not null default now()
);

create index if not exists crm_events_org_status_idx   on public.crm_events (org_id, status);
create index if not exists crm_events_org_date_idx      on public.crm_events (org_id, event_date);
create index if not exists crm_event_attendees_event_idx on public.crm_event_attendees (event_id);
create index if not exists crm_event_attendees_org_idx   on public.crm_event_attendees (org_id);
create index if not exists crm_event_attendees_partner_idx on public.crm_event_attendees (org_id, partner_id);

alter table public.crm_events enable row level security;
alter table public.crm_event_attendees enable row level security;

-- Events: org members read + create + edit; managers+ delete.
create policy crm_events_select on public.crm_events
  for select using (org_id in (select auth_user_org_ids()));
create policy crm_events_insert on public.crm_events
  for insert with check (org_id in (select auth_user_org_ids()));
create policy crm_events_update on public.crm_events
  for update using (org_id in (select auth_user_org_ids()))
  with check (org_id in (select auth_user_org_ids()));
create policy crm_events_delete on public.crm_events
  for delete using (org_id in (select auth_user_org_ids()) and crm_user_is_manager_plus());

-- Attendees: org members full CRUD (BDEs record attendance).
create policy crm_event_attendees_select on public.crm_event_attendees
  for select using (org_id in (select auth_user_org_ids()));
create policy crm_event_attendees_insert on public.crm_event_attendees
  for insert with check (org_id in (select auth_user_org_ids()));
create policy crm_event_attendees_update on public.crm_event_attendees
  for update using (org_id in (select auth_user_org_ids()))
  with check (org_id in (select auth_user_org_ids()));
create policy crm_event_attendees_delete on public.crm_event_attendees
  for delete using (org_id in (select auth_user_org_ids()));
