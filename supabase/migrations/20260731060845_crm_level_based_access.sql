DO $$
DECLARE t TEXT; c TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_accounts','crm_contacts','crm_opportunities','crm_leads','crm_activities'] LOOP
    FOREACH c IN ARRAY ARRAY['owner_id','created_by'] LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I;', t, t||'_'||c||'_fkey');
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE SET NULL;', t, t||'_'||c||'_fkey', c);
    END LOOP;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION crm_user_is_org_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = auth.uid()
      AND m.role IN ('owner','admin','super_admin','agency_admin','client_admin')
  );
$$;

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