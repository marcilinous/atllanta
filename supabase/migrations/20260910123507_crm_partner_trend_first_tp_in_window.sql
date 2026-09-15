-- ATLLANTA — UAP is a partner whose FIRST TP falls within the selected window.
-- Scope "first TP" to the window (not lifetime): any partner with >=1 TP in the
-- range counts once, bucketed by the month of their first TP in that range. Extra
-- TPs later don't add. Transacting = distinct partners with any sale in the range.
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
      and ($1 = '' or f.activation_date >= $1::date)
      and ($2 = '' or f.activation_date <= $2::date)
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
    from first_tp group by 1
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
    from base group by 1
  )
  select coalesce(u.period, t.period) as period,
         coalesce(u.uap, 0)          as uap,
         coalesce(t.transacting, 0)  as transacting
  from uap_p u
  full join tx_p t on u.period = t.period;
$function$;

notify pgrst, 'reload schema';