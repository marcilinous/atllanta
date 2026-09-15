-- Two legitimate callers: an org admin pressing "Recompute" in the app, and
-- the nightly Vercel cron using the service key. The cron has no auth.uid(),
-- so crm_user_is_org_admin() is false for it — admit it on its JWT role claim
-- instead, otherwise the scheduled refresh can never run.
CREATE OR REPLACE FUNCTION crm_refresh_opportunity_features()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  jwt_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::json->>'role', '');
BEGIN
  IF NOT (crm_user_is_org_admin() OR jwt_role = 'service_role') THEN
    RAISE EXCEPTION 'Only an org admin may refresh the opportunity engine';
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY crm_opportunity_features_mv;
  RETURN now();
END $function$;

COMMENT ON FUNCTION crm_refresh_opportunity_features() IS
  'Recompute the opportunity feature cache. Org admins and the service-role cron only; run nightly and after any report import.';

REVOKE ALL ON FUNCTION crm_refresh_opportunity_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_refresh_opportunity_features() TO authenticated, service_role;