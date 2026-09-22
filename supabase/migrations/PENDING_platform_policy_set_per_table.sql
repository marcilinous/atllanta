-- v1.2.3 / Phase 1 item 2: the right policy set per platform table.
--
-- 1. organizations had no UPDATE policy at all, so an admin renaming the org or
--    uploading a logo (settings/org.js, onboarding.js) was silently denied by
--    RLS. Verified against production: the update matched 0 rows.
-- 2. invitations had one catch-all policy for any org member, so a member could
--    create an invitation with any role, including admin. Both screens that
--    write invitations are admin-only in the UI; RLS now says the same.
-- 3. users_update's WITH CHECK never tied the row to the caller's org. The
--    v1.2.2 trigger already blocks org moves; this states it in the policy too.
--
-- Server code with the service key bypasses RLS and is unaffected. Verified in
-- a rolled-back transaction against production: after these policies a member
-- can still edit their own profile, an admin can rename the org, invite, and
-- edit users in their own org, and no one can change org_id.

create policy organizations_admin_update on public.organizations
  for update
  using (id = auth_org_id() and is_org_admin())
  with check (id = auth_org_id() and is_org_admin());

drop policy invitations_org on public.invitations;

create policy invitations_admin_all on public.invitations
  for all
  using (org_id = auth_org_id() and is_org_admin())
  with check (org_id = auth_org_id() and is_org_admin());

alter policy users_update on public.users
  using ((id = auth.uid()) or is_org_admin())
  with check (((id = auth.uid()) or is_org_admin()) and org_id = auth_org_id());
