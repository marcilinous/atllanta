-- ATLLANTA — partner-count trends for the Sales snapshot.
--
--   uap         = unique active partners: distinct partners with >=1 TP (new
--                 license, activation type 'New') in the period.
--   transacting = distinct partners with any sale in the period.
-- Bucketed by day/week/month; p_grain='all' collapses the whole range into one
-- row (distinct-over-range totals for the KPI tiles). Same RLS gate as the other
-- crm sales RPCs.

create or replace function public.crm_partner_trend(p_from text default ''::text, p_to text default ''::text, p_grain text default 'month'::text)
 returns table(period text, uap bigint, transacting bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    case lower(p_grain)
      when 'day'  then to_char(left(rr.data->>'activation date',10)::date, 'YYYY-MM-DD')
      when 'week' then to_char(date_trunc('week', left(rr.data->>'activation date',10)::date), 'YYYY-MM-DD')
      when 'all'  then 'all'
      else             to_char(date_trunc('month', left(rr.data->>'activation date',10)::date), 'YYYY-MM')
    end as period,
    count(distinct rr.account_id) filter (where rr.data->>'activation type' = 'New') as uap,
    count(distinct rr.account_id) as transacting
  from crm_report_rows rr
  join crm_report_imports i on i.id = rr.import_id
  left join crm_accounts a on a.id = rr.account_id
  where i.org_id in (select auth_user_org_ids())
    and i.report_type ilike 'Sales'
    and (crm_user_is_org_admin() or a.owner_id = auth.uid() or a.owner_id in (select crm_report_ids()))
    and rr.account_id is not null
    and left(rr.data->>'activation date',10) ~ '^\d{4}-\d{2}-\d{2}$'
    and ($1 = '' or left(rr.data->>'activation date',10) >= $1)
    and ($2 = '' or left(rr.data->>'activation date',10) <= $2)
  group by 1;
$function$;
