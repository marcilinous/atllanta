-- ATLLANTA — materialize RTcompu's BDE field activity for the Sales snapshot.
--
-- The field log lives in the "Support" report import (~50k rows): rows with a
-- Visit Status are physical visits; the rest are calls / follow-ups (carrying a
-- Primary Call Outcome). Pre-extract typed columns once so the visit-outcome
-- pyramid, the BDE-visit trend, and the call-outcome breakdown are fast and stay
-- under the authenticated role's 8s statement_timeout. Refresh after a Support
-- import via crm_refresh_field_facts().

drop materialized view if exists crm_field_facts cascade;

create materialized view crm_field_facts as
select
  rr.id                                as row_id,
  i.org_id,
  rr.account_id,
  a.owner_id,
  coalesce(nullif(trim(rr.data->>'Visit Status'),''), '') <> '' as is_visit,
  case trim(rr.data->>'Visit Status')
    when 'Met Owner'              then 'Met owner'
    when 'Met Resource'           then 'Met resource'
    when 'Not able to meet Owner' then 'Not able to meet'
    when 'Shop Closed'            then 'Shop closed'
    when 'Business Closed'        then 'Business closed'
    else null
  end                                  as visit_stage,
  nullif(trim(rr.data->>'Primary Call Outcome'),'') as call_outcome,
  nullif(trim(rr.data->>'Visited By'),'')           as visited_by_name,
  case when rr.data->>'Visited Date' ~ '^[A-Z][a-z]{2} [0-9]{1,2} [0-9]{4} '
       then to_timestamp(rr.data->>'Visited Date', 'Mon FMDD YYYY FMHH12:MIAM')::date end as activity_date
from crm_report_rows rr
join crm_report_imports i on i.id = rr.import_id
left join crm_accounts a on a.id = rr.account_id
where i.report_type ilike 'Support';

create unique index crm_field_facts_pk on crm_field_facts (row_id);
create index crm_field_facts_org_date on crm_field_facts (org_id, activity_date);
create index crm_field_facts_owner on crm_field_facts (owner_id);

create or replace function public.crm_refresh_field_facts()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  refresh materialized view concurrently crm_field_facts;
end $function$;
revoke execute on function public.crm_refresh_field_facts() from anon, authenticated;

-- Per-period BDE visit counts (physical visits only) for the trend chart.
create or replace function public.crm_visit_series(p_from text default ''::text, p_to text default ''::text, p_grain text default 'month'::text)
 returns table(period text, visits bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    case lower(p_grain)
      when 'day'  then to_char(f.activity_date, 'YYYY-MM-DD')
      when 'week' then to_char(date_trunc('week', f.activity_date), 'YYYY-MM-DD')
      else             to_char(date_trunc('month', f.activity_date), 'YYYY-MM')
    end as period,
    count(*)::bigint as visits
  from crm_field_facts f
  where f.org_id in (select auth_user_org_ids())
    and (crm_user_is_org_admin() or f.owner_id = auth.uid() or f.owner_id in (select crm_report_ids()))
    and f.is_visit
    and f.activity_date is not null
    and ($1 = '' or f.activity_date >= $1::date)
    and ($2 = '' or f.activity_date <= $2::date)
  group by 1;
$function$;

-- Visit-outcome tally (the five stages) for the pyramid.
create or replace function public.crm_visit_outcomes(p_from text default ''::text, p_to text default ''::text)
 returns table(stage text, cnt bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select f.visit_stage as stage, count(*)::bigint as cnt
  from crm_field_facts f
  where f.org_id in (select auth_user_org_ids())
    and (crm_user_is_org_admin() or f.owner_id = auth.uid() or f.owner_id in (select crm_report_ids()))
    and f.is_visit
    and f.visit_stage is not null
    and ($1 = '' or (f.activity_date is not null and f.activity_date >= $1::date))
    and ($2 = '' or (f.activity_date is not null and f.activity_date <= $2::date))
  group by 1;
$function$;

-- Call / follow-up outcome tally for the calls breakdown.
create or replace function public.crm_call_outcomes(p_from text default ''::text, p_to text default ''::text)
 returns table(outcome text, cnt bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select f.call_outcome as outcome, count(*)::bigint as cnt
  from crm_field_facts f
  where f.org_id in (select auth_user_org_ids())
    and (crm_user_is_org_admin() or f.owner_id = auth.uid() or f.owner_id in (select crm_report_ids()))
    and not f.is_visit
    and f.call_outcome is not null
    and ($1 = '' or (f.activity_date is not null and f.activity_date >= $1::date))
    and ($2 = '' or (f.activity_date is not null and f.activity_date <= $2::date))
  group by 1;
$function$;

refresh materialized view crm_field_facts;
