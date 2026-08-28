-- ============================================================================
-- REACTIVATION LIST — warm lapsed partners
--
-- Partners who bought new Tally licences last financial year, are STILL
-- transacting with us this year (TSS, rental, VAS), but have not bought a
-- single new licence in FY2026-27.
--
-- These are proven buyers with a live relationship. Every one is a UAP
-- waiting to happen, and the financial year ends 31 March.
--
-- Run in the Supabase SQL editor, then Download CSV.
-- ============================================================================

with sales as (
  select
    r.site_id,
    i.period_label                                             as fy,
    (r.data->>'activation date')::date                         as dt,
    r.data->>'activation type'                                 as activation_type,
    coalesce(nullif(r.data->>'license qty', ''), '0')::numeric  as qty,
    coalesce(nullif(r.data->>'sum of activation value', ''), '0')::numeric as val
  from crm_report_rows r
  join crm_report_imports i on i.id = r.import_id
  where r.report_type = 'Sales'
    and r.site_id is not null
),

visits as (
  select
    site_id,
    count(*)                        as visit_count,
    max(data->>'Visited Date')      as last_visit,
    max(data->>'Visited By')        as last_visited_by
  from crm_report_rows
  where report_type = 'Support'
    and data ? 'Visited Date'
    and site_id is not null
  group by site_id
),

partner as (
  select
    site_id,
    sum(qty) filter (where fy = 'FY2025-26' and activation_type = 'New')  as lfy_new_licences,
    round(sum(val) filter (where fy = 'FY2025-26'))                       as lfy_total_value,
    max(dt)  filter (where fy = 'FY2025-26' and activation_type = 'New')  as lfy_last_new,
    sum(qty) filter (where fy = 'FY2026-27' and activation_type = 'New')  as cfy_new_licences,
    round(sum(val) filter (where fy = 'FY2026-27'))                       as cfy_total_value,
    max(dt)  filter (where fy = 'FY2026-27')                              as cfy_last_txn
  from sales
  group by site_id
)

select
  p.site_id                                    as "Site ID",
  a.name                                       as "Partner",
  a.hub                                        as "Hub",
  a.district                                   as "District",
  a.state                                      as "State",
  a.telecaller                                 as "Telecaller",
  p.lfy_new_licences                           as "Licences LFY",
  p.lfy_total_value                            as "Value LFY",
  p.lfy_last_new                               as "Last new licence",
  p.cfy_total_value                            as "Still transacting CFY",
  p.cfy_last_txn                               as "Last txn CFY",
  coalesce(v.visit_count, 0)                   as "Visits",
  v.last_visit                                 as "Last visit",
  v.last_visited_by                            as "Visited by"
from partner p
left join crm_accounts a on a.external_id = p.site_id
left join visits      v on v.site_id      = p.site_id
where p.lfy_new_licences > 0            -- proven buyer last year
  and coalesce(p.cfy_new_licences, 0) = 0  -- no new licence this year
  and coalesce(p.cfy_total_value, 0) > 0   -- but still transacting = warm
order by p.lfy_new_licences desc, p.lfy_total_value desc;

-- Variant: the 203 who have never been visited.
-- Add to the WHERE clause:   and coalesce(v.visit_count, 0) = 0
