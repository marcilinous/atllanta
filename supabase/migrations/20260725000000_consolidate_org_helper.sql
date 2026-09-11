-- ATLLANTA — consolidate org-resolution onto a single source of truth.
--
-- After Phase 1b there are two org helpers with identical bodies:
--   auth_org_id()        returns uuid        (recruitment + platform policies)
--   auth_user_org_ids()  returns setof uuid  (130 HRMS policies)
-- Both were `select org_id from public.users where id = auth.uid()`. Redefine
-- the set-returning one to delegate to auth_org_id() so the org-resolution
-- query lives in exactly one place. Behavior-preserving: a single-org user
-- resolves to the same one row either way. Non-destructive.

create or replace function auth_user_org_ids()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path to ''
as $$ select public.auth_org_id() $$;
