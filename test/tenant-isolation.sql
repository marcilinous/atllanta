-- ============================================================================
-- Cross-tenant isolation test  (CLAUDE.md §4 — "must pass at all times")
-- ============================================================================
--
-- Proves that Row-Level Security stops one organization from reading or
-- writing another organization's data, across BOTH tenancy-scoping paths:
--   * org_id  -> auth_user_org_ids()          (e.g. crm_leads, leave, attendance)
--   * client_id -> auth_accessible_client_ids() (e.g. candidates, recruitment)
--
-- HOW IT WORKS
--   Setup runs as the connection role (postgres, which BYPASSRLS), then the
--   test switches to the real `authenticated` role and impersonates two users
--   by setting `request.jwt.claims` — exactly how PostgREST runs app queries,
--   so `auth.uid()` and every policy behave as they do in production.
--
--   The whole file runs inside one transaction and ends with ROLLBACK, so it
--   never leaves test rows behind. On any isolation failure the DO block
--   RAISEs, which (with `psql -v ON_ERROR_STOP=1`) exits non-zero and fails CI.
--
-- RUN
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f test/tenant-isolation.sql
--   (SUPABASE_DB_URL = the project's direct Postgres connection string.)
--   Expected: a "PASS cross-tenant isolation" NOTICE and exit code 0.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  orgA uuid; orgB uuid;
  uA uuid := gen_random_uuid(); uB uuid := gen_random_uuid();
  cA uuid; cB uuid;
  a_own_crm int; a_other_crm int; a_own_cand int; a_other_cand int;
  b_own_crm int; b_other_crm int; b_own_cand int; b_other_cand int;
  a_cross_write text; b_cross_read int;
  report text := ''; fails int := 0;
BEGIN
  -- ---- Setup: two isolated tenants, one user each ----
  INSERT INTO organizations(name, slug, org_type)
    VALUES ('ISO-TEST-A','iso-a-'||substr(uA::text,1,8),'direct') RETURNING id INTO orgA;
  INSERT INTO organizations(name, slug, org_type)
    VALUES ('ISO-TEST-B','iso-b-'||substr(uB::text,1,8),'direct') RETURNING id INTO orgB;
  INSERT INTO auth.users(id, email) VALUES
    (uA,'iso-a-'||substr(uA::text,1,8)||'@example.test'),
    (uB,'iso-b-'||substr(uB::text,1,8)||'@example.test');
  INSERT INTO clients(organization_id, name) VALUES (orgA,'ISO client A') RETURNING id INTO cA;
  INSERT INTO clients(organization_id, name) VALUES (orgB,'ISO client B') RETURNING id INTO cB;
  INSERT INTO memberships(user_id, organization_id, client_id, role) VALUES
    (uA, orgA, cA, 'member'),
    (uB, orgB, cB, 'member');
  INSERT INTO crm_leads(org_id, owner_id, created_by) VALUES (orgA, uA, uA),(orgB, uB, uB);
  INSERT INTO candidates(client_id, name) VALUES (cA,'ISO cand A'),(cB,'ISO cand B');

  -- ---- Exercise RLS as the real authenticated users ----
  SET LOCAL ROLE authenticated;

  -- User A's view
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uA,'role','authenticated')::text, true);
  SELECT count(*) INTO a_own_crm    FROM crm_leads  WHERE org_id = orgA;
  SELECT count(*) INTO a_other_crm  FROM crm_leads  WHERE org_id = orgB;   -- must be 0
  SELECT count(*) INTO a_own_cand   FROM candidates WHERE client_id = cA;
  SELECT count(*) INTO a_other_cand FROM candidates WHERE client_id = cB;  -- must be 0
  BEGIN
    INSERT INTO crm_leads(org_id, owner_id, created_by) VALUES (orgB, uA, uA); -- must be blocked
    a_cross_write := 'ALLOWED(BUG)';
  EXCEPTION WHEN others THEN a_cross_write := 'BLOCKED';
  END;

  -- User B's view
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uB,'role','authenticated')::text, true);
  SELECT count(*) INTO b_own_crm    FROM crm_leads  WHERE org_id = orgB;
  SELECT count(*) INTO b_other_crm  FROM crm_leads  WHERE org_id = orgA;   -- must be 0
  SELECT count(*) INTO b_own_cand   FROM candidates WHERE client_id = cB;
  SELECT count(*) INTO b_other_cand FROM candidates WHERE client_id = cA;  -- must be 0
  SELECT count(*) INTO b_cross_read FROM crm_leads  WHERE org_id = orgA;   -- must be 0

  RESET ROLE;

  -- ---- Assertions ----
  IF a_own_crm   < 1 THEN fails:=fails+1; report:=report||'A cannot see own crm_lead; '; END IF;
  IF a_other_crm > 0 THEN fails:=fails+1; report:=report||'A sees B crm_lead ('||a_other_crm||'); '; END IF;
  IF a_own_cand  < 1 THEN fails:=fails+1; report:=report||'A cannot see own candidate; '; END IF;
  IF a_other_cand> 0 THEN fails:=fails+1; report:=report||'A sees B candidate ('||a_other_cand||'); '; END IF;
  IF a_cross_write <> 'BLOCKED' THEN fails:=fails+1; report:=report||'A wrote into B org ('||a_cross_write||'); '; END IF;
  IF b_own_crm   < 1 THEN fails:=fails+1; report:=report||'B cannot see own crm_lead; '; END IF;
  IF b_other_crm > 0 THEN fails:=fails+1; report:=report||'B sees A crm_lead ('||b_other_crm||'); '; END IF;
  IF b_own_cand  < 1 THEN fails:=fails+1; report:=report||'B cannot see own candidate; '; END IF;
  IF b_other_cand> 0 THEN fails:=fails+1; report:=report||'B sees A candidate ('||b_other_cand||'); '; END IF;
  IF b_cross_read> 0 THEN fails:=fails+1; report:=report||'B cross-reads A ('||b_cross_read||'); '; END IF;

  IF fails > 0 THEN
    RAISE EXCEPTION 'CROSS-TENANT ISOLATION FAILED :: %', report;
  END IF;

  RAISE NOTICE 'PASS cross-tenant isolation. A[own_crm=%,other_crm=%,own_cand=%,other_cand=%,cross_write=%] B[own_crm=%,other_crm=%,own_cand=%,other_cand=%,cross_read=%]',
    a_own_crm,a_other_crm,a_own_cand,a_other_cand,a_cross_write,
    b_own_crm,b_other_crm,b_own_cand,b_other_cand,b_cross_read;
END $$;

ROLLBACK;
