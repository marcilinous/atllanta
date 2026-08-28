-- ============================================================================
-- HEADLINE NUMBERS — one row, the whole picture
--
-- Pace compares CFY-to-date against the SAME PERIOD last year, not against
-- last year's full total. Comparing to a full year makes every partner look
-- behind and the number becomes meaningless.
--
-- Update the two 'same period' cut-off dates when newer CFY data is imported.
-- CFY data currently ends 2026-08-03.
-- ============================================================================

with sales as (
  select
    r.site_id,
    i.period_label                                            as fy,
    (r.data->>'activation date')::date                        as dt,
    r.data->>'activation type'                                as activation_type,
    coalesce(nullif(r.data->>'license qty', ''), '0')::numeric as qty,
    coalesce(nullif(r.data->>'sum of activation value', ''), '0')::numeric as val
  from crm_report_rows r
  join crm_report_imports i on i.id = r.import_id
  where r.report_type = 'Sales'
    and r.site_id is not null
),

partner as (
  select
    site_id,
    sum(qty) filter (where fy = 'FY2025-26' and activation_type = 'New')                            as lfy_new,
    sum(val) filter (where fy = 'FY2025-26')                                                        as lfy_val,
    sum(qty) filter (where fy = 'FY2025-26' and activation_type = 'New' and dt < '2025-08-04')      as lfy_new_same_period,
    sum(qty) filter (where fy = 'FY2026-27' and activation_type = 'New')                            as cfy_new,
    sum(val) filter (where fy = 'FY2026-27')                                                        as cfy_val
  from sales
  group by site_id
)

select
  count(*)                                                             as partners_transacting,
  count(*) filter (where lfy_new > 0)                                  as bought_new_lfy,
  count(*) filter (where cfy_new > 0)                                  as uap_this_fy,

  sum(lfy_new_same_period)                                             as licences_lfy_same_period,
  sum(cfy_new)                                                         as licences_cfy_to_date,
  round(100.0 * sum(cfy_new) / nullif(sum(lfy_new_same_period), 0) - 100, 1) as pace_pct,

  count(*) filter (where lfy_new > 0 and coalesce(cfy_new, 0) = 0)      as lapsed_partners,
  sum(lfy_new) filter (where lfy_new > 0 and coalesce(cfy_new, 0) = 0)  as lapsed_licences,

  count(*) filter (where lfy_new > 0 and coalesce(cfy_new, 0) = 0 and coalesce(cfy_val, 0) > 0)     as warm_lapsed_partners,
  sum(lfy_new) filter (where lfy_new > 0 and coalesce(cfy_new, 0) = 0 and coalesce(cfy_val, 0) > 0) as warm_lapsed_licences
from partner;
