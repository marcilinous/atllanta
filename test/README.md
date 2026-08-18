# Tests

## `tenant-isolation.sql` — cross-tenant RLS isolation

Enforces the CLAUDE.md §4 guarantee ("user A cannot see user B's data under any
query path… must pass at all times"). It proves Row-Level Security blocks both
reads and writes across organizations, on both tenancy-scoping paths:

- `org_id` → `auth_user_org_ids()` (crm_leads, leave, attendance, …)
- `client_id` → `auth_accessible_client_ids()` (candidates, recruitment, …)

### How it works

Setup runs as the connection role (`postgres`, which bypasses RLS). The test
then `SET ROLE authenticated` and impersonates two users by setting
`request.jwt.claims` — exactly how PostgREST runs application queries, so
`auth.uid()` and every policy behave as they do in production. It asserts each
user sees only their own org's rows, sees zero of the other org's rows, and
cannot insert into the other org. A cross-tenant leak `RAISE`s and fails the run.

The whole file is wrapped in `BEGIN … ROLLBACK`, so it never leaves test rows
behind (no orgs, users, clients, leads, or candidates persist).

### Run it

```bash
# SUPABASE_DB_URL = the project's direct Postgres connection string
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f test/tenant-isolation.sql
```

- Exit code **0** + `PASS cross-tenant isolation` notice → isolation holds.
- Non-zero exit + `CROSS-TENANT ISOLATION FAILED :: …` → a leak was found; do
  not ship until it is fixed.

Run this after any change to RLS policies, the `auth_user_org_ids` /
`auth_accessible_client_ids` helpers, or the memberships/clients schema.

### Last verified

Run live against the production project on 2026-08-18 — **PASS**:
`A[own_crm=1,other_crm=0,own_cand=1,other_cand=0,cross_write=BLOCKED]`
`B[own_crm=1,other_crm=0,own_cand=1,other_cand=0,cross_read=0]`
