-- ============================================================
-- HARDEN users-table writes to admins (+ self)
-- ============================================================
-- Directory visibility stays org-wide (colleagues can see each other), but
-- creating and editing employee profiles — which drives roles and the
-- reporting hierarchy — is restricted to org admins, plus a person editing
-- their own profile. Previously any org member could insert/update any
-- user row in their org.
--
-- Safe for existing flows: the invite endpoint and bulk import run with the
-- service role (bypass RLS); the hierarchy editor and employee admin views
-- run as an admin; self-service profile edits match id = auth.uid().
-- ============================================================

DROP POLICY IF EXISTS users_insert ON users;
DROP POLICY IF EXISTS users_update ON users;

CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (
    (id = auth.uid() OR is_org_admin())
    AND org_id IN (SELECT auth_user_org_ids())
  );

CREATE POLICY users_update ON users FOR UPDATE
  USING (id = auth.uid() OR is_org_admin())
  WITH CHECK (id = auth.uid() OR is_org_admin());
