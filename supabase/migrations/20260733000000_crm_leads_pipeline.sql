-- ATLLANTA — turn crm_leads into a follow-up pipeline.
--
-- Lead status becomes the pipeline stage the partner reports: hot / warm / cold,
-- or dropped (with a reason). Each lead carries a next follow-up date and a
-- running remarks log so BDEs can track it over successive touches.

alter table crm_leads drop constraint if exists crm_leads_status_check;
alter table crm_leads
  add constraint crm_leads_status_check check (status = any (array['hot','warm','cold','dropped']));
alter table crm_leads alter column status set default 'warm';

alter table crm_leads
  add column if not exists follow_up_date date,
  add column if not exists drop_reason text,
  add column if not exists updates jsonb not null default '[]'::jsonb;

create index if not exists crm_leads_follow_up_idx on crm_leads (org_id, follow_up_date);
