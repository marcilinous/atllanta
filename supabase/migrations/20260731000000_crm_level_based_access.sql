-- ============================================================
-- CRM LEVEL-BASED (ROLE-BASED) RECORD VISIBILITY
-- ============================================================
-- Replaces the CRM's flat org-wide visibility with a Salesforce-style
-- access model:
--   • Reps (member)  → only records they own or created
--   • Managers       → their own + their reporting hierarchy's
--   • Admins/owners  → everything in the org
--
-- Enforced in RLS (the real boundary); the UI mirrors it with a
-- My / Everyone-I-can-see scope switch.
--
-- Also repoints CRM ownership from public.users to auth.users: a CRM
-- owner is a logged-in system user (salesperson), which always exists —
-- an HR employee profile in public.users is optional and may not exist
-- yet. This is what lets ownership (and therefore level-based views)
-- work before anyone is onboarded as an employee.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Repoint owner_id / created_by → auth.users(id)
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  c TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_accounts','crm_contacts','crm_opportunities','crm_leads','crm_activities'] LOOP
    FOREACH c IN ARRAY ARRAY['owner_id','created_by'] LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I;', t, t||'_'||c||'_fkey');
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE SET NULL;', t, t||'_'||c||'_fkey', c);
    END LOOP;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2. Visibility helpers
-- ------------------------------------------------------------
-- Is the current user an org admin/owner (sees all CRM records in org)?
CREATE OR REPLACE FUNCTION crm_user_is_org_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = auth.uid()
      AND m.role IN ('owner','admin','super_admin','agency_admin','client_admin')
  );
$$;

-- The current user + everyone reporting up to them (recursive), from the
-- employee reporting hierarchy. Empty for users without a profile; that's
-- fine — the policy also matches owner_id/created_by = auth.uid() directly.
CREATE OR REPLACE FUNCTION crm_report_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE team AS (
    SELECT id FROM users WHERE id = auth.uid()
    UNION
    SELECT u.id FROM users u JOIN team t ON u.reporting_manager_id = t.id
  )
  SELECT id FROM team;
$$;

REVOKE ALL ON FUNCTION crm_user_is_org_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_report_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_user_is_org_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION crm_report_ids() TO authenticated;

-- ------------------------------------------------------------
-- 3. Role-based SELECT / UPDATE / DELETE policies
--    (INSERT stays org-scoped: any member may create records)
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  visible TEXT := '(org_id IN (SELECT auth_user_org_ids()) AND ('
    || 'crm_user_is_org_admin() '
    || 'OR owner_id = auth.uid() '
    || 'OR created_by = auth.uid() '
    || 'OR owner_id IN (SELECT crm_report_ids())))';
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_accounts','crm_contacts','crm_opportunities','crm_leads','crm_activities'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_delete', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING %s;', t||'_select', t, visible);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING %s;', t||'_update', t, visible);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING %s;', t||'_delete', t, visible);
  END LOOP;
END $$;
