-- ATLLANTA — repair role/permission helpers left dangling by Phase 1b.
--
-- Phase 1b's `drop table memberships cascade` removed the POLICIES that
-- depended on memberships, but SECURITY DEFINER helper functions don't depend
-- on it via the catalog, so they survived still querying memberships. Every
-- RLS path that invokes one now throws `relation "memberships" does not exist`
-- once the org filter passes — this gates admin writes across users,
-- departments, teams, assets, announcements, leave_types, api_keys, webhooks,
-- feature_access, and every crm_* table (via crm_user_is_org_admin), plus
-- leave/attendance approvals (hr_*).
--
-- Rewrite each onto the single `users` row with the canonical four roles.
-- `users` kept role/department_id/org_id but NOT the old hr_level/hr_scope
-- columns, so manager visibility falls back to same-department scope.

-- Org admin = owner or admin.
create or replace function is_org_admin()
  returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from users u where u.id = auth.uid() and u.role in ('owner','admin')); $$;

create or replace function crm_user_is_org_admin()
  returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from users u where u.id = auth.uid() and u.role in ('owner','admin')); $$;

-- Org owner = owner.
create or replace function is_org_owner()
  returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from users u where u.id = auth.uid() and u.role = 'owner'); $$;

-- The agency super-admin tier no longer exists; nobody is a super admin.
create or replace function is_super_admin()
  returns boolean language sql stable security definer set search_path to 'public'
as $$ select false; $$;

-- HR approve = owner/admin/manager; HR configure = owner/admin.
create or replace function hr_can_approve()
  returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from users u where u.id = auth.uid() and u.role in ('owner','admin','manager')); $$;

create or replace function hr_can_configure()
  returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from users u where u.id = auth.uid() and u.role in ('owner','admin')); $$;

-- Users an HR actor may see: owner/admin see the whole org; a manager sees
-- their own department (department scope was the memberships hr_scope; approximate
-- with users.department_id); everyone always sees themselves.
create or replace function hr_visible_user_ids()
  returns setof uuid language sql stable security definer set search_path to 'public'
as $$
  with me as (select role, department_id, org_id from users where id = auth.uid())
  select u.id
  from users u cross join me
  where u.org_id = me.org_id
    and ( me.role in ('owner','admin')
          or (me.role = 'manager' and (me.department_id is null or u.department_id = me.department_id))
          or u.id = auth.uid() );
$$;

-- CRM telecaller helpers: same manager gate, off users instead of memberships.
create or replace function crm_telecaller_names()
  returns table(telecaller text, partners integer)
  language sql stable security definer set search_path to 'public'
as $$
  select a.telecaller, count(*)::int
  from crm_accounts a
  where a.org_id in (select auth_user_org_ids())
    and a.telecaller is not null and a.telecaller <> ''
    and exists (select 1 from users u where u.id = auth.uid() and u.role in ('owner','admin','manager'))
  group by a.telecaller order by a.telecaller;
$$;

create or replace function crm_telecaller_book(p_telecaller text default null)
  returns table(account_id uuid, name text, external_id text, district_new text, region text, hub text, telecaller text, phone text, tss_cfy integer, tss_lfy integer, any_cfy integer, tp_cfy integer, last_call_at timestamp with time zone, calls_total integer, called_by_me boolean)
  language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
DECLARE
  cfy_start date := make_date(EXTRACT(year FROM current_date)::int - CASE WHEN EXTRACT(month FROM current_date) >= 4 THEN 0 ELSE 1 END, 4, 1);
  cfy_end date; lfy_start date; lfy_end date;
  my_name text; is_mgr boolean; eff text;
BEGIN
  cfy_end   := (cfy_start + interval '1 year - 1 day')::date;
  lfy_start := (cfy_start - interval '1 year')::date;
  lfy_end   := (cfy_start - interval '1 day')::date;
  SELECT u.full_name INTO my_name FROM users u WHERE u.id = auth.uid();
  is_mgr := EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid()
                    AND u.role IN ('owner','admin','manager'));
  eff := CASE WHEN is_mgr THEN p_telecaller ELSE my_name END;

  RETURN QUERY
  WITH acct AS (
    SELECT a.id, a.name, a.external_id, a.district_new, a.region, a.hub, a.telecaller, a.phone
    FROM crm_accounts a
    WHERE a.org_id IN (SELECT auth_user_org_ids())
      AND ( (is_mgr AND eff IS NULL) OR (eff IS NOT NULL AND a.telecaller ILIKE eff) )
  ),
  sales AS (
    SELECT rr.account_id AS acct_id, rr.data->>'activation type' AS atype,
      CASE WHEN left(rr.data->>'activation date',10) ~ '^\d{4}-\d{2}-\d{2}$'
           THEN left(rr.data->>'activation date',10)::date END AS adate
    FROM crm_report_rows rr JOIN crm_report_imports i ON i.id = rr.import_id
    WHERE i.org_id IN (SELECT auth_user_org_ids()) AND i.report_type ILIKE 'Sales'
      AND rr.account_id IN (SELECT id FROM acct)
  ),
  agg AS (
    SELECT s.acct_id,
      count(*) FILTER (WHERE s.atype='TSS' AND s.adate BETWEEN cfy_start AND cfy_end)::int AS tss_cfy,
      count(*) FILTER (WHERE s.atype='TSS' AND s.adate BETWEEN lfy_start AND lfy_end)::int AS tss_lfy,
      count(*) FILTER (WHERE s.adate BETWEEN cfy_start AND cfy_end)::int AS any_cfy,
      count(*) FILTER (WHERE s.atype='New' AND s.adate BETWEEN cfy_start AND cfy_end)::int AS tp_cfy
    FROM sales s GROUP BY s.acct_id
  ),
  calls AS (
    SELECT c.account_id AS acct_id, max(c.called_at) AS last_call_at,
      count(*)::int AS total, bool_or(c.called_by = auth.uid()) AS mine
    FROM crm_calls c
    WHERE c.org_id IN (SELECT auth_user_org_ids()) AND c.account_id IN (SELECT id FROM acct)
    GROUP BY c.account_id
  )
  SELECT ac.id, ac.name, ac.external_id, ac.district_new, ac.region, ac.hub, ac.telecaller, ac.phone,
    COALESCE(g.tss_cfy,0), COALESCE(g.tss_lfy,0), COALESCE(g.any_cfy,0), COALESCE(g.tp_cfy,0),
    cl.last_call_at, COALESCE(cl.total,0), COALESCE(cl.mine,false)
  FROM acct ac
  LEFT JOIN agg g ON g.acct_id = ac.id
  LEFT JOIN calls cl ON cl.acct_id = ac.id;
END $function$;

-- Orphaned trigger function (its table + trigger are gone).
drop function if exists memberships_guard();
