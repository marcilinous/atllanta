-- Functions get EXECUTE for PUBLIC by default, which hands the anon role a
-- callable /rest/v1/rpc/... endpoint. These all resolve to zero rows for an
-- unauthenticated caller (auth_user_org_ids() is empty) and the refresh
-- raises, so nothing leaks — but an unauthenticated endpoint that runs this
-- much work is a free denial-of-service lever, so take the grant away.
REVOKE ALL ON FUNCTION crm_opportunity_features()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_opportunity_signals()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_territory_potential()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_pjp_day_accounts(text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_pjp_visit_adherence(date, date)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_pjp_adherence(date, date)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_refresh_opportunity_features()    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_opportunity_computed_at()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm_customer_value_per_head()         FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION crm_opportunity_features()          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_opportunity_signals()           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_territory_potential()           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_pjp_day_accounts(text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_pjp_visit_adherence(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_pjp_adherence(date, date)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_refresh_opportunity_features()  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_opportunity_computed_at()       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_customer_value_per_head()       TO authenticated, service_role;