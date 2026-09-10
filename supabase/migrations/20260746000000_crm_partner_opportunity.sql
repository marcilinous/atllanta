-- ATLLANTA — per-partner two-period metrics for the Opportunities workspace.
-- One row per base partner (RLS-scoped by owner) with period-A and period-B
-- aggregates of TP count, TSS count, and total value, plus last activity date.
-- Powers UAP opportunity (no TP in B), Transacting opportunity (A value>0, B=0),
-- and the comparison playground. Reads the fast crm_sales_facts MV.

create or replace function public.crm_partner_opportunity(p_a_from text, p_a_to text, p_b_from text, p_b_to text)
 returns table(
   id uuid, partner_name text, region text, hub text, tier text, owner_id uuid,
   a_tp numeric, a_tss numeric, a_value numeric,
   b_tp numeric, b_tss numeric, b_value numeric,
   last_activity date
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with agg as (
    select f.account_id,
      sum(case when f.activation_date between $1::date and $2::date and f.category='TP'  then f.sales_count else 0 end) as a_tp,
      sum(case when f.activation_date between $1::date and $2::date and f.category='TSS' then f.sales_count else 0 end) as a_tss,
      sum(case when f.activation_date between $1::date and $2::date then f.revenue else 0 end) as a_value,
      sum(case when f.activation_date between $3::date and $4::date and f.category='TP'  then f.sales_count else 0 end) as b_tp,
      sum(case when f.activation_date between $3::date and $4::date and f.category='TSS' then f.sales_count else 0 end) as b_tss,
      sum(case when f.activation_date between $3::date and $4::date then f.revenue else 0 end) as b_value,
      max(f.activation_date) as last_activity
    from crm_sales_facts f
    where f.account_id is not null and f.activation_date is not null
    group by f.account_id
  )
  select p.id, p.partner_name, p.region, p.hub, p.tier, p.owner_id,
    coalesce(a.a_tp,0), coalesce(a.a_tss,0), coalesce(a.a_value,0),
    coalesce(a.b_tp,0), coalesce(a.b_tss,0), coalesce(a.b_value,0),
    a.last_activity
  from crm_partner_details p
  left join agg a on a.account_id = p.id
  where p.org_id in (select auth_user_org_ids())
    and (crm_user_is_org_admin() or p.owner_id = auth.uid() or p.owner_id in (select crm_report_ids()));
$function$;
