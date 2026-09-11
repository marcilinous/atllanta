-- ATLLANTA — consolidate field activity into two canonical tables.
--
-- The "Support" report import mixes three record shapes: physical visits (have a
-- Visit Status / Visited Date / GPS), telecaller calls (have a Call Status /
-- Called Date / Allocated Employee), and a few activity notes. Split the visits
-- into crm_visits and the calls into crm_calls so each activity has a single home;
-- analytics then read these two tables (via crm_field_facts). Rows are tagged with
-- source_row_id (the crm_report_rows id) so re-runs and re-imports never duplicate,
-- and the whole backfill can be removed by deleting source='support-import'.
--
-- Caveat: call dates in the source carry no year ("28 May 03:05PM"); visits do
-- ("Aug 3 2026 5:13PM"). Visits span Apr-Aug 2026, so calls are backfilled with an
-- assumed year of 2026.

alter table crm_visits add column if not exists source_row_id uuid;
alter table crm_calls  add column if not exists source_row_id uuid;
-- Standard unique index (multiple NULLs are permitted) so ON CONFLICT can target it.
create unique index if not exists crm_visits_source_row_id_uk on crm_visits (source_row_id);
create unique index if not exists crm_calls_source_row_id_uk  on crm_calls  (source_row_id);

-- ---- Visits ----
insert into crm_visits (
  org_id, account_id, site_id, firm_name, visited_by_name, visited_at,
  visit_status, call_outcome, remarks, lat, lng, location_text, tally_serial,
  source, source_row_id
)
select
  i.org_id,
  rr.account_id,
  nullif(rr.data->>'Partner Site ID',''),
  nullif(rr.data->>'Firm Name',''),
  nullif(trim(rr.data->>'Visited By'),''),
  coalesce(
    case when rr.data->>'Visited Date' ~ '^[A-Z][a-z]{2} [0-9]{1,2} [0-9]{4} '
         then to_timestamp(rr.data->>'Visited Date','Mon FMDD YYYY FMHH12:MIAM') end,
    i.created_at),
  case trim(rr.data->>'Visit Status')
    when 'Met Owner'              then 'Met owner'
    when 'Met Resource'           then 'Met resource'
    when 'Not able to meet Owner' then 'Not able to meet'
    when 'Shop Closed'            then 'Shop closed'
    when 'Business Closed'        then 'Business closed'
    else nullif(trim(rr.data->>'Visit Status'),'') end,
  nullif(trim(rr.data->>'Primary Call Outcome'),''),
  nullif(rr.data->>'Remarks',''),
  case when rr.data->>'Location' ~ '^-?[0-9.]+, ?-?[0-9.]+$' then split_part(rr.data->>'Location',',',1)::numeric end,
  case when rr.data->>'Location' ~ '^-?[0-9.]+, ?-?[0-9.]+$' then trim(split_part(rr.data->>'Location',',',2))::numeric end,
  nullif(rr.data->>'Address',''),
  nullif(rr.data->>'Tally Serial No.',''),
  'support-import',
  rr.id
from crm_report_rows rr
join crm_report_imports i on i.id = rr.import_id
where i.report_type ilike 'Support'
  and coalesce(nullif(trim(rr.data->>'Visit Status'),''),'') <> ''
on conflict (source_row_id) do nothing;

-- ---- Calls (telecaller) ----
insert into crm_calls (
  org_id, account_id, site_id, firm_name, called_by_name, telecaller_name,
  called_at, call_status, outcome, secondary_outcome, remarks, follow_up_date,
  source, source_row_id
)
select
  i.org_id,
  rr.account_id,
  nullif(rr.data->>'Partner Site ID',''),
  coalesce(nullif(rr.data->>'Partner Name',''), nullif(rr.data->>'Company Name','')),
  nullif(trim(rr.data->>'Allocated Employee'),''),
  nullif(trim(rr.data->>'Allocated Employee'),''),
  coalesce(
    case when rr.data->>'Called Date' ~ '^[0-9]{1,2} [A-Z][a-z]{2} '
         then to_timestamp(rr.data->>'Called Date' || ' 2026','DD Mon HH12:MIAM YYYY') end,
    i.created_at),
  nullif(trim(rr.data->>'Call Status'),''),
  nullif(trim(rr.data->>'Primary Call Outcome'),''),
  nullif(trim(rr.data->>'Secondary Call Outcome'),''),
  nullif(rr.data->>'Remarks',''),
  case when rr.data->>'Reminder Date' ~ '^[0-9]{1,2} [A-Z][a-z]{2} '
       then to_date(split_part(rr.data->>'Reminder Date',' ',1)||' '||split_part(rr.data->>'Reminder Date',' ',2)||' 2026','DD Mon YYYY') end,
  'support-import',
  rr.id
from crm_report_rows rr
join crm_report_imports i on i.id = rr.import_id
where i.report_type ilike 'Support'
  and rr.data ? 'Call Status'
on conflict (source_row_id) do nothing;

-- ---- Repoint the analytics MV onto the two canonical tables ----
drop materialized view if exists crm_field_facts cascade;

create materialized view crm_field_facts as
select v.id as row_id, v.org_id, v.account_id, a.owner_id,
       true as is_visit,
       case v.visit_status
         when 'Met owner' then 'Met owner' when 'Met resource' then 'Met resource'
         when 'Not able to meet' then 'Not able to meet' when 'Shop closed' then 'Shop closed'
         when 'Business closed' then 'Business closed' else null end as visit_stage,
       null::text as call_outcome,
       v.visited_by_name,
       v.visited_at::date as activity_date
from crm_visits v
left join crm_accounts a on a.id = v.account_id
union all
select c.id as row_id, c.org_id, c.account_id, a.owner_id,
       false as is_visit,
       null::text as visit_stage,
       c.outcome as call_outcome,
       c.telecaller_name as visited_by_name,
       c.called_at::date as activity_date
from crm_calls c
left join crm_accounts a on a.id = c.account_id;

create unique index crm_field_facts_pk on crm_field_facts (row_id);
create index crm_field_facts_org_date on crm_field_facts (org_id, activity_date);
create index crm_field_facts_owner on crm_field_facts (owner_id);

create or replace function public.crm_refresh_field_facts()
 returns void language plpgsql security definer set search_path to 'public'
as $function$ begin refresh materialized view concurrently crm_field_facts; end $function$;
revoke execute on function public.crm_refresh_field_facts() from anon, authenticated;
