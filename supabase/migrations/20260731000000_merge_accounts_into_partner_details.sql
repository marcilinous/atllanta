-- ATLLANTA — make crm_partner_details the single partner source of truth.
--
-- Consolidates crm_accounts INTO crm_partner_details and drops the crm_accounts
-- TABLE, replacing it with a data-less, writable compatibility VIEW so the 10
-- analytics RPCs, the opportunity-features matview, and the generic CRM screens
-- keep working unchanged.
--
-- Strategy (id-adoption): every linked partner row takes its crm_accounts.id as
-- its own id, so the 89k crm_report_rows + visits/calls/matview already point at
-- the right partner — no mass remap. crm_accounts becomes a view over
-- crm_partner_details scoped to the former account set (account_id IS NOT NULL),
-- with security_invoker so tenant RLS still applies to direct reads, plus
-- INSTEAD OF triggers so writes route into crm_partner_details.
--
-- A full snapshot is kept in zzz_crm_accounts_backup for rollback.

-- 1. Carry the analytics columns onto the master.
alter table crm_partner_details
  add column if not exists owner_id uuid,
  add column if not exists tier text,
  add column if not exists district_new text,
  add column if not exists customer_count integer,
  add column if not exists customer_base_active_3y boolean,
  add column if not exists partner_status text;

update crm_partner_details pd
set owner_id = a.owner_id, tier = a.tier, district_new = a.district_new,
    customer_count = a.customer_count, customer_base_active_3y = a.customer_base_active_3y,
    partner_status = a.partner_status
from crm_accounts a
where a.id = pd.account_id;

-- 2. Adopt the account id as the partner id (linked rows only), so every
--    account_id reference across the schema already resolves to this partner.
update crm_partner_details set id = account_id where account_id is not null and id <> account_id;

-- 3. Snapshot, then unwire and drop the table.
create table zzz_crm_accounts_backup as select * from crm_accounts;

drop materialized view crm_opportunity_features_mv;

alter table crm_calls          drop constraint crm_calls_account_id_fkey;
alter table crm_contacts       drop constraint crm_contacts_account_id_fkey;
alter table crm_leads          drop constraint crm_leads_converted_account_id_fkey;
alter table crm_opportunities  drop constraint crm_opportunities_account_id_fkey;
alter table crm_partner_details drop constraint crm_partner_details_account_id_fkey;
alter table crm_report_rows    drop constraint crm_report_rows_account_id_fkey;
alter table crm_visits         drop constraint crm_visits_account_id_fkey;

drop table crm_accounts;

-- 4. Compatibility view: same columns, projected from the master, former-account
--    set only. security_invoker => tenant RLS on crm_partner_details applies.
create view crm_accounts with (security_invoker = true) as
select
  id, org_id,
  partner_name              as name,
  null::text                as industry,
  null::text                as website,
  mobile_number             as phone,
  null::integer             as employees_count,
  null::numeric             as annual_revenue,
  city                      as billing_city,
  null::text                as billing_country,
  owner_id,
  null::text                as description,
  created_by, created_at, updated_at,
  site_id                   as external_id,
  tier, partner_status, state, region, district, hub,
  telecaller_name           as telecaller,
  district_new, customer_count, customer_base_active_3y, pincode
from crm_partner_details
where account_id is not null;

grant select, insert, update, delete on crm_accounts to anon, authenticated, service_role;

-- INSTEAD OF triggers route writes into the master (run as invoker => RLS applies).
create or replace function crm_accounts_view_ins() returns trigger
  language plpgsql set search_path = public as $$
declare newid uuid := coalesce(NEW.id, gen_random_uuid());
begin
  insert into crm_partner_details
    (id, org_id, account_id, partner_name, mobile_number, city, owner_id, site_id,
     tier, partner_status, state, region, district, hub, telecaller_name,
     district_new, customer_count, customer_base_active_3y, pincode, created_by,
     created_at, updated_at)
  values
    (newid, NEW.org_id, newid, NEW.name, NEW.phone, NEW.billing_city, NEW.owner_id,
     NEW.external_id, NEW.tier, NEW.partner_status, NEW.state, NEW.region, NEW.district,
     NEW.hub, NEW.telecaller, NEW.district_new, NEW.customer_count,
     NEW.customer_base_active_3y, NEW.pincode, NEW.created_by,
     coalesce(NEW.created_at, now()), now());
  NEW.id := newid;
  return NEW;
end $$;

create or replace function crm_accounts_view_upd() returns trigger
  language plpgsql set search_path = public as $$
