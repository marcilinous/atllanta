-- Phase 1 item 3: two-org isolation across every platform table (CLAUDE.md §1).
--
-- Run inside a transaction that is rolled back, against a LOCAL database:
--   begin; \i supabase/local/platform-schema.sql \i this-file rollback;
-- (npm run test:isolation does exactly that against the local Supabase.)
--
-- It creates two organisations with their own admin and member, then checks, as
-- each signed-in user, that nothing of the other organisation is readable or
-- writable. Every check raises on failure; a clean run returns one row:
--   result = 'all platform isolation tests passed'
--
-- Fixtures are made with the postgres role (RLS bypassed, as server code does),
-- and every assertion runs as `authenticated` with a JWT claim, which is what
-- auth.uid() reads.

-- Both jwt settings are set: Supabase's local auth.uid() reads
-- request.jwt.claim.sub, the hosted one reads the claims JSON.

do $fixtures$
declare
  org_a uuid := '11111111-1111-1111-1111-111111111111';
  org_b uuid := '22222222-2222-2222-2222-222222222222';
  admin_a uuid := 'aaaaaaa1-0000-0000-0000-000000000001';
  member_a uuid := 'aaaaaaa1-0000-0000-0000-000000000002';
  admin_b uuid := 'bbbbbbb2-0000-0000-0000-000000000001';
  dept_a uuid := 'ddddddd1-0000-0000-0000-000000000001';
  dept_b uuid := 'ddddddd2-0000-0000-0000-000000000001';
begin
  insert into organizations (id, name, org_type, slug) values
    (org_a, 'Org A', 'direct', 'org-a'),
    (org_b, 'Org B', 'direct', 'org-b');

  insert into users (id, org_id, full_name, email, role) values
    (admin_a, org_a, 'Admin A', 'admin-a@example.com', 'admin'),
    (member_a, org_a, 'Member A', 'member-a@example.com', 'member'),
    (admin_b, org_b, 'Admin B', 'admin-b@example.com', 'admin');

  insert into departments (id, org_id, name) values
    (dept_a, org_a, 'Engineering A'),
    (dept_b, org_b, 'Engineering B');

  insert into teams (org_id, department_id, name) values
    (org_a, dept_a, 'Team A'), (org_b, dept_b, 'Team B');

  insert into invitations (org_id, email, role) values
    (org_a, 'invite-a@example.com', 'member'),
    (org_b, 'invite-b@example.com', 'member');

  insert into audit_logs (org_id, user_id, module, entity_type, entity_id, action) values
    (org_a, admin_a, 'people', 'user', member_a, 'update'),
    (org_b, admin_b, 'people', 'user', admin_b, 'update');

  insert into events (org_id, event_type, actor_id) values
    (org_a, 'people.employee.updated', admin_a),
    (org_b, 'people.employee.updated', admin_b);

  insert into notifications (org_id, user_id, title, module) values
    (org_a, member_a, 'For A', 'people'),
    (org_b, admin_b, 'For B', 'people');

  insert into files (org_id, uploaded_by, file_name, file_path) values
    (org_a, admin_a, 'a.pdf', 'org-a/a.pdf'),
    (org_b, admin_b, 'b.pdf', 'org-b/b.pdf');

  insert into feature_access (org_id, subject_type, subject_key, feature_key, allowed) values
    (org_a, 'role', 'member', 'crm.export', false),
    (org_b, 'role', 'member', 'crm.export', false);
end
$fixtures$;

-- 1. Reads: a signed-in user sees their own organisation and nothing else -----

