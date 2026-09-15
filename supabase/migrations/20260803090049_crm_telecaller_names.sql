-- RECONSTRUCTION MIGRATION -- not part of the database's recorded history.
--
-- crm_telecaller_names() was created in production outside the migration
-- system, so no recorded migration creates it. 20260811153118_security_hardening
-- then revokes execute on it, which means a replay onto a fresh database fails
-- there with "function public.crm_telecaller_names() does not exist".
--
-- This file reconstructs the function from production's live definition so the
-- history can rebuild the database. Verified: with this migration in place all
-- 107 apply cleanly to an empty database, and the resulting schema contains
-- every object production has.
--
-- Position matters. It must come after 20260803090048 adds crm_accounts
-- .telecaller (an earlier slot fails with "column a.telecaller does not exist")
-- and before 20260811153118 revokes on it.
--
-- See CLAUDE.md section 13, "Migration history", for the rule covering these.

create or replace function public.crm_telecaller_names()
 returns table(telecaller text, partners integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select a.telecaller, count(*)::int
  from crm_accounts a
  where a.org_id in (select auth_user_org_ids())
    and a.telecaller is not null and a.telecaller <> ''
    and exists (select 1 from users u where u.id = auth.uid() and u.role in ('owner','admin','manager'))
  group by a.telecaller order by a.telecaller;
$function$;
