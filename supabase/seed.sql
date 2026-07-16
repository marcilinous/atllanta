-- ATLLANTA — seed data (matches what is already in the live project)
-- Direct org gets its self-client automatically via trg_create_self_client.

insert into organizations (name, org_type, plan_tier)
values ('TechNova Pvt Ltd', 'direct', 'starter');

insert into organizations (name, org_type, plan_tier, commission_percent)
values ('BlueHire Consultants', 'agency', 'agency_partner', 10.00);

-- Agency orgs do not get a self-client; add their first client company manually.
insert into clients (organization_id, name, is_self)
select id, 'Meridian Retail Ltd', false
from organizations
where name = 'BlueHire Consultants';
