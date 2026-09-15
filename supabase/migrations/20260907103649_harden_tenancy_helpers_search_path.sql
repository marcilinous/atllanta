create or replace function auth_org_id()
returns uuid language sql security definer stable
set search_path = ''
as $$ select org_id from public.users where id = auth.uid() $$;

create or replace function auth_user_org_ids()
returns setof uuid language sql security definer stable
set search_path = ''
as $$ select org_id from public.users where id = auth.uid() $$;