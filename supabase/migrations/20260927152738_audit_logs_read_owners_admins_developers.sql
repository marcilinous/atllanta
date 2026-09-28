-- v1.4.1: only owners, admins and developers may read the audit log
-- (owner decision 2026-09-27, TRANSITION.md Decisions & Blockers).
--
-- Before this, audit_select let every member of an organisation read its
-- whole audit trail — through the API directly, and through the analytics
-- SQL path, which runs as the caller (SECURITY INVOKER). The only screen that
-- reads audit_logs (public/views/audit/log.js) was already admin-only, so no
-- screen loses anything; managers and members lose API access they had no
-- screen for.
--
-- Writes are untouched: audit_logs still has no INSERT/UPDATE/DELETE policy,
-- rows are written by log_audit() (security definer) and by the new stack's
-- withTransaction audit() as the owning role.
--
-- An exited user reads nothing, even if their role row still says admin.

create or replace function public.can_read_audit_log()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'developer')
      and coalesce(u.status, 'active') <> 'exited'
  );
$function$;

revoke all on function public.can_read_audit_log() from public, anon;
grant execute on function public.can_read_audit_log() to authenticated;

drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs
  for select using (org_id in (select auth_user_org_ids()) and can_read_audit_log());