do $reads$
declare
  admin_a uuid := 'aaaaaaa1-0000-0000-0000-000000000001';
  org_b uuid := '22222222-2222-2222-2222-222222222222';
  tbl text;
  n integer;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', admin_a::text, true);

  foreach tbl in array array['organizations','users','departments','teams','invitations',
                             'audit_logs','events','files','feature_access']
  loop
    if tbl = 'organizations' then
      execute format('select count(*) from %I where id = $1', tbl) into n using org_b;
    else
      execute format('select count(*) from %I where org_id = $1', tbl) into n using org_b;
    end if;
    if n <> 0 then
      raise exception 'isolation: % leaked % row(s) of the other organisation', tbl, n;
    end if;
  end loop;

  -- ... and still sees its own rows, so the checks above are not vacuous.
  select count(*) into n from users;
  if n <> 2 then raise exception 'isolation: expected 2 own users, saw %', n; end if;
  select count(*) into n from organizations;
  if n <> 1 then raise exception 'isolation: expected 1 own organisation, saw %', n; end if;
  select count(*) into n from events;
  if n <> 1 then raise exception 'isolation: expected 1 own event, saw %', n; end if;

  perform set_config('role', 'postgres', true);
end
$reads$;

-- 2. Notifications are per-user, not per-org ---------------------------------

do $notifications$
declare
  admin_a uuid := 'aaaaaaa1-0000-0000-0000-000000000001';
  member_a uuid := 'aaaaaaa1-0000-0000-0000-000000000002';
  n integer;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', admin_a::text, true);
  select count(*) into n from notifications;
  if n <> 0 then raise exception 'isolation: admin A saw % notification(s) addressed to someone else', n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', member_a::text, true);
  select count(*) into n from notifications;
  if n <> 1 then raise exception 'isolation: member A saw % of their own notifications, expected 1', n; end if;
  perform set_config('role', 'postgres', true);
end
$notifications$;

-- 3. Writes: nothing of the other organisation can be created or changed -----

do $writes$
declare
  admin_a uuid := 'aaaaaaa1-0000-0000-0000-000000000001';
  org_a uuid := '11111111-1111-1111-1111-111111111111';
  org_b uuid := '22222222-2222-2222-2222-222222222222';
  dept_b uuid := 'ddddddd2-0000-0000-0000-000000000001';
  blocked boolean;
  n integer;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', admin_a::text, true);

  -- insert into another org
  blocked := false;
  begin
    insert into departments (org_id, name) values (org_b, 'Sneaky');
  exception when insufficient_privilege or check_violation then blocked := true;
  end;
  if not blocked then raise exception 'isolation: admin A inserted a department into org B'; end if;

  blocked := false;
  begin
    insert into invitations (org_id, email, role) values (org_b, 'sneaky@example.com', 'admin');
  exception when insufficient_privilege or check_violation then blocked := true;
  end;
  if not blocked then raise exception 'isolation: admin A invited into org B'; end if;

  -- update another org's rows: RLS makes them invisible, so nothing matches
  update departments set name = 'Renamed' where id = dept_b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'isolation: admin A renamed % department(s) of org B', n; end if;

  update organizations set name = 'Renamed' where id = org_b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'isolation: admin A renamed org B'; end if;

  -- ... but can still rename their own organisation (v1.2.3)
  update organizations set name = 'Org A renamed' where id = org_a;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'regression: admin A cannot rename their own organisation'; end if;

  -- org_id stays assigned by Atllanta (v1.2.2)
  blocked := false;
  begin
    update users set org_id = org_b where id = admin_a;
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'isolation: admin A moved themselves into org B'; end if;

  perform set_config('role', 'postgres', true);
end
$writes$;

-- 4. The event bus is org-scoped too -----------------------------------------

do $events$
declare
  admin_a uuid := 'aaaaaaa1-0000-0000-0000-000000000001';
  org_b uuid := '22222222-2222-2222-2222-222222222222';
  blocked boolean := false;
  n integer;
  leaked boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', admin_a::text, true);

  begin
    perform publish_event('people.employee.updated', '{}'::jsonb, org_b);
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'isolation: admin A published an event into org B'; end if;

  -- claim_events only ever returns the caller's own organisation's events
  select count(*), coalesce(bool_or(org_id = org_b), false) into n, leaked from claim_events(50);
  if n <> 1 then raise exception 'isolation: claim_events returned % events, expected 1 (own org only)', n; end if;
  if leaked then raise exception 'isolation: claim_events returned an event of org B'; end if;

  perform set_config('role', 'postgres', true);
end
$events$;

select 'all platform isolation tests passed' as result;