begin
  update crm_partner_details set
    partner_name = NEW.name, mobile_number = NEW.phone, city = NEW.billing_city,
    owner_id = NEW.owner_id, site_id = NEW.external_id, tier = NEW.tier,
    partner_status = NEW.partner_status, state = NEW.state, region = NEW.region,
    district = NEW.district, hub = NEW.hub, telecaller_name = NEW.telecaller,
    district_new = NEW.district_new, customer_count = NEW.customer_count,
    customer_base_active_3y = NEW.customer_base_active_3y, pincode = NEW.pincode,
    updated_at = now()
  where id = OLD.id;
  return NEW;
end $$;

create or replace function crm_accounts_view_del() returns trigger
  language plpgsql set search_path = public as $$
begin
  delete from crm_partner_details where id = OLD.id;
  return OLD;
end $$;

create trigger crm_accounts_ins instead of insert on crm_accounts
  for each row execute function crm_accounts_view_ins();
create trigger crm_accounts_upd instead of update on crm_accounts
  for each row execute function crm_accounts_view_upd();
create trigger crm_accounts_del instead of delete on crm_accounts
  for each row execute function crm_accounts_view_del();

-- 5. Repoint child FKs to the master (ids preserved => values valid).
-- Null any child reference to an account that was never in the partner master
-- (e.g. a demo record against a non-master account), so the FKs validate.
update crm_calls         set account_id = null           where account_id is not null           and account_id not in (select id from crm_partner_details);
update crm_contacts      set account_id = null           where account_id is not null           and account_id not in (select id from crm_partner_details);
update crm_leads         set converted_account_id = null where converted_account_id is not null and converted_account_id not in (select id from crm_partner_details);
update crm_opportunities set account_id = null           where account_id is not null           and account_id not in (select id from crm_partner_details);
update crm_report_rows   set account_id = null           where account_id is not null           and account_id not in (select id from crm_partner_details);
update crm_visits        set account_id = null           where account_id is not null           and account_id not in (select id from crm_partner_details);

alter table crm_calls         add constraint crm_calls_account_id_fkey
  foreign key (account_id) references crm_partner_details(id) on delete set null;
alter table crm_contacts      add constraint crm_contacts_account_id_fkey
  foreign key (account_id) references crm_partner_details(id) on delete set null;
alter table crm_leads         add constraint crm_leads_converted_account_id_fkey
  foreign key (converted_account_id) references crm_partner_details(id) on delete set null;
alter table crm_opportunities add constraint crm_opportunities_account_id_fkey
  foreign key (account_id) references crm_partner_details(id) on delete set null;
alter table crm_report_rows   add constraint crm_report_rows_account_id_fkey
  foreign key (account_id) references crm_partner_details(id) on delete set null;
alter table crm_visits        add constraint crm_visits_account_id_fkey
  foreign key (account_id) references crm_partner_details(id) on delete set null;

