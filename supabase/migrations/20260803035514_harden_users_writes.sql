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