-- Tag each import with the fiscal year it represents (Apr–Mar), so every
-- year's data is retained side by side and a daily upload only supersedes
-- the same report of the same fiscal year.
ALTER TABLE crm_report_imports ADD COLUMN IF NOT EXISTS period_label text;

-- Backfill activation (Sales) reports from their own max activation date.
UPDATE crm_report_imports i SET period_label = sub.fy
FROM (
  SELECT i2.id,
    'FY' || (CASE WHEN mx_m >= 4 THEN mx_y ELSE mx_y - 1 END)
         || '-' || right(((CASE WHEN mx_m >= 4 THEN mx_y ELSE mx_y - 1 END) + 1)::text, 2) AS fy
  FROM crm_report_imports i2
  CROSS JOIN LATERAL (
    SELECT max(left(rr.data->>'activation date',10)) AS mx
    FROM crm_report_rows rr WHERE rr.import_id = i2.id
  ) m
  CROSS JOIN LATERAL (SELECT left(m.mx,4)::int AS mx_y, substr(m.mx,6,2)::int AS mx_m) yv
  WHERE i2.report_type ILIKE 'Sales' AND m.mx ~ '^\d{4}-\d{2}-\d{2}$'
) sub
WHERE i.id = sub.id;

SELECT name, report_type, period_label, row_count FROM crm_report_imports
WHERE org_id='e8845b88-b73d-4af1-8cce-3ca7a4b3cf6b' AND report_type ILIKE 'Sales';