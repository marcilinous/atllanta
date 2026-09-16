create or replace function auth_user_org_ids()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path to ''
as $$ select public.auth_org_id() $$;