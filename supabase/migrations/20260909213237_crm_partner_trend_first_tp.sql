create or replace function public.crm_partner_trend(p_from text default ''::text, p_to text default ''::text, p_grain text default 'month'::text)
 returns table(period text, uap bigint, transacting bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with base as (
    select rr.account_id,
           rr.data->>'activation type' as atype,
           left(rr.data->>'activation date',10)::date as adate
    from crm_report_rows rr
    join crm_report_imports i on i.id = rr.import_id
    left join crm_accounts a on a.id = rr.account_id
    where i.org_id in (select auth_user_org_ids())
      and i.report_type ilike 'Sales'
      and (crm_user_is_org_admin() or a.owner_id = auth.uid() or a.owner_id in (select crm_report_ids()))
      and rr.account_id is not null
      and left(rr.data->>'activation date',10) ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  first_tp as (
    select account_id, min(adate) as d from base where atype = 'New' group by account_id
  ),
  uap_p as (
    select case lower(p_grain)
             when 'day'  then to_char(d, 'YYYY-MM-DD')
             when 'week' then to_char(date_trunc('week', d), 'YYYY-MM-DD')
             when 'all'  then 'all'
             else             to_char(date_trunc('month', d), 'YYYY-MM') end as period,
           count(*)::bigint as uap
    from first_tp
    where ($1 = '' or d >= $1::date) and ($2 = '' or d <= $2::date)
    group by 1
  ),
  tx_p as (
    select case lower(p_grain)
             when 'day'  then to_char(adate, 'YYYY-MM-DD')
             when 'week' then to_char(date_trunc('week', adate), 'YYYY-MM-DD')
             when 'all'  then 'all'
             else             to_char(date_trunc('month', adate), 'YYYY-MM') end as period,
           count(distinct account_id)::bigint as transacting
    from base
    where ($1 = '' or adate >= $1::date) and ($2 = '' or adate <= $2::date)
    group by 1
  )
  select coalesce(u.period, t.period) as period,
         coalesce(u.uap, 0) as uap,
         coalesce(t.transacting, 0) as transacting
  from uap_p u
  full join tx_p t on u.period = t.period;
$function$;