-- ATLLANTA — UAP is per financial year: a partner is a UAP in each FY where they
-- take a TP, counted once at their FIRST TP of that FY. So the same partner can be
-- UAP in FY25-26 and again in FY26-27. First-TP is scoped per (partner, FY) over
-- all data; the window then filters/buckets those first-TP-of-FY events.
-- Transacting = distinct partners with any sale in the window.
-- RTcompu FY starts in April (month >= 4).
create or replace function public.crm_partner_trend(p_from text default ''::text, p_to text default ''::text, p_grain text default 'month'::text)
 returns table(period text, uap bigint, transacting bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with base as (
    select f.account_id, f.activation_type, f.activation_date as adate,
      (case when extract(month from f.activation_date) >= 4
            then extract(year from f.activation_date)
            else extract(year from f.activation_date) - 1 end)::int as fy
    from crm_sales_facts f
    where f.org_id in (select auth_user_org_ids())
      and (crm_user_is_org_admin() or f.owner_id = auth.uid() or f.owner_id in (select crm_report_ids()))
      and f.account_id is not null
      and f.activation_date is not null
  ),
  first_tp as (   -- earliest TP per partner within each FY
    select account_id, fy, min(adate) as d
    from base where activation_type = 'New'
    group by account_id, fy
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
