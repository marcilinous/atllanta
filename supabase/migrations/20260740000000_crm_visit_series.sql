-- ATLLANTA — per-period BDE visit counts for the Sales snapshot.
--
-- Buckets crm_visits by day/week/month so the Sales trend can compare BDE visits
-- against transacting partners (comparable magnitudes, unlike UAP). Same visibility
-- gate as the crm_visits SELECT policy: org + admin/own/report-tree on visited_by.

create or replace function public.crm_visit_series(p_from text default ''::text, p_to text default ''::text, p_grain text default 'month'::text)
 returns table(period text, visits bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    case lower(p_grain)
      when 'day'  then to_char(v.visited_at, 'YYYY-MM-DD')
      when 'week' then to_char(date_trunc('week', v.visited_at), 'YYYY-MM-DD')
      else             to_char(date_trunc('month', v.visited_at), 'YYYY-MM')
    end as period,
    count(*)::bigint as visits
  from crm_visits v
  where v.org_id in (select auth_user_org_ids())
    and (crm_user_is_org_admin() or v.visited_by = auth.uid() or v.visited_by in (select crm_report_ids()))
    and v.visited_at is not null
    and ($1 = '' or v.visited_at >= $1::date)
    and ($2 = '' or v.visited_at < ($2::date + 1))
  group by 1;
$function$;
