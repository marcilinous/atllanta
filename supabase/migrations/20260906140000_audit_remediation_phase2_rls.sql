-- ============================================================
-- AUDIT REMEDIATION — PHASE 2: per-permission RLS on Business-OS tables
-- ============================================================
-- Closes P0-04 (org-owned tables writable by any member, not just admins),
-- P0-05 (a member could change admin fields on their own user row), and the
-- concrete slice of BOS-01 (permission-based authorization) that maps onto the
-- product's four fixed roles — owner/admin/manager/member — WITHOUT adding a
-- custom-permissions system (explicitly out of scope, CLAUDE.md §7).
--
-- Model: writes to org configuration and identity require an admin
-- (is_org_admin() = owner/admin family), still org-scoped; ownership-sensitive
-- rows (expenses) allow the owner OR an admin; approval/identity fields are
-- protected by triggers so a non-admin can't self-approve or self-elevate.
-- Every UI screen for these tables already gates its controls to owner/admin,
-- so this only closes the direct-API path the audit flagged (FE-04).
--
-- Deliberately NOT touched here: leave_balances writes flow through the
-- in-browser event processor via apply_leave_usage() (SECURITY INVOKER, from
-- BOS-04); tightening them safely needs the outbox/idempotency rework
-- (P0-10/EV-02) so a blocked RLS update isn't silently lost. leave_requests
-- and attendance are already role-gated.
-- ============================================================

-- ------------------------------------------------------------
-- Helper: is the caller an org owner? (owner/super_admin) — used to stop an
-- admin from minting owners. is_org_admin() already covers owner/admin family.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_org_owner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
     WHERE m.user_id = auth.uid()
       AND m.role IN ('owner', 'super_admin')
  );
$$;

-- ============================================================
-- P0-04/P0-05/BOS-01 — memberships: only admins write; no privilege escalation.
-- Any org member could previously INSERT/UPDATE/DELETE memberships — i.e. grant
-- themselves any role or remove others. Gate writes to admins, still org-scoped.
-- ============================================================
DROP POLICY IF EXISTS memberships_org_insert ON memberships;
DROP POLICY IF EXISTS memberships_org_update ON memberships;
DROP POLICY IF EXISTS memberships_org_delete ON memberships;

CREATE POLICY memberships_org_insert ON memberships FOR INSERT
  WITH CHECK (organization_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY memberships_org_update ON memberships FOR UPDATE
  USING (organization_id IN (SELECT auth_user_org_ids()) AND is_org_admin())
  WITH CHECK (organization_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY memberships_org_delete ON memberships FOR DELETE
  USING (organization_id IN (SELECT auth_user_org_ids()) AND is_org_admin());

-- Guard: only an owner may grant the owner/super_admin role, and no one may
-- change their own role (self-escalation). Service role (auth.uid() IS NULL)
-- bypasses — trusted server provisioning is unaffected.
CREATE OR REPLACE FUNCTION memberships_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- service role / trusted server path
  END IF;

  IF NEW.role IN ('owner', 'super_admin') AND NOT is_org_owner() THEN
    RAISE EXCEPTION 'Only an owner can grant the owner role' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.user_id = auth.uid() AND NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'You cannot change your own role' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_memberships_guard ON memberships;
CREATE TRIGGER trg_memberships_guard
  BEFORE INSERT OR UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_guard();

-- ============================================================
-- P0-05 — users: separate self-editable profile fields from admin/HR fields.
-- The users_update policy already scopes rows to (self OR admin); this trigger
-- makes the column split real: a non-admin editing their own row cannot change
-- role, status, org, department/team, reporting line, designation or joining
-- date. Those are silently kept at their prior values (self-service profile
-- saves that echo the whole row don't error). Admins and the service role are
-- unaffected. On INSERT a non-admin can only create their own row as 'member'.
-- ============================================================
CREATE OR REPLACE FUNCTION users_guard_admin_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR is_org_admin() THEN
    RETURN NEW;  -- admin or trusted server path
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.role := 'member';       -- can't self-provision as owner/admin/manager
    RETURN NEW;
  END IF;

  -- UPDATE by a non-admin (their own row): preserve every admin/HR field.
  NEW.role                 := OLD.role;
  NEW.status               := OLD.status;
  NEW.org_id               := OLD.org_id;
  NEW.department_id        := OLD.department_id;
  NEW.team_id              := OLD.team_id;
  NEW.reporting_manager_id := OLD.reporting_manager_id;
  NEW.designation          := OLD.designation;
  NEW.date_of_joining      := OLD.date_of_joining;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_guard_admin_fields ON users;
CREATE TRIGGER trg_users_guard_admin_fields
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_guard_admin_fields();

-- ============================================================
-- P0-04 — org configuration tables: writes require an admin, still org-scoped.
-- Every management screen already restricts its controls to owner/admin, so
-- this only closes the direct-API path. SELECT policies are left unchanged.
-- ============================================================

-- departments
DROP POLICY IF EXISTS dept_insert ON departments;
DROP POLICY IF EXISTS dept_update ON departments;
DROP POLICY IF EXISTS dept_delete ON departments;
CREATE POLICY dept_insert ON departments FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY dept_update ON departments FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY dept_delete ON departments FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());

-- teams
DROP POLICY IF EXISTS teams_insert ON teams;
DROP POLICY IF EXISTS teams_update ON teams;
DROP POLICY IF EXISTS teams_delete ON teams;
CREATE POLICY teams_insert ON teams FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY teams_update ON teams FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY teams_delete ON teams FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());

-- leave_types (adds a DELETE policy the management UI expects; was absent)
DROP POLICY IF EXISTS lt_insert ON leave_types;
DROP POLICY IF EXISTS lt_update ON leave_types;
DROP POLICY IF EXISTS lt_delete ON leave_types;
CREATE POLICY lt_insert ON leave_types FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY lt_update ON leave_types FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY lt_delete ON leave_types FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());

