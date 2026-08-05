-- ============================================================
-- auth_user_id_by_email() — robust email -> auth user id lookup
-- ============================================================
-- The admin invite flow needs to resolve an existing login by email. Going
-- through GoTrue's admin listUsers is fragile: it is paginated (misses users
-- past the first page) and it 500s outright when any auth.users row has a
-- legacy NULL token column ("converting NULL to string is unsupported").
--
-- A direct, indexed lookup avoids both problems. Restricted to service_role
-- (used only by the server-side /api/create-org endpoint) so it can't be
-- called from the browser to probe which emails have accounts.
-- ============================================================

CREATE OR REPLACE FUNCTION auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = auth, public AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auth_user_id_by_email(text) TO service_role;
