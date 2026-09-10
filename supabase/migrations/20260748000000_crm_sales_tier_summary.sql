-- ATLLANTA — Sales summary by partner tier (AP / Star AP / NA) for a window.
-- Revenue, TP units, TSS units, total units, transacting partners, and UAP
-- (per-FY first TP, same rule as crm_partner_trend). Reads the fast MV.
create or replace function public.crm_sales_tier_summary(p_from text default ''::text, p_to text default ''::text)
 returns table(tier text, revenue numeric, tp_units numeric, tss_units numeric, units numeric, transacting bigint, uap bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with base as (
    select f.account_id,
      coalesce(nullif(trim(f.tier),''),'NA') as tier,
      f.category, f.activation_type, f.revenue, f.sales_count, f.activation_date as adate,
      (case when extract(month from f.activation_date) >= 4
            then extract(year from f.activation_date)
            else extract(year from f.activation_date) - 1 end)::int as fy
    from crm_sales_facts f
    where f.org_id in (select auth_user_org_ids())
      and (crm_user_is_org_admin() or f.owner_id = auth.uid() or f.owner_id in (select crm_report_ids()))
      and f.account_id is not null and f.activation_date is not null
  ),
  win as (
    select * from base where ($1 = '' or adate >= $1::date) and ($2 = '' or adate <= $2::date)
  ),
  agg as (
    select tier,
      sum(revenue) as revenue,
      sum(sales_count) filter (where category = 'TP')  as tp_units,
      sum(sales_count) filter (where category = 'TSS') as tss_units,
      sum(sales_count) as units,
      count(distinct account_id)::bigint as transacting
    from win group by tier
  ),
  first_tp as (
    select account_id, fy, min(adate) as d, min(tier) as tier
    from base where activation_type = 'New' group by account_id, fy
  ),
  uap_t as (
    select tier, count(*)::bigint as uap
    from first_tp where ($1 = '' or d >= $1::date) and ($2 = '' or d <= $2::date) group by tier
  )
  select coalesce(a.tier, u.tier) as tier,
    coalesce(a.revenue, 0), coalesce(a.tp_units, 0), coalesce(a.tss_units, 0), coalesce(a.units, 0),
    coalesce(a.transacting, 0), coalesce(u.uap, 0)
  from agg a full join uap_t u on u.tier = a.tier
  order by 2 desc;
$function$;