-- expense_categories
DROP POLICY IF EXISTS org_isolation_insert ON expense_categories;
DROP POLICY IF EXISTS org_isolation_update ON expense_categories;
DROP POLICY IF EXISTS org_isolation_delete ON expense_categories;
CREATE POLICY org_isolation_insert ON expense_categories FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY org_isolation_update ON expense_categories FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY org_isolation_delete ON expense_categories FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());

-- announcements
DROP POLICY IF EXISTS org_isolation_insert ON announcements;
DROP POLICY IF EXISTS org_isolation_update ON announcements;
DROP POLICY IF EXISTS org_isolation_delete ON announcements;
CREATE POLICY org_isolation_insert ON announcements FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY org_isolation_update ON announcements FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY org_isolation_delete ON announcements FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());

-- assets
DROP POLICY IF EXISTS org_isolation_insert ON assets;
DROP POLICY IF EXISTS org_isolation_update ON assets;
DROP POLICY IF EXISTS org_isolation_delete ON assets;
CREATE POLICY org_isolation_insert ON assets FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY org_isolation_update ON assets FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY org_isolation_delete ON assets FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());

-- asset_assignments
DROP POLICY IF EXISTS org_isolation_insert ON asset_assignments;
DROP POLICY IF EXISTS org_isolation_update ON asset_assignments;
DROP POLICY IF EXISTS org_isolation_delete ON asset_assignments;
CREATE POLICY org_isolation_insert ON asset_assignments FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY org_isolation_update ON asset_assignments FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY org_isolation_delete ON asset_assignments FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());

-- ============================================================
-- P0-04 — expenses: an employee owns their own expense; only an admin reviews.
-- Previously any member could UPDATE/DELETE any expense (including approving it
-- for themselves). Now: submit your own, edit/delete your own, admins do
-- anything — and a trigger keeps the review fields (status / reviewer /
-- reimbursement) admin-only so no one approves their own claim.
-- ============================================================
DROP POLICY IF EXISTS org_isolation_insert ON expenses;
DROP POLICY IF EXISTS org_isolation_update ON expenses;
DROP POLICY IF EXISTS org_isolation_delete ON expenses;
CREATE POLICY org_isolation_insert ON expenses FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND (user_id = auth.uid() OR is_org_admin()));
CREATE POLICY org_isolation_update ON expenses FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (user_id = auth.uid() OR is_org_admin()))
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND (user_id = auth.uid() OR is_org_admin()));
CREATE POLICY org_isolation_delete ON expenses FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND (user_id = auth.uid() OR is_org_admin()));

CREATE OR REPLACE FUNCTION expenses_guard_review()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR is_org_admin() THEN
    RETURN NEW;  -- admin or trusted server path may set review fields
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status        := 'pending';   -- a submitter can't file a pre-approved claim
    NEW.reviewed_by   := NULL;
    NEW.reviewed_at   := NULL;
    NEW.review_comment := NULL;
    NEW.reimbursed_at := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE by a non-admin (their own claim): review fields can't be touched.
  NEW.status        := OLD.status;
  NEW.reviewed_by   := OLD.reviewed_by;
  NEW.reviewed_at   := OLD.reviewed_at;
  NEW.review_comment := OLD.review_comment;
  NEW.reimbursed_at := OLD.reimbursed_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expenses_guard_review ON expenses;
CREATE TRIGGER trg_expenses_guard_review
  BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_guard_review();

REVOKE ALL ON FUNCTION is_org_owner() FROM anon;
