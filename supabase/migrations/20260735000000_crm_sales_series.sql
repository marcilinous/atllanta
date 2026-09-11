-- ATLLANTA — monthly sales time-series for the Sales analytics tab.
--
-- crm_sales_by aggregates by a dimension (region/tier/district/hub); the Sales
-- snapshot also needs revenue/units over TIME for a trend chart across a from/to
-- range. crm_sales_series returns per-month × category totals, same RLS gate and
-- empty-string-safe numeric casts as crm_sales_by.

create or replace function public.crm_sales_series(p_from text default ''::text, p_to text default ''::text)
 returns table(month text, category text, revenue numeric, sales_count numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select to_char(date_trunc('month', left(rr.data->>'activation date',10)::date), 'YYYY-MM') as month,
    case when rr.data->>'activation type'='TSS' then 'TSS'
         when rr.data->>'activation type'='New' then 'TP'
         when rr.data->>'vas service type'='TPCloud'  and rr.data->>'vas service transaction type'='New' then 'TPCA'
         when rr.data->>'vas service type'='WhatsApp' and rr.data->>'vas service transaction type'='New' then 'WABA'
         else 'Other' end as category,
    sum(coalesce(nullif(rr.data->>'sum of activation value','')::numeric, 0)) as revenue,
    sum(coalesce(nullif(rr.data->>'count','')::numeric, 0)) as sales_count
  from crm_report_rows rr
  join crm_report_imports i on i.id = rr.import_id
  left join crm_accounts a on a.id = rr.account_id
  where i.org_id in (select auth_user_org_ids())
    and i.report_type ilike 'Sales'
    and (crm_user_is_org_admin() or a.owner_id = auth.uid() or a.owner_id in (select crm_report_ids()))
    and left(rr.data->>'activation date',10) ~ '^\d{4}-\d{2}-\d{2}$'
    and ($1 = '' or left(rr.data->>'activation date',10) >= $1)
    and ($2 = '' or left(rr.data->>'activation date',10) <= $2)
  group by 1, 2;
$function$;
