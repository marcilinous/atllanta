-- Rewritten as a plain SQL expression so the planner can INLINE it. As
-- plpgsql this was called ~88k times per crm_opportunity_features() run and
-- cost 6.1s on its own; inlined it is a regex plus a cast per row.
-- Deliberately carries no SET search_path: a SET clause blocks inlining, and
-- this function reads no tables and is not SECURITY DEFINER, so it gains no
-- privilege that a search_path could be used to abuse.
-- Regex guards replace the old exception blocks (which also forced plpgsql).
CREATE OR REPLACE FUNCTION crm_report_event_date(txt text)
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    -- ISO '2026-07-10', optionally followed by a time.
    WHEN left(txt, 10) ~ '^\d{4}-\d{2}-\d{2}$'
      THEN left(txt, 10)::date
    -- 'Apr 1 2026 1:03PM' — year present, take it at face value.
    WHEN txt ~ '^[A-Za-z]{3,9} +\d{1,2} +\d{4}'
      THEN to_date(regexp_replace(txt, '^([A-Za-z]{3,9} +\d{1,2} +\d{4}).*$', '\1'),
                   'Mon FMDD YYYY')
    -- '01 Apr 01:16PM' — no year. Resolve to the most recent such date that is
    -- not in the future, which is the only sound reading of a rolling report.
    WHEN txt ~ '^\d{1,2} +[A-Za-z]{3,9}'
      THEN CASE
        WHEN to_date(regexp_replace(txt, '^(\d{1,2} +[A-Za-z]{3,9}).*$', '\1') || ' ' ||
                     EXTRACT(year FROM current_date)::int::text, 'FMDD Mon YYYY') > current_date
        THEN (to_date(regexp_replace(txt, '^(\d{1,2} +[A-Za-z]{3,9}).*$', '\1') || ' ' ||
                     EXTRACT(year FROM current_date)::int::text, 'FMDD Mon YYYY')
              - interval '1 year')::date
        ELSE to_date(regexp_replace(txt, '^(\d{1,2} +[A-Za-z]{3,9}).*$', '\1') || ' ' ||
                     EXTRACT(year FROM current_date)::int::text, 'FMDD Mon YYYY')
      END
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION crm_report_event_date(text) IS
  'Parse the three date formats used across CRM report imports. Year-less dates resolve to the most recent non-future occurrence. Written as inlinable SQL - do not add a SET clause or exception handling, both force per-row function calls.';

GRANT EXECUTE ON FUNCTION crm_report_event_date(text) TO authenticated;