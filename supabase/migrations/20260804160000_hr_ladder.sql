-- ============================================================
-- HR LADDER — graded HR access, decoupled from org admin
-- ============================================================
-- HR is a function, not a rung in the reporting tree, so it needs its own
-- access grant separate from the powerful `admin` role. A membership can
-- carry an hr_level and an optional department scope:
--
--   exec    — view + correct punches + onboarding/docs, within scope
--   manager — the above + approve regularizations & leave, within scope
--   head    — all of the above org-wide + configure (work locations, etc.)
--
-- Scope: hr_scope_department_id NULL = whole org; otherwise limited to
-- employees in that department. Org owners/admins implicitly have full HR
-- powers, so nothing here narrows what they already had — it only widens
-- access to designated HR staff.
-- ============================================================

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS hr_level text NOT NULL DEFAULT 'none'
    CHECK (hr_level IN ('none','exec','manager','head')),
  ADD COLUMN IF NOT EXISTS hr_scope_department_id uuid REFERENCES departments(id) ON DELETE SET NULL;

-- The set of employee ids the current user may see by virtue of an HR grant
-- (empty when they have none). Org admins/owners and HR heads get the whole
-- org; scoped exec/manager get just their department.
CREATE OR REPLACE FUNCTION hr_visible_user_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT m.role, m.hr_level, m.hr_scope_department_id, m.organization_id
    FROM memberships m WHERE m.user_id = auth.uid()
  )
  SELECT u.id
  FROM users u JOIN me ON u.org_id = me.organization_id
  WHERE me.role IN ('owner','admin','super_admin','agency_admin','client_admin')
     OR me.hr_level = 'head'
     OR (me.hr_level IN ('manager','exec')
         AND (me.hr_scope_department_id IS NULL OR u.department_id = me.hr_scope_department_id));
$$;

-- Can the current user approve HR requests (leave / regularization)?
CREATE OR REPLACE FUNCTION hr_can_approve()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m WHERE m.user_id = auth.uid()
      AND (m.role IN ('owner','admin','super_admin','agency_admin','client_admin')
           OR m.hr_level IN ('manager','head'))
  );
$$;

-- Can the current user configure HRMS setup (work locations, etc.)?
CREATE OR REPLACE FUNCTION hr_can_configure()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m WHERE m.user_id = auth.uid()
      AND (m.role IN ('owner','admin','super_admin','agency_admin','client_admin')
           OR m.hr_level = 'head')
  );
$$;

REVOKE ALL ON FUNCTION hr_visible_user_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION hr_can_approve() FROM PUBLIC;
REVOKE ALL ON FUNCTION hr_can_configure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hr_visible_user_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION hr_can_approve() TO authenticated;
GRANT EXECUTE ON FUNCTION hr_can_configure() TO authenticated;

-- ------------------------------------------------------------
-- Fold HR visibility into the personal-HR-data policies. View + attendance
-- correction go to any HR level (scoped); leave/regularization APPROVAL is
-- gated to manager+ HR (scoped). Self and reporting-manager access unchanged.
-- ------------------------------------------------------------
DO $$
DECLARE
  view_pred TEXT := '(org_id IN (SELECT auth_user_org_ids()) AND ('
    || 'is_org_admin() '
    || 'OR user_id = auth.uid() '
    || 'OR user_id IN (SELECT user_report_ids()) '
    || 'OR user_id IN (SELECT hr_visible_user_ids())))';
  approve_pred TEXT := '(org_id IN (SELECT auth_user_org_ids()) AND ('
    || 'is_org_admin() '
    || 'OR user_id = auth.uid() '
    || 'OR user_id IN (SELECT user_report_ids()) '
    || 'OR (hr_can_approve() AND user_id IN (SELECT hr_visible_user_ids()))))';
BEGIN
  -- Attendance: HR (any level, scoped) can view and correct punches.
  DROP POLICY IF EXISTS att_select ON attendance;
  DROP POLICY IF EXISTS att_update ON attendance;
  EXECUTE format('CREATE POLICY att_select ON attendance FOR SELECT USING %s;', view_pred);
  EXECUTE format('CREATE POLICY att_update ON attendance FOR UPDATE USING %s;', view_pred);

  -- Regularizations: HR can view (any level); approve is manager+ HR.
  DROP POLICY IF EXISTS attreg_select ON attendance_regularizations;
  DROP POLICY IF EXISTS attreg_update ON attendance_regularizations;
  EXECUTE format('CREATE POLICY attreg_select ON attendance_regularizations FOR SELECT USING %s;', view_pred);
  EXECUTE format('CREATE POLICY attreg_update ON attendance_regularizations FOR UPDATE USING %s;', approve_pred);

  -- Leave requests: HR can view (any level); approve is manager+ HR.
  DROP POLICY IF EXISTS lr_select ON leave_requests;
  DROP POLICY IF EXISTS lr_update ON leave_requests;
  EXECUTE format('CREATE POLICY lr_select ON leave_requests FOR SELECT USING %s;', view_pred);
  EXECUTE format('CREATE POLICY lr_update ON leave_requests FOR UPDATE USING %s;', approve_pred);

  -- Leave balances: HR can view (any level).
  DROP POLICY IF EXISTS lb_select ON leave_balances;
  EXECUTE format('CREATE POLICY lb_select ON leave_balances FOR SELECT USING %s;', view_pred);
END $$;

-- Work locations: HR heads may configure the geofence too (not just org admins).
DROP POLICY IF EXISTS work_locations_insert ON work_locations;
CREATE POLICY work_locations_insert ON work_locations FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND (crm_user_is_org_admin() OR hr_can_configure()));

DROP POLICY IF EXISTS work_locations_update ON work_locations;
CREATE POLICY work_locations_update ON work_locations FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (crm_user_is_org_admin() OR hr_can_configure()));

DROP POLICY IF EXISTS work_locations_delete ON work_locations;
CREATE POLICY work_locations_delete ON work_locations FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (crm_user_is_org_admin() OR hr_can_configure()));
