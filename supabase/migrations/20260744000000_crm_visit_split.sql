-- ATLLANTA — registered vs unregistered visit split for the Sales snapshot.
--
-- Carry crm_visits.partner_type into crm_field_facts so the Sales tab can show how
-- many field visits were to onboarded partners vs new/unregistered prospects.

drop materialized view if exists crm_field_facts cascade;

create materialized view crm_field_facts as
select v.id as row_id, v.org_id, v.account_id, a.owner_id,
       true as is_visit,
       case v.visit_status
         when 'Met owner' then 'Met owner' when 'Met resource' then 'Met resource'
         when 'Not able to meet' then 'Not able to meet' when 'Shop closed' then 'Shop closed'
         when 'Business closed' then 'Business closed' else null end as visit_stage,
       coalesce(v.partner_type, 'registered') as partner_type,
       null::text as call_outcome,
       v.visited_by_name,
       v.visited_at::date as activity_date
from crm_visits v
left join crm_accounts a on a.id = v.account_id
union all
select c.id as row_id, c.org_id, c.account_id, a.owner_id,
       false as is_visit,
       null::text as visit_stage,
       null::text as partner_type,
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

-- Visits split by partner type (registered onboarded partner vs unregistered prospect).
create or replace function public.crm_visit_split(p_from text default ''::text, p_to text default ''::text)
 returns table(partner_type text, cnt bigint)
 language sql stable security definer set search_path to 'public'
as $function$
  select f.partner_type, count(*)::bigint as cnt
  from crm_field_facts f
  where f.org_id in (select auth_user_org_ids())
    and (crm_user_is_org_admin() or f.owner_id = auth.uid() or f.owner_id in (select crm_report_ids()))
    and f.is_visit
    and ($1 = '' or (f.activity_date is not null and f.activity_date >= $1::date))
    and ($2 = '' or (f.activity_date is not null and f.activity_date <= $2::date))
  group by 1;
$function$;
