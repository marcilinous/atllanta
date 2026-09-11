-- ATLLANTA — Sales analytics performance fix.
--
-- The Sales tab fires four heavy RPCs in parallel (crm_sales_by, crm_sales_series,
-- crm_partner_trend x2). Each re-parsed ~32k Sales report rows from jsonb and
-- disk-sorted the wide `data` column on every call (~4-7s each). Under the
-- authenticated role's 8s statement_timeout, the wider windows and the partner
-- trend RPC timed out over PostgREST, surfacing as "Couldn't load sales" and
-- UAP/Transacting reading 0.
--
-- Fix: pre-extract the typed columns once into a materialized view, then have the
-- three RPCs aggregate narrow, indexed columns. Same RLS gate (org + owner_id),
-- same category/channel/dim logic, same outputs — just fast. Refresh the MV after
-- each Sales import via crm_refresh_sales_facts().

drop materialized view if exists crm_sales_facts cascade;

create materialized view crm_sales_facts as
select
  rr.id                                as row_id,
  i.org_id,
  rr.account_id,
  a.owner_id,
  a.region,
  a.tier,
  a.district_new,
  a.hub,
  case when rr.data->>'billing party type' = 'Tally Distribution Partner'
       then 'RTcompu' else 'Online' end as channel,
  case when rr.data->>'activation type' = 'TSS' then 'TSS'
       when rr.data->>'activation type' = 'New' then 'TP'
       when rr.data->>'vas service type' = 'TPCloud'  and rr.data->>'vas service transaction type' = 'New' then 'TPCA'
       when rr.data->>'vas service type' = 'WhatsApp' and rr.data->>'vas service transaction type' = 'New' then 'WABA'
       else 'Other' end                 as category,
  rr.data->>'activation type'          as activation_type,
  case when left(rr.data->>'activation date',10) ~ '^\d{4}-\d{2}-\d{2}$'
       then left(rr.data->>'activation date',10)::date end as activation_date,
  coalesce(nullif(rr.data->>'sum of activation value','')::numeric, 0) as revenue,
  coalesce(nullif(rr.data->>'count','')::numeric, 0)                    as sales_count
from crm_report_rows rr
join crm_report_imports i on i.id = rr.import_id
left join crm_accounts a on a.id = rr.account_id
where i.report_type ilike 'Sales';

create unique index crm_sales_facts_pk on crm_sales_facts (row_id);
create index crm_sales_facts_org_date on crm_sales_facts (org_id, activation_date);
create index crm_sales_facts_owner on crm_sales_facts (owner_id);
create index crm_sales_facts_account on crm_sales_facts (account_id);

-- Refresh helper — call after a Sales import. CONCURRENTLY keeps reads live
-- (needs the unique index above).
create or replace function public.crm_refresh_sales_facts()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  refresh materialized view concurrently crm_sales_facts;
end $function$;

-- Refresh is not for arbitrary end users; keep it to the service role / import path.
revoke execute on function public.crm_refresh_sales_facts() from anon, authenticated;

-- ---- Rewire the three RPCs onto the MV (same signatures, outputs, RLS gate) ----

create or replace function public.crm_sales_by(p_dim text, p_from text default ''::text, p_to text default ''::text)
 returns table(bucket text, channel text, category text, sales_count numeric, revenue numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare col text;
begin
  col := case p_dim
    when 'region'   then 'region'
    when 'role'     then 'tier'
    when 'district' then 'district_new'
    when 'hub'      then 'hub'
    else 'region' end;
  return query execute format($q$
    select coalesce(nullif(trim(f.%I),''),'(none)') as bucket,
           f.channel,
           f.category,
           sum(f.sales_count) as sales_count,
           sum(f.revenue)     as revenue
    from crm_sales_facts f
    where f.org_id in (select auth_user_org_ids())
      and (crm_user_is_org_admin() or f.owner_id = auth.uid() or f.owner_id in (select crm_report_ids()))
      and ($1 = '' or (f.activation_date is not null and f.activation_date >= $1::date))
      and ($2 = '' or (f.activation_date is not null and f.activation_date <= $2::date))
    group by 1,2,3
  $q$, col) using p_from, p_to;
end $function$;

create or replace function public.crm_sales_series(p_from text default ''::text, p_to text default ''::text, p_grain text default 'month'::text)
 returns table(period text, category text, revenue numeric, sales_count numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    case lower(p_grain)
      when 'day'  then to_char(f.activation_date, 'YYYY-MM-DD')
      when 'week' then to_char(date_trunc('week', f.activation_date), 'YYYY-MM-DD')
      else             to_char(date_trunc('month', f.activation_date), 'YYYY-MM')
    end as period,
    f.category,
    sum(f.revenue)      as revenue,
    sum(f.sales_count)  as sales_count
  from crm_sales_facts f
  where f.org_id in (select auth_user_org_ids())
    and (crm_user_is_org_admin() or f.owner_id = auth.uid() or f.owner_id in (select crm_report_ids()))
    and f.activation_date is not null
    and ($1 = '' or f.activation_date >= $1::date)
    and ($2 = '' or f.activation_date <= $2::date)
  group by 1, 2;
$function$;

create or replace function public.crm_partner_trend(p_from text default ''::text, p_to text default ''::text, p_grain text default 'month'::text)
 returns table(period text, uap bigint, transacting bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with base as (
    select f.account_id, f.activation_type, f.activation_date as adate
    from crm_sales_facts f
    where f.org_id in (select auth_user_org_ids())
      and (crm_user_is_org_admin() or f.owner_id = auth.uid() or f.owner_id in (select crm_report_ids()))
      and f.account_id is not null
      and f.activation_date is not null
  ),
  first_tp as (
    select account_id, min(adate) as d from base where activation_type = 'New' group by account_id
  ),
  grain as (select lower(p_grain) as g),
  uap_p as (
    select
      case (select g from grain)
        when 'day'  then to_char(d, 'YYYY-MM-DD')
        when 'week' then to_char(date_trunc('week', d), 'YYYY-MM-DD')
        when 'all'  then 'all'
        else             to_char(date_trunc('month', d), 'YYYY-MM')
      end as period,
      count(*)::bigint as uap
    from first_tp
    where ($1 = '' or d >= $1::date) and ($2 = '' or d <= $2::date)
    group by 1
  ),
  tx_p as (
    select
      case (select g from grain)
        when 'day'  then to_char(adate, 'YYYY-MM-DD')
        when 'week' then to_char(date_trunc('week', adate), 'YYYY-MM-DD')
        when 'all'  then 'all'
        else             to_char(date_trunc('month', adate), 'YYYY-MM')
      end as period,
      count(distinct account_id)::bigint as transacting
    from base
    where ($1 = '' or adate >= $1::date) and ($2 = '' or adate <= $2::date)
    group by 1
  )
  select coalesce(u.period, t.period) as period,
         coalesce(u.uap, 0)          as uap,
         coalesce(t.transacting, 0)  as transacting
  from uap_p u
  full join tx_p t on u.period = t.period;
$function$;

refresh materialized view crm_sales_facts;
