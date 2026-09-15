drop policy if exists posts_select on posts;
drop policy if exists posts_insert on posts;
drop policy if exists posts_update on posts;

create policy posts_select on posts
  for select
  using (org_id in (select auth_user_org_ids()));

create policy posts_insert on posts
  for insert
  with check (
    org_id in (select auth_user_org_ids())
    and author_id = auth.uid()
  );

create policy posts_update on posts
  for update
  using (org_id in (select auth_user_org_ids()))
  with check (org_id in (select auth_user_org_ids()));