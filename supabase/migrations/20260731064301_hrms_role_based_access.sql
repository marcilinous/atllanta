CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = auth.uid()
      AND m.role IN ('owner','admin','super_admin','agency_admin','client_admin')
  );
$$;

CREATE OR REPLACE FUNCTION user_report_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE team AS (
    SELECT id FROM users WHERE id = auth.uid()
    UNION
    SELECT u.id FROM users u JOIN team t ON u.reporting_manager_id = t.id
  )
  SELECT id FROM team;
$$;

REVOKE ALL ON FUNCTION is_org_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION user_report_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_org_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION user_report_ids() TO authenticated;

DO $$
DECLARE
  pred TEXT := '(org_id IN (SELECT auth_user_org_ids()) AND ('
    || 'is_org_admin() '
    || 'OR user_id = auth.uid() '
    || 'OR user_id IN (SELECT user_report_ids())))';
BEGIN
  DROP POLICY IF EXISTS att_select ON attendance;
  DROP POLICY IF EXISTS att_update ON attendance;
  EXECUTE format('CREATE POLICY att_select ON attendance FOR SELECT USING %s;', pred);
  EXECUTE format('CREATE POLICY att_update ON attendance FOR UPDATE USING %s;', pred);

  DROP POLICY IF EXISTS attreg_select ON attendance_regularizations;
  DROP POLICY IF EXISTS attreg_update ON attendance_regularizations;
  EXECUTE format('CREATE POLICY attreg_select ON attendance_regularizations FOR SELECT USING %s;', pred);
  EXECUTE format('CREATE POLICY attreg_update ON attendance_regularizations FOR UPDATE USING %s;', pred);

  DROP POLICY IF EXISTS lr_select ON leave_requests;
  DROP POLICY IF EXISTS lr_update ON leave_requests;
  EXECUTE format('CREATE POLICY lr_select ON leave_requests FOR SELECT USING %s;', pred);
  EXECUTE format('CREATE POLICY lr_update ON leave_requests FOR UPDATE USING %s;', pred);

  DROP POLICY IF EXISTS lb_select ON leave_balances;
  EXECUTE format('CREATE POLICY lb_select ON leave_balances FOR SELECT USING %s;', pred);
END $$;