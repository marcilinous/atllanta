-- Whole-row de-duplication for report imports.
--
-- Re-uploading a file that was already imported must not create duplicate rows.
-- We identify a duplicate by the full content of the row's `data` payload,
-- hashed the same way on both sides (Postgres `md5(data::text)`), scoped to the
-- org. A stored generated column + index makes the "does this row already
-- exist?" check cheap, and the RPC below inserts only the rows that are new.

alter table crm_report_rows
  add column if not exists content_hash text
  generated always as (md5(data::text)) stored;

create index if not exists crm_report_rows_org_hash_idx
  on crm_report_rows (org_id, content_hash);

-- Insert a batch of report rows for an import, skipping any whose whole-row
-- content already exists for the org. Returns how many were inserted and how
-- many were skipped as duplicates. Runs as the caller (security invoker) so the
-- same anon + RLS rules as a direct insert apply — no service_role.
create or replace function crm_insert_report_rows(p_import_id uuid, p_rows jsonb)
returns table (inserted integer, skipped integer)
language plpgsql
security invoker
as $$
declare
  v_org   uuid;
  v_type  text;
  v_total integer := coalesce(jsonb_array_length(p_rows), 0);
begin
  select org_id, report_type into v_org, v_type
  from crm_report_imports
  where id = p_import_id;

  if v_org is null then
    raise exception 'crm_insert_report_rows: import % not found', p_import_id;
  end if;

  with incoming as (
    select
      nullif(e ->> 'site_id', '')                    as site_id,
      nullif(e ->> 'account_id', '')::uuid           as account_id,
      nullif(e ->> 'person_name', '')                as person_name,
      nullif(e ->> 'person_user_id', '')::uuid       as person_user_id,
      (e -> 'data')                                  as data,
      md5((e -> 'data')::text)                        as hsh
    from jsonb_array_elements(p_rows) e
  ),
  ins as (
    insert into crm_report_rows
      (org_id, import_id, report_type, site_id, account_id, person_name, person_user_id, data)
    select v_org, p_import_id, v_type, i.site_id, i.account_id, i.person_name, i.person_user_id, i.data
    from incoming i
    where not exists (
      select 1 from crm_report_rows r
      where r.org_id = v_org and r.content_hash = i.hsh
    )
    returning 1
  )
  select count(*)::integer into inserted from ins;

  skipped := v_total - inserted;
  return next;
end;
$$;