-- 6. Recreate the opportunity-features matview (now reading the crm_accounts view)
--    with its original definition + indexes.
create materialized view crm_opportunity_features_mv as
 WITH b AS (
         SELECT q.s AS cfy_start,
            (q.s + '1 year -1 days'::interval)::date AS cfy_end,
            (q.s - '1 year'::interval)::date AS lfy_start,
            (q.s - '1 day'::interval)::date AS lfy_end
           FROM ( SELECT make_date(EXTRACT(year FROM CURRENT_DATE)::integer -
                        CASE WHEN EXTRACT(month FROM CURRENT_DATE) >= 4::numeric THEN 0 ELSE 1 END, 4, 1) AS make_date) q(s)
        ), acct AS (
         SELECT a_1.id, a_1.org_id, a_1.name, a_1.external_id, a_1.hub, a_1.district_new,
            a_1.region, a_1.owner_id, a_1.telecaller, a_1.customer_count, a_1.customer_base_active_3y
           FROM crm_accounts a_1
          WHERE COALESCE(a_1.region, ''::text) <> 'Kerala'::text
        ), sales AS MATERIALIZED (
         SELECT rr.account_id AS acct_id, rr.data ->> 'activation type'::text AS atype,
                CASE WHEN (rr.data ->> 'sum of activation value'::text) ~ '^-?[0-9]+(\.[0-9]+)?$'::text
                     THEN (rr.data ->> 'sum of activation value'::text)::numeric ELSE 0::numeric END AS rev,
            crm_report_event_date(rr.data ->> 'activation date'::text) AS adate
           FROM crm_report_rows rr
          WHERE rr.account_id IS NOT NULL AND (rr.import_id IN ( SELECT crm_report_imports.id
                   FROM crm_report_imports WHERE crm_report_imports.report_type ~~* 'Sales'::text))
        ), sagg AS (
         SELECT s.acct_id,
            max(s.adate) FILTER (WHERE s.atype = 'TSS'::text) AS last_tss_date,
            max(s.adate) FILTER (WHERE s.atype = 'New'::text) AS last_tp_date,
            max(s.adate) AS last_activation_date,
            COALESCE(sum(s.rev) FILTER (WHERE s.adate >= b.cfy_start), 0::numeric) AS value_this_fy,
            COALESCE(sum(s.rev) FILTER (WHERE s.adate >= b.lfy_start AND s.adate <= b.lfy_end), 0::numeric) AS value_last_fy,
            COALESCE(sum(s.rev) FILTER (WHERE s.adate >= (CURRENT_DATE - 365)), 0::numeric) AS value_12m,
            COALESCE(sum(s.rev) FILTER (WHERE s.atype = 'TSS'::text), 0::numeric) AS tss_value_all,
            COALESCE(sum(s.rev) FILTER (WHERE s.atype = 'New'::text), 0::numeric) AS tp_value_all,
            count(*) FILTER (WHERE s.adate >= b.cfy_start)::integer AS purchases_this_fy
           FROM sales s CROSS JOIN b GROUP BY s.acct_id
        ), lastact AS (
         SELECT DISTINCT ON (s.acct_id) s.acct_id, s.atype AS last_activation_type, s.rev AS last_activation_value
           FROM sales s WHERE s.adate IS NOT NULL ORDER BY s.acct_id, s.adate DESC, s.rev DESC
        ), visit AS MATERIALIZED (
         SELECT rr.account_id AS acct_id, crm_report_event_date(rr.data ->> 'Visited Date'::text) AS vdate
           FROM crm_report_rows rr
          WHERE rr.account_id IS NOT NULL AND (rr.import_id IN ( SELECT crm_report_imports.id
                   FROM crm_report_imports WHERE crm_report_imports.name ~~* '%visit%'::text))
        UNION ALL
         SELECT v_1.account_id, v_1.visited_at::date AS visited_at
           FROM crm_visits v_1 WHERE v_1.account_id IS NOT NULL
        ), vagg AS (
         SELECT vv.acct_id, count(*)::integer AS visits_this_fy, max(vv.vdate) AS last_visit_date
           FROM visit vv CROSS JOIN b WHERE vv.vdate IS NOT NULL AND vv.vdate >= b.cfy_start GROUP BY vv.acct_id
        ), call AS MATERIALIZED (
         SELECT rr.account_id AS acct_id, crm_report_event_date(rr.data ->> 'Called Date'::text) AS cdate
           FROM crm_report_rows rr
          WHERE rr.account_id IS NOT NULL AND (rr.import_id IN ( SELECT crm_report_imports.id
                   FROM crm_report_imports WHERE crm_report_imports.name ~~* '%telecall%'::text OR crm_report_imports.name ~~* '%followup%'::text OR crm_report_imports.columns @> ARRAY['Call Status'::text]))
        UNION ALL
         SELECT c_1.account_id, c_1.called_at::date AS called_at
           FROM crm_calls c_1 WHERE c_1.account_id IS NOT NULL
        ), cagg AS (
         SELECT cc.acct_id, count(*)::integer AS calls_this_fy, max(cc.cdate) AS last_call_date
           FROM call cc CROSS JOIN b WHERE cc.cdate IS NOT NULL AND cc.cdate >= b.cfy_start GROUP BY cc.acct_id
        )
 SELECT a.id AS account_id, a.org_id, a.name, a.external_id, a.hub, a.district_new, a.region,
    a.owner_id, a.telecaller, a.customer_count, a.customer_base_active_3y,
    g.last_tss_date, g.last_tp_date, g.last_activation_date, la.last_activation_type,
    COALESCE(la.last_activation_value, 0::numeric) AS last_activation_value,
    COALESCE(g.value_this_fy, 0::numeric) AS value_this_fy,
    COALESCE(g.value_last_fy, 0::numeric) AS value_last_fy,
    COALESCE(g.value_12m, 0::numeric) AS value_12m,
    COALESCE(g.tss_value_all, 0::numeric) AS tss_value_all,
    COALESCE(g.tp_value_all, 0::numeric) AS tp_value_all,
    COALESCE(g.purchases_this_fy, 0) AS purchases_this_fy,
    COALESCE(v.visits_this_fy, 0) AS visits_this_fy, v.last_visit_date,
    COALESCE(c.calls_this_fy, 0) AS calls_this_fy, c.last_call_date, now() AS computed_at
   FROM acct a
     LEFT JOIN sagg g ON g.acct_id = a.id
     LEFT JOIN lastact la ON la.acct_id = a.id
     LEFT JOIN vagg v ON v.acct_id = a.id
     LEFT JOIN cagg c ON c.acct_id = a.id;

create unique index idx_crm_opp_mv_account on crm_opportunity_features_mv (account_id);
create index idx_crm_opp_mv_org   on crm_opportunity_features_mv (org_id);
create index idx_crm_opp_mv_owner on crm_opportunity_features_mv (org_id, owner_id);
create index idx_crm_opp_mv_hub   on crm_opportunity_features_mv (org_id, hub);
