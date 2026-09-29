-- The `documents` storage bucket (found missing 2026-09-29 while building the
-- new-stack leave screens). Every legacy upload targets it — leave documents
-- (views/leave/apply.js), expense receipts (views/finance/index.js) and
-- employee documents (views/employees/profile.js) — so all three have been
-- failing in production, and RTcompu staff cannot apply for Sick leave, which
-- requires a document. Only attendance-selfies and visit-selfies exist.
--
-- Private bucket, 10 MB per file, no type restriction (the legacy screens set
-- none). Access follows the paths the legacy screens already write:
--   leave-docs/{org_id}/{user_id}/…  — the person uploads their own; read by
--       them and by whoever can see their leave (admins, managers over their
--       department, their reporting line).
--   expenses/{org_id}/…              — members upload receipts; read by the
--       uploader and by approvers (owner/admin/manager).
--   employees/{user_id}/…            — managed by owner/admin/manager for
--       people they can see; read by those people too (self included).
-- A path segment that is not a uuid matches nothing (storage_path_uuid).

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 10485760)
on conflict (id) do nothing;

create or replace function public.storage_path_uuid(p_segment text)
returns uuid
language plpgsql
immutable
set search_path to 'public'
as $function$
begin
  return nullif(p_segment, '')::uuid;
exception when others then
  return null;
end;
$function$;

-- leave-docs/{org}/{user}/… ---------------------------------------------------

create policy documents_leave_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents' and split_part(name, '/', 1) = 'leave-docs'
    and public.storage_path_uuid(split_part(name, '/', 2)) = auth_org_id()
    and public.storage_path_uuid(split_part(name, '/', 3)) = auth.uid()
  );

create policy documents_leave_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents' and split_part(name, '/', 1) = 'leave-docs'
    and public.storage_path_uuid(split_part(name, '/', 2)) = auth_org_id()
    and (
      public.storage_path_uuid(split_part(name, '/', 3)) = auth.uid()
      or public.storage_path_uuid(split_part(name, '/', 3)) in (select hr_visible_user_ids())
      or public.storage_path_uuid(split_part(name, '/', 3)) in (select user_report_ids())
    )
  );

create policy documents_leave_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents' and split_part(name, '/', 1) = 'leave-docs'
    and public.storage_path_uuid(split_part(name, '/', 2)) = auth_org_id()
    and (public.storage_path_uuid(split_part(name, '/', 3)) = auth.uid() or is_org_admin())
  );

-- expenses/{org}/… -------------------------------------------------------------

create policy documents_expenses_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents' and split_part(name, '/', 1) = 'expenses'
    and public.storage_path_uuid(split_part(name, '/', 2)) = auth_org_id()
  );

create policy documents_expenses_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents' and split_part(name, '/', 1) = 'expenses'
    and public.storage_path_uuid(split_part(name, '/', 2)) = auth_org_id()
    and (owner = auth.uid() or hr_can_approve())
  );

create policy documents_expenses_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents' and split_part(name, '/', 1) = 'expenses'
    and public.storage_path_uuid(split_part(name, '/', 2)) = auth_org_id()
    and (owner = auth.uid() or is_org_admin())
  );

-- employees/{user}/… -----------------------------------------------------------

create policy documents_employees_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents' and split_part(name, '/', 1) = 'employees'
    and hr_can_approve()
    and public.storage_path_uuid(split_part(name, '/', 2)) in (select hr_visible_user_ids())
  );

create policy documents_employees_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents' and split_part(name, '/', 1) = 'employees'
    and public.storage_path_uuid(split_part(name, '/', 2)) in (select hr_visible_user_ids())
  );

create policy documents_employees_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents' and split_part(name, '/', 1) = 'employees'
    and hr_can_approve()
    and public.storage_path_uuid(split_part(name, '/', 2)) in (select hr_visible_user_ids())
  );
