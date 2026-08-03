-- ============================================================
-- HRMS ROLE-BASED ACCESS (within each org / school)
-- ============================================================
-- Each organization is an isolated school (org_id + auth_user_org_ids()
-- already prevent one org from seeing another). This adds the *inside a
-- school* role model to personal HR data, mirroring the CRM:
--   • Employee (member) → only their own records
--   • Manager           → their own + their reporting hierarchy's
--   • Admin/owner        → everyone in the org (school)
--
-- Also fixes a real defect: leave_requests and attendance_regularizations
-- were org-wide UPDATE-able, so any member could approve anyone's request.
--
-- The employee directory (users), org structure, holidays, work schedules
-- and leave-type config stay org-visible on purpose — colleagues can see
-- each other exist; only personal attendance/leave records are scoped.
-- ============================================================

-- ------------------------------------------------------------
-- Generic org helpers (HRMS + anything else that needs them)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = auth.uid()
      AND m.role IN ('owner','admin','super_admin','agency_admin','client_admin')
  );
$$;

-- The current user + everyone reporting up to them (recursive).
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

-- ------------------------------------------------------------
-- Role-based policies on personal HR data (owner column = user_id)
-- ------------------------------------------------------------
DO $$
DECLARE
  pred TEXT := '(org_id IN (SELECT auth_user_org_ids()) AND ('
    || 'is_org_admin() '
    || 'OR user_id = auth.uid() '
    || 'OR user_id IN (SELECT user_report_ids())))';
BEGIN
  -- Attendance: visible to self / manager / admin; editable by same
  -- (self was the only editor before — this only widens, never narrows).
  DROP POLICY IF EXISTS att_select ON attendance;
  DROP POLICY IF EXISTS att_update ON attendance;
  EXECUTE format('CREATE POLICY att_select ON attendance FOR SELECT USING %s;', pred);
  EXECUTE format('CREATE POLICY att_update ON attendance FOR UPDATE USING %s;', pred);

  -- Regularizations: scope visibility; only self/manager/admin may act
  -- (was org-wide UPDATE-able).
  DROP POLICY IF EXISTS attreg_select ON attendance_regularizations;
  DROP POLICY IF EXISTS attreg_update ON attendance_regularizations;
  EXECUTE format('CREATE POLICY attreg_select ON attendance_regularizations FOR SELECT USING %s;', pred);
  EXECUTE format('CREATE POLICY attreg_update ON attendance_regularizations FOR UPDATE USING %s;', pred);

  -- Leave requests: scope visibility; only self/manager/admin may act
  -- (was org-wide UPDATE-able — any member could approve anyone).
  DROP POLICY IF EXISTS lr_select ON leave_requests;
  DROP POLICY IF EXISTS lr_update ON leave_requests;
  EXECUTE format('CREATE POLICY lr_select ON leave_requests FOR SELECT USING %s;', pred);
  EXECUTE format('CREATE POLICY lr_update ON leave_requests FOR UPDATE USING %s;', pred);

  -- Leave balances: scope visibility. UPDATE stays org-scoped because the
  -- in-browser event processor maintains balances on approval for other
  -- users; balance mutation hardening is tracked separately.
  DROP POLICY IF EXISTS lb_select ON leave_balances;
  EXECUTE format('CREATE POLICY lb_select ON leave_balances FOR SELECT USING %s;', pred);
END $$;
